import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as Y from "yjs";

import {
  CoalesceBufferManager,
  readCoalesceIntervalMs,
} from "./coalesce-buffer.js";

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function createManager(intervalMs: number) {
  const broadcasts: Uint8Array[] = [];
  const document = new Y.Doc();
  const documentManager = {
    applyUpdate: async (_docId: string, update: Uint8Array) => {
      Y.applyUpdate(document, update);
      return { ok: true as const };
    },
  };
  const roomManager = {
    broadcast: async (_docId: string, update: Uint8Array) => {
      broadcasts.push(update);
    },
  };
  const redisTransport = { publish: () => undefined };
  const manager = new CoalesceBufferManager(
    documentManager,
    roomManager,
    redisTransport,
    intervalMs,
  );
  return { broadcasts, document, manager };
}

function update(text: string): Uint8Array {
  const doc = new Y.Doc();
  doc.getText("body").insert(0, text);
  return Y.encodeStateAsUpdate(doc);
}

describe("coalesce interval configuration", () => {
  it("defaults to 16ms and accepts zero", () => {
    assert.equal(readCoalesceIntervalMs({}), 16);
    assert.equal(
      readCoalesceIntervalMs({ KNOWDEX_COALESCE_INTERVAL_MS: "0" }),
      0,
    );
    assert.equal(
      readCoalesceIntervalMs({ KNOWDEX_COALESCE_INTERVAL_MS: "16" }),
      16,
    );
  });

  it("rejects invalid, negative, and fractional values instead of silently using the default", () => {
    for (const value of ["", "-1", "1.5", "nope", "Infinity"]) {
      assert.throws(
        () => readCoalesceIntervalMs({ KNOWDEX_COALESCE_INTERVAL_MS: value }),
        /KNOWDEX_COALESCE_INTERVAL_MS/,
        value,
      );
    }
  });
});

describe("CoalesceBufferManager", () => {
  it("flushes every update immediately when the interval is zero", async () => {
    const { broadcasts, manager } = createManager(0);

    manager.enqueueUpdate("doc", update("a"), "sender");
    manager.enqueueUpdate("doc", update("b"), "sender");
    await wait(5);

    assert.equal(broadcasts.length, 2);
  });

  it("coalesces updates arriving within the configured interval and converges state", async () => {
    const { broadcasts, document, manager } = createManager(16);

    manager.enqueueUpdate("doc", update("a"), "sender");
    manager.enqueueUpdate("doc", update("b"), "sender");
    await wait(30);

    assert.equal(broadcasts.length, 1);
    assert.equal(document.getText("body").toString().length, 2);
  });
});
