import assert from 'node:assert/strict'
import net from 'node:net'
import test from 'node:test'
import { LOCAL_LORO_DATA_PLANE_PROTOCOL_VERSION } from '@lody/shared/local-loro-data-plane'
import { LoroDataPlaneRelay } from './loro-data-plane-relay.ts'

void test('does not probe the local data plane while local agents are disabled', async () => {
  let connectionAttempts = 0
  const relay = new LoroDataPlaneRelay('/unused/local-data-plane.sock', () => {
    connectionAttempts += 1
    const socket = new net.Socket()
    queueMicrotask(() => socket.emit('error', new Error('test socket unavailable')))
    return socket
  })
  const ping = {
    type: 'ping',
    protocolVersion: LOCAL_LORO_DATA_PLANE_PROTOCOL_VERSION
  }

  relay.setEnabled(false)
  relay.send(ping)
  assert.equal(connectionAttempts, 0)

  relay.setEnabled(true)
  relay.send(ping)
  assert.equal(connectionAttempts, 1)

  relay.destroy()
  await Promise.resolve()
})

void test("connects to remote Loro relay when LODY_REMOTE_LORO_SERVER is configured", async () => {
  const originalEnv = process.env.LODY_REMOTE_LORO_SERVER;
  let capturedHost = null;
  let capturedPort = null;
  const originalCreateConnection = net.createConnection;
  net.createConnection = (options) => {
    if (typeof options === "object" && options.host && options.port) {
      capturedHost = options.host;
      capturedPort = options.port;
    }
    const socket = new net.Socket();
    queueMicrotask(() => socket.emit("error", new Error("mock connection closed")));
    return socket;
  };

  try {
    process.env.LODY_REMOTE_LORO_SERVER = "192.168.1.50:17789";
    const relay = new LoroDataPlaneRelay("/unused/local.sock");
    relay.send({
      type: "ping",
      protocolVersion: LOCAL_LORO_DATA_PLANE_PROTOCOL_VERSION
    });
    assert.equal(capturedHost, "192.168.1.50");
    assert.equal(capturedPort, 17789);
    relay.destroy();
  } finally {
    net.createConnection = originalCreateConnection;
    if (originalEnv === undefined) {
      delete process.env.LODY_REMOTE_LORO_SERVER;
    } else {
      process.env.LODY_REMOTE_LORO_SERVER = originalEnv;
    }
  }
});
