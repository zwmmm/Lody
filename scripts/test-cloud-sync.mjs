/**
 * End-to-End Test: Local Execution with Remote Session CRDT Synchronization
 */
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_PORT = 18889;
const RELAY_SCRIPT = path.join(__dirname, "cloud-loro-relay.mjs");

console.log("[Test] 1. Starting Cloud Relay Server on port " + TEST_PORT + "...");
const relayProc = fork(RELAY_SCRIPT, [], {
  env: { ...process.env, PORT: String(TEST_PORT), HOST: "127.0.0.1" },
  stdio: "pipe"
});

relayProc.stdout.on("data", (d) => process.stdout.write("[RelayLog] " + d));
relayProc.stderr.on("data", (d) => process.stderr.write("[RelayErr] " + d));

// Wait for relay to be ready
await new Promise((resolve) => {
  const check = () => {
    const s = net.createConnection({ host: "127.0.0.1", port: TEST_PORT }, () => {
      s.end();
      resolve();
    });
    s.on("error", () => setTimeout(check, 100));
  };
  check();
});
console.log("[Test] Cloud Relay Server is ready!");

// Helper to create a client socket with JSON lines framing
function createTestClient(name) {
  const socket = net.createConnection({ host: "127.0.0.1", port: TEST_PORT });
  const listeners = [];
  let buffer = "";

  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let idx;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) {
        const parsed = JSON.parse(line);
        for (const l of listeners) l(parsed);
      }
    }
  });

  return {
    name,
    socket,
    send(obj) {
      socket.write(JSON.stringify(obj) + "\n");
    },
    onMessage(fn) {
      listeners.push(fn);
    },
    close() {
      socket.destroy();
    }
  };
}

const clientA = createTestClient("DevLaptop-A");
const clientB = createTestClient("RemoteObserver-B");

const testWorkspace = "ws_team_enterprise";
const testSessionDoc = "session_task_optimize_db";
const peerA = "peer_macbook_local";
const peerB = "peer_remote_browser";

console.log("[Test] 2. Client A and Client B joining room for " + testSessionDoc + "...");

// Client B awaits update from Client A
const receivedUpdatePromise = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Timeout waiting for CRDT update")), 5000);
  clientB.onMessage((msg) => {
    if (msg.type === "update") {
      clearTimeout(timer);
      resolve(msg);
    }
  });
});

// Both join
clientA.send({
  type: "join",
  protocolVersion: 7,
  workspaceId: testWorkspace,
  peerId: peerA,
  room: { scope: "doc", docId: testSessionDoc },
  haveVersion: ""
});

clientB.send({
  type: "join",
  protocolVersion: 7,
  workspaceId: testWorkspace,
  peerId: peerB,
  room: { scope: "doc", docId: testSessionDoc },
  haveVersion: ""
});

// Wait a tick for joins to register
await new Promise((r) => setTimeout(r, 200));

console.log("[Test] 3. Client A publishing local Agent execution CRDT delta...");
const sampleLoroDelta = Buffer.from("CRDT_OP_INSERT_DIFF: +const db = initCluster();").toString("base64");

clientA.send({
  type: "update",
  protocolVersion: 7,
  workspaceId: testWorkspace,
  peerId: peerA,
  room: { scope: "doc", docId: testSessionDoc },
  payload: {
    kind: "doc-update",
    dataBase64: sampleLoroDelta
  }
});

console.log("[Test] 4. Verifying Client B received the synchronized session update...");
const update = await receivedUpdatePromise;

console.log("[Test] Received update on Client B:", JSON.stringify(update));
assert.equal(update.type, "update");
assert.equal(update.workspaceId, testWorkspace);
assert.equal(update.room.docId, testSessionDoc);
assert.equal(update.payload.dataBase64, sampleLoroDelta);

console.log("\n>>> [SUCCESS] Full round-trip Session CRDT Synchronization verified! <<<\n");

// Cleanup
clientA.close();
clientB.close();
relayProc.kill();
process.exit(0);
