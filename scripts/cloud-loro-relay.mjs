#!/usr/bin/env node
/**
 * Standalone Cloud Loro CRDT Relay Server
 * 
 * Provides centralized Session CRDT & event routing across multiple machines:
 * - Local developer machines run agents locally and push CRDT updates to this relay.
 * - Remote observers (browsers, mobile, or other machines) subscribe to the same
 *   session rooms and receive real-time streams, terminal outputs, and diffs.
 * 
 * Zero external dependencies: runs on pure Node.js (v18+).
 */
import net from "node:net";

const PORT = Number.parseInt(process.env.PORT || process.env.LODY_RELAY_PORT || "17789", 10);
const HOST = process.env.HOST || "0.0.0.0";
const PROTOCOL_VERSION = 7;

// roomKey -> Set<{ connectionId: string, socket: net.Socket, peerId: string, workspaceId: string }>
const roomSubscribers = new Map();

// socket -> { connectionId: string, peerRooms: Map<string, Set<string>> }
const clientContexts = new Map();

let nextConnectionId = 1;

function getRoomKey(workspaceId, room) {
  if (!room) return workspaceId;
  if (room.scope === "meta") return `${workspaceId}:meta`;
  if (room.scope === "doc") return `${workspaceId}:doc:${room.docId}`;
  if (room.scope === "flock-doc") return `${workspaceId}:flock:${room.flockDocId}`;
  return `${workspaceId}:${JSON.stringify(room)}`;
}

const server = net.createServer((socket) => {
  const connectionId = `conn_${nextConnectionId++}`;
  const remoteAddr = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(`[Relay] [+] Client connected: ${connectionId} (${remoteAddr})`);

  const ctx = {
    connectionId,
    remoteAddr,
    peerRooms: new Map() // peerId -> Set<roomKey>
  };
  clientContexts.set(socket, ctx);

  let buffer = "";

  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newlineIdx;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (line.length > 0) {
        handleClientLine(socket, ctx, line);
      }
    }
  });

  socket.on("close", () => {
    console.log(`[Relay] [-] Client disconnected: ${connectionId}`);
    cleanupClient(socket, ctx);
  });

  socket.on("error", (err) => {
    console.warn(`[Relay] [!] Socket error for ${connectionId}:`, err.message);
  });
});

function handleClientLine(socket, ctx, line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (err) {
    console.warn(`[Relay] Malformed JSON from ${ctx.connectionId}`);
    return;
  }

  // 1. Heartbeat ping
  if (msg.type === "ping") {
    socket.write(JSON.stringify({ type: "pong", protocolVersion: PROTOCOL_VERSION }) + "\n");
    return;
  }

  // 2. Join room
  if (msg.type === "join") {
    const { workspaceId, peerId, room } = msg;
    const rKey = getRoomKey(workspaceId, room);
    
    if (!roomSubscribers.has(rKey)) {
      roomSubscribers.set(rKey, new Set());
    }
    const subscriber = {
      connectionId: ctx.connectionId,
      socket,
      peerId,
      workspaceId
    };
    roomSubscribers.get(rKey).add(subscriber);

    let pRooms = ctx.peerRooms.get(peerId);
    if (!pRooms) {
      pRooms = new Set();
      ctx.peerRooms.set(peerId, pRooms);
    }
    pRooms.add(rKey);

    console.log(`[Relay] Peer ${peerId} joined room: ${rKey} (Total subscribers: ${roomSubscribers.get(rKey).size})`);

    // Acknowledge join
    const ack = {
      type: "joined",
      protocolVersion: PROTOCOL_VERSION,
      workspaceId,
      peerId,
      room,
      serverVersion: ""
    };
    socket.write(JSON.stringify(ack) + "\n");
    return;
  }

  // 3. Update room (CRDT payload broadcast)
  if (msg.type === "update") {
    const { workspaceId, peerId, room, payload } = msg;
    const rKey = getRoomKey(workspaceId, room);
    const subscribers = roomSubscribers.get(rKey);

    if (!subscribers || subscribers.size <= 1) {
      // Only publisher is in room
      return;
    }

    const forwardLine = JSON.stringify(msg) + "\n";
    let fanoutCount = 0;
    for (const sub of subscribers) {
      // Fanout to other clients / peers
      if (sub.socket !== socket && !sub.socket.destroyed) {
        sub.socket.write(forwardLine);
        fanoutCount++;
      }
    }
    console.log(`[Relay] Broadcasted update (${payload?.kind || "delta"}) in ${rKey} to ${fanoutCount} subscriber(s)`);
    return;
  }

  // 4. Leave room
  if (msg.type === "leave") {
    const { workspaceId, peerId, room } = msg;
    const rKey = getRoomKey(workspaceId, room);
    const subscribers = roomSubscribers.get(rKey);
    if (subscribers) {
      for (const sub of subscribers) {
        if (sub.socket === socket && sub.peerId === peerId) {
          subscribers.delete(sub);
          break;
        }
      }
      if (subscribers.size === 0) roomSubscribers.delete(rKey);
    }
    ctx.peerRooms.get(peerId)?.delete(rKey);
    console.log(`[Relay] Peer ${peerId} left room: ${rKey}`);
    return;
  }

  // 5. Detach peer
  if (msg.type === "detach") {
    const { peerId } = msg;
    const pRooms = ctx.peerRooms.get(peerId);
    if (pRooms) {
      for (const rKey of pRooms) {
        const subs = roomSubscribers.get(rKey);
        if (subs) {
          for (const s of subs) {
            if (s.socket === socket && s.peerId === peerId) {
              subs.delete(s);
            }
          }
          if (subs.size === 0) roomSubscribers.delete(rKey);
        }
      }
      ctx.peerRooms.delete(peerId);
    }
    console.log(`[Relay] Detached peer ${peerId}`);
  }
}

function cleanupClient(socket, ctx) {
  clientContexts.delete(socket);
  for (const [peerId, rooms] of ctx.peerRooms) {
    for (const rKey of rooms) {
      const subs = roomSubscribers.get(rKey);
      if (subs) {
        for (const s of subs) {
          if (s.socket === socket) {
            subs.delete(s);
          }
        }
        if (subs.size === 0) roomSubscribers.delete(rKey);
      }
    }
  }
}

server.listen(PORT, HOST, () => {
  console.log(`===================================================`);
  console.log(`  Lody Cloud Loro CRDT Relay Server running`);
  console.log(`  Listening on tcp://${HOST}:${PORT}`);
  console.log(`  Protocol Version: ${PROTOCOL_VERSION}`);
  console.log(`===================================================`);
});
