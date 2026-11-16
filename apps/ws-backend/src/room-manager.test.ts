import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WebSocket } from "ws";

import { ProtocolCodec } from "@repo/crdt";
import { RoomManager, type ConnectionContext } from "./room-manager.js";

function fakeConnection(
  clientId: string,
  sent: Uint8Array[],
  sendError?: Error,
): ConnectionContext {
  const ws = {
    readyState: WebSocket.OPEN,
    bufferedAmount: 0,
    send(data: Uint8Array, callback: (error?: Error) => void) {
      sent.push(data);
      callback(sendError);
    },
  } as unknown as WebSocket;
  return {
    ws,
    clientId,
    userId: "user",
    docId: "doc",
    connectedAt: Date.now(),
    isAlive: true,
    isOfflineClient: false,
    bucket: { consume: () => true } as ConnectionContext["bucket"],
  };
}

describe("RoomManager update counters", () => {
  it("counts one successful update send once, excluding awareness and control frames", async () => {
    const sent: Uint8Array[] = [];
    const manager = new RoomManager(
      {
        incrementClients: async () => undefined,
        decrementClients: async () => undefined,
      },
      { info: () => undefined, warn: () => undefined, error: () => undefined },
    );
    await manager.join("doc", fakeConnection("receiver", sent));

    const update = ProtocolCodec.encode({
      type: "update",
      update: new Uint8Array([1, 2]),
    });
    const awareness = ProtocolCodec.encode({
      type: "awareness",
      state: new Uint8Array([3]),
    });
    const pong = ProtocolCodec.encode({ type: "pong" });
    await manager.broadcast("doc", update);
    await manager.broadcastAwareness("doc", awareness, "sender");
    await manager.broadcast("doc", pong);

    assert.equal(sent.length, 3);
    assert.deepEqual(manager.getOutboundUpdateStats(), {
      receiver: { frames: 1, bytes: update.byteLength },
    });
  });

  it("resets counters without affecting room membership or per-room isolation", async () => {
    const first: Uint8Array[] = [];
    const second: Uint8Array[] = [];
    const manager = new RoomManager(
      {
        incrementClients: async () => undefined,
        decrementClients: async () => undefined,
      },
      { info: () => undefined, warn: () => undefined, error: () => undefined },
    );
    await manager.join("doc-a", fakeConnection("a", first));
    await manager.join("doc-b", fakeConnection("b", second));

    const update = ProtocolCodec.encode({
      type: "update",
      update: new Uint8Array([1]),
    });
    await manager.broadcast("doc-a", update);
    await manager.broadcast("doc-b", update);
    assert.equal(manager.getOutboundUpdateStats().a?.frames, 1);
    assert.equal(manager.getOutboundUpdateStats().b?.frames, 1);

    manager.resetOutboundUpdateStats();
    assert.deepEqual(manager.getOutboundUpdateStats(), {});
    assert.equal(manager.getClientCount("doc-a"), 1);
    assert.equal(manager.getClientCount("doc-b"), 1);
  });

  it("does not count a failed ws.send", async () => {
    const sent: Uint8Array[] = [];
    const manager = new RoomManager(
      {
        incrementClients: async () => undefined,
        decrementClients: async () => undefined,
      },
      { info: () => undefined, warn: () => undefined, error: () => undefined },
    );
    await manager.join(
      "doc",
      fakeConnection("receiver", sent, new Error("closed")),
    );

    const update = ProtocolCodec.encode({
      type: "update",
      update: new Uint8Array([1]),
    });
    await manager.broadcast("doc", update);

    assert.deepEqual(manager.getOutboundUpdateStats(), {});
  });
});
