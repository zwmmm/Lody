import net from 'node:net'
import { EventEmitter } from 'node:events'
import { type WebContents } from 'electron'
import {
  createJsonLineSplitter,
  LocalLoroDataPlaneServerMessageSchema,
  LOCAL_LORO_DATA_PLANE_MAX_FRAME_BYTES,
  LOCAL_LORO_DATA_PLANE_PROTOCOL_VERSION,
  type LocalLoroDataPlaneClientMessage,
  type LocalLoroDataPlaneServerMessage
} from '@lody/shared/local-loro-data-plane'
import { readElectronSettings, writeElectronSettings } from './electron-settings'

// Liveness watchdog (plan-mandated idle watchdog for the data plane): ping the
// daemon on an interval and treat a silent socket as dead — a stalled push
// channel must surface as `disconnected` (renderers show degraded state and
// rejoin on recovery), never as a permanently stale UI.
const PING_INTERVAL_MS = 15_000
const IDLE_TIMEOUT_MS = 45_000

// Redial backoff while any renderer is attached: the daemon restarting (or
// starting after Electron) must never require a window reload to resync.
const REDIAL_MIN_DELAY_MS = 1_000
const REDIAL_MAX_DELAY_MS = 30_000

// Hard memory cap for renderer→daemon frames queued while the daemon socket is
// applying backpressure. Renderer traffic is CRDT deltas (small); hitting
// this means the daemon stopped reading entirely, so reconnecting (and letting
// join reconciliation reconverge) beats buffering without bound. This is a
// safety net, NOT flow control — ordinary backpressure just queues and drains.
const PENDING_DAEMON_WRITES_MAX_BYTES = 64 * 1024 * 1024

type PendingDaemonWrite = {
  line: string
}

/**
 * Persistent bridge between renderer windows and the CLI data-plane push server.
 * This holds one long-lived socket to the daemon: it forwards renderer client
 * messages and fans server pushes out to EVERY attached renderer via
 * `webContents.send` (a dumb broadcast pipe — protocol v3 messages are
 * peer-addressed, and renderer adapters filter by workspaceId + peerId), plus a
 * connection-status channel the renderer's transport uses to drive resync.
 *
 * Peer lifecycle: the relay records which peerIds each WebContents has used and
 * synthesizes a `detach` for them when the window is destroyed or navigates
 * (reload) — a dead renderer cannot send its own goodbye, and without it the
 * daemon would hold its room subscriptions for the life of the shared socket.
 */
function createWebSocketAsSocket(url: string): net.Socket {
  const emitter = new EventEmitter() as any
  let ws: any = null
  let isDestroyed = false

  emitter.destroyed = false
  emitter.write = (chunk: any) => {
    if (ws && ws.readyState === 1 /* OPEN */) {
      const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8')
      ws.send(text)
      return true
    }
    return false
  }

  emitter.destroy = (error?: Error) => {
    if (isDestroyed) return
    isDestroyed = true
    emitter.destroyed = true
    if (ws) {
      try {
        ws.close()
      } catch {}
    }
    if (error) {
      emitter.emit('error', error)
    }
    emitter.emit('close')
  }

  try {
    ws = new (globalThis as any).WebSocket(url)
  } catch (err) {
    queueMicrotask(() => emitter.emit('error', err))
    return emitter as net.Socket
  }

  ws.onopen = () => {
    emitter.emit('connect')
  }

  ws.onmessage = (event: any) => {
    let raw = event.data
    let str = typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf-8')
    if (!str.endsWith('\n')) {
      str += '\n'
    }
    emitter.emit('data', Buffer.from(str, 'utf-8'))
  }

  ws.onerror = (event: any) => {
    emitter.emit('error', new Error(event.message || 'WebSocket error'))
  }

  ws.onclose = () => {
    emitter.destroyed = true
    emitter.emit('close')
  }

  return emitter as net.Socket
}

export class LoroDataPlaneRelay {
  private readonly defaultSocketPath: string
  private customEndpoint: string | null = null
  private readonly customCreateSocket?: (socketPath: string) => net.Socket
  private socket: net.Socket | null = null
  private connecting: Promise<void> | null = null
  private connected = false
  private enabled = true
  private destroyed = false
  private readonly senders = new Set<WebContents>()
  // sender → (peerId → workspaceId), for synthesized detach.
  private readonly sendersPeers = new Map<WebContents, Map<string, string>>()
  private redialTimer: NodeJS.Timeout | null = null
  private redialAttempt = 0
  private pingTimer: NodeJS.Timeout | null = null
  private lastInboundAt = 0
  // Drain-aware outbound queue for the daemon socket (see write()).
  private daemonWriteBlocked = false
  private pendingDaemonWrites: PendingDaemonWrite[] = []
  private pendingDaemonBytes = 0

  constructor(
    socketPath: string,
    createSocket?: (socketPath: string) => net.Socket
  ) {
    this.defaultSocketPath = socketPath
    if (createSocket) {
      this.customCreateSocket = createSocket
    }
  }

  getRemoteServer(): string {
    if (this.customEndpoint !== null) {
      return this.customEndpoint
    }
    const settings = readElectronSettings()
    if (typeof settings.remoteLoroServer === 'string' && settings.remoteLoroServer.trim()) {
      return settings.remoteLoroServer.trim()
    }
    return process.env.LODY_REMOTE_LORO_SERVER || process.env.LODY_DATA_PLANE_URL || ''
  }

  setRemoteServer(url: string): void {
    const trimmed = url.trim()
    this.customEndpoint = trimmed
    const current = readElectronSettings()
    current.remoteLoroServer = trimmed
    writeElectronSettings(current)

    // Reconnect with new endpoint or close existing connection
    this.clearRedialTimer()
    this.stopPingLoop()
    this.clearPendingDaemonWrites()
    const prevSocket = this.socket
    this.socket = null
    this.connecting = null
    this.setConnected(false)
    prevSocket?.destroy()

    if (this.enabled && this.senders.size > 0 && this.shouldConnect()) {
      void this.ensureConnected().catch(() => this.scheduleRedial())
    }
  }

  private shouldConnect(): boolean {
    if (this.customCreateSocket) return true
    const endpoint = this.getRemoteServer()
    if (endpoint) return true
    const sPath = this.defaultSocketPath
    const isSocketRemote =
      sPath.startsWith('tcp://') ||
      sPath.startsWith('ws://') ||
      sPath.startsWith('wss://') ||
      /^\d+\.\d+\.\d+\.\d+:\d+$/.test(sPath)
    if (isSocketRemote) return true
    return true
  }

  private buildSocket(): net.Socket {
    if (this.customCreateSocket) {
      return this.customCreateSocket(this.defaultSocketPath)
    }
    const remoteEndpoint =
      this.getRemoteServer() ||
      (this.defaultSocketPath.startsWith('tcp://') ||
      this.defaultSocketPath.startsWith('ws://') ||
      this.defaultSocketPath.startsWith('wss://') ||
      /^\d+\.\d+\.\d+\.\d+:\d+$/.test(this.defaultSocketPath)
        ? this.defaultSocketPath
        : null)

    if (remoteEndpoint) {
      if (remoteEndpoint.startsWith('ws://') || remoteEndpoint.startsWith('wss://')) {
        console.info(`[loro-data-plane-relay] Connecting to remote WebSocket Loro relay at ${remoteEndpoint}`)
        return createWebSocketAsSocket(remoteEndpoint)
      } else {
        const cleaned = remoteEndpoint.replace(/^tcp:\/\//, '')
        const [host, portStr] = cleaned.split(':')
        const port = Number.parseInt(portStr, 10)
        console.info(`[loro-data-plane-relay] Connecting to remote TCP Loro relay at ${host}:${port}`)
        return net.createConnection({ host, port })
      }
    } else {
      return net.createConnection(this.defaultSocketPath)
    }
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled || this.destroyed) return
    this.enabled = enabled

    if (enabled) {
      if (this.senders.size > 0 && this.shouldConnect()) {
        void this.ensureConnected().catch(() => this.scheduleRedial())
      }
      return
    }

    this.clearRedialTimer()
    this.stopPingLoop()
    this.clearPendingDaemonWrites()
    this.sendersPeers.clear()
    const socket = this.socket
    this.socket = null
    this.setConnected(false)
    socket?.destroy(new Error('loro_data_plane_relay_disabled'))
  }

  attachSender(sender: WebContents | undefined): void {
    if (!sender || sender.isDestroyed()) return
    if (!this.senders.has(sender)) {
      this.senders.add(sender)
      const releasePeers = (): void => this.releaseSenderPeers(sender)
      sender.once('destroyed', () => {
        this.senders.delete(sender)
        releasePeers()
      })
      // A main-frame navigation (incl. reload) tears down the JS context: its
      // adapters are gone and will rejoin with fresh peerIds, so detach the old
      // ones server-side.
      sender.on('did-navigate', releasePeers)
      // Seed the newly-attached renderer with the current connection state so its
      // transport can join immediately when the daemon is already reachable.
      sender.send('loro.status', this.connected)
    }
    if (this.enabled && this.shouldConnect()) {
      void this.ensureConnected().catch(() => this.scheduleRedial())
    }
  }

  isConnected(): boolean {
    return this.connected
  }

  send(message: LocalLoroDataPlaneClientMessage, sender?: WebContents): void {
    this.attachSender(sender)
    if (!this.enabled || !this.shouldConnect()) return
    this.trackPeer(message, sender)
    void this.ensureConnected()
      .then(() => this.write(message))
      .catch(() => {
        // Drop while disconnected; protocol v3 recovers by design — the status
        // channel flips on reconnect, adapters rejoin, and join reconciliation
        // re-uploads anything the daemon is missing.
        this.scheduleRedial()
      })
  }

  destroy(): void {
    this.destroyed = true
    this.clearRedialTimer()
    this.stopPingLoop()
    this.clearPendingDaemonWrites()
    this.socket?.destroy()
    this.socket = null
    this.connecting = null
    this.senders.clear()
    this.sendersPeers.clear()
  }

  private trackPeer(message: LocalLoroDataPlaneClientMessage, sender?: WebContents): void {
    if (!sender || message.type === 'ping') return
    let peers = this.sendersPeers.get(sender)
    if (!peers) {
      peers = new Map()
      this.sendersPeers.set(sender, peers)
    }
    if (message.type === 'detach') {
      peers.delete(message.peerId)
      return
    }
    peers.set(message.peerId, message.workspaceId)
  }

  private releaseSenderPeers(sender: WebContents): void {
    const peers = this.sendersPeers.get(sender)
    this.sendersPeers.delete(sender)
    if (!peers || peers.size === 0 || !this.connected) return
    for (const [peerId, workspaceId] of peers) {
      try {
        this.write({
          type: 'detach',
          protocolVersion: LOCAL_LORO_DATA_PLANE_PROTOCOL_VERSION,
          workspaceId,
          peerId
        })
      } catch {
        // Socket already gone — the daemon drops these peers on disconnect.
        return
      }
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.destroyed) throw new Error('loro_data_plane_relay_destroyed')
    if (!this.enabled) throw new Error('loro_data_plane_relay_disabled')
    if (this.socket && !this.socket.destroyed) return
    if (this.connecting) return await this.connecting

    this.connecting = new Promise<void>((resolve, reject) => {
      const socket = this.buildSocket()
      this.socket = socket
      const splitLines = createJsonLineSplitter({
        onLine: (line) => this.handleLine(line),
        // Defense-in-depth: a compliant daemon never sends an oversized frame
        // (sender-side budget); cap main-process buffering against a
        // non-compliant one and skip the frame rather than kill the socket.
        maxBufferBytes: LOCAL_LORO_DATA_PLANE_MAX_FRAME_BYTES,
        onOverflow: () => {
          console.warn('[loro-data-plane-relay] oversized frame from daemon dropped')
        }
      })

      socket.once('connect', () => {
        this.connecting = null
        this.redialAttempt = 0
        this.lastInboundAt = Date.now()
        this.startPingLoop(socket)
        this.setConnected(true)
        resolve()
      })
      socket.once('error', (error) => {
        this.connecting = null
        reject(error)
      })
      socket.on('close', () => {
        if (this.socket === socket) this.socket = null
        this.connecting = null
        this.stopPingLoop()
        // Frames queued for the dead socket are dropped: protocol v3+ recovers
        // by design (adapters rejoin on reconnect and join reconciliation
        // re-uploads anything the daemon is missing).
        this.clearPendingDaemonWrites()
        this.setConnected(false)
        this.scheduleRedial()
      })
      socket.on('data', (chunk) => {
        this.lastInboundAt = Date.now()
        // Raw bytes on purpose: the splitter owns the stateful UTF-8 decode, so
        // a multi-byte character split across two socket chunks is not mangled
        // into U+FFFD (flock bundles carry file paths as literal UTF-8 JSON).
        splitLines(chunk)
      })
      socket.on('drain', () => this.flushPendingDaemonWrites(socket))
    })

    return await this.connecting
  }

  private scheduleRedial(): void {
    if (this.destroyed || !this.enabled || this.redialTimer) return
    if (this.senders.size === 0) return
    if (this.socket && !this.socket.destroyed) return
    const delay = Math.min(
      REDIAL_MAX_DELAY_MS,
      REDIAL_MIN_DELAY_MS * 2 ** Math.min(this.redialAttempt, 30)
    )
    this.redialAttempt += 1
    this.redialTimer = setTimeout(() => {
      this.redialTimer = null
      void this.ensureConnected().catch(() => this.scheduleRedial())
    }, delay)
    this.redialTimer.unref?.()
  }

  private clearRedialTimer(): void {
    if (this.redialTimer) {
      clearTimeout(this.redialTimer)
      this.redialTimer = null
    }
  }

  private startPingLoop(socket: net.Socket): void {
    this.stopPingLoop()
    this.pingTimer = setInterval(() => {
      if (socket.destroyed) {
        this.stopPingLoop()
        return
      }
      if (Date.now() - this.lastInboundAt > IDLE_TIMEOUT_MS) {
        // Silent stall: no pong (or any frame) for the idle window. Drop the
        // socket; the close handler flips status and schedules a redial.
        console.warn('[loro-data-plane-relay] daemon socket idle; reconnecting')
        socket.destroy()
        return
      }
      try {
        socket.write(
          `${JSON.stringify({
            type: 'ping',
            protocolVersion: LOCAL_LORO_DATA_PLANE_PROTOCOL_VERSION
          })}\n`
        )
      } catch {
        socket.destroy()
      }
    }, PING_INTERVAL_MS)
    this.pingTimer.unref?.()
  }

  private stopPingLoop(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }

  // Drain-aware writes: backpressure from the daemon queues frames here (and
  // pauses direct writes) instead of destroying the socket — a busy daemon just
  // reads slower. Only the PENDING_DAEMON_WRITES_MAX_BYTES safety net (daemon
  // stopped reading entirely) still reconnects.
  private write(message: LocalLoroDataPlaneClientMessage): void {
    const socket = this.socket
    if (!socket || socket.destroyed) {
      throw new Error('loro_data_plane_socket_unavailable')
    }
    const line = `${JSON.stringify(message)}\n`
    if (this.daemonWriteBlocked || this.pendingDaemonWrites.length > 0) {
      if (this.pendingDaemonBytes + line.length > PENDING_DAEMON_WRITES_MAX_BYTES) {
        console.warn('[loro-data-plane-relay] daemon socket write queue exceeded; reconnecting')
        socket.destroy()
        throw new Error('loro_data_plane_socket_backpressure')
      }
      this.pendingDaemonWrites.push({ line })
      this.pendingDaemonBytes += line.length
      return
    }

    const drained = socket.write(line)
    if (!drained) {
      this.daemonWriteBlocked = true
    }
  }

  private flushPendingDaemonWrites(socket: net.Socket): void {
    this.daemonWriteBlocked = false
    while (this.pendingDaemonWrites.length > 0) {
      const next = this.pendingDaemonWrites.shift()
      if (!next) break
      this.pendingDaemonBytes = Math.max(0, this.pendingDaemonBytes - next.line.length)
      const drained = socket.write(next.line)
      if (!drained) {
        this.daemonWriteBlocked = true
        break
      }
    }
  }

  private clearPendingDaemonWrites(): void {
    this.pendingDaemonWrites = []
    this.pendingDaemonBytes = 0
    this.daemonWriteBlocked = false
  }

  private handleLine(line: string): void {
    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(line)
    } catch {
      console.warn('[loro-data-plane-relay] unparseable JSON frame from daemon')
      return
    }
    const parsed = LocalLoroDataPlaneServerMessageSchema.safeParse(parsedJson)
    if (!parsed.success) {
      console.warn('[loro-data-plane-relay] invalid message schema from daemon', parsed.error)
      return
    }
    if (parsed.data.type === 'pong') return
    this.publish(parsed.data)
  }

  private publish(message: LocalLoroDataPlaneServerMessage): void {
    for (const sender of this.senders) {
      if (!sender.isDestroyed()) {
        sender.send('loro.event', message)
      }
    }
  }

  private setConnected(next: boolean): void {
    if (this.connected === next) return
    this.connected = next
    for (const sender of this.senders) {
      if (!sender.isDestroyed()) {
        sender.send('loro.status', next)
      }
    }
  }
}
