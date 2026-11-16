import { encodeMessage } from "./protocol.js";
import { TokenBucket } from "./token-bucket.js";
import { mergeUpdates } from "@repo/crdt";

interface DocumentUpdater {
  applyUpdate(
    docId: string,
    update: Uint8Array,
  ): Promise<{ ok: true } | { ok: false; error: { message: string } }>;
}

interface UpdateBroadcaster {
  broadcast(
    docId: string,
    update: Uint8Array,
    excludeClientId?: string,
  ): Promise<void>;
}

interface UpdatePublisher {
  publish(docId: string, update: Uint8Array, originClientId: string): void;
}

const DEFAULT_COALESCE_INTERVAL_MS = 16;

export function readCoalesceIntervalMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.KNOWDEX_COALESCE_INTERVAL_MS;
  if (raw === undefined) {
    return DEFAULT_COALESCE_INTERVAL_MS;
  }
  if (!/^\d+$/.test(raw)) {
    throw new Error(
      "KNOWDEX_COALESCE_INTERVAL_MS must be a nonnegative integer",
    );
  }

  const intervalMs = Number(raw);
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 0) {
    throw new Error(
      "KNOWDEX_COALESCE_INTERVAL_MS must be a safe nonnegative integer",
    );
  }
  return intervalMs;
}
/**
 * Per-document broadcast rate limit.
 * Capacity: 200 messages burst, Refill: 200/s.
 * This prevents a single room from saturating the event loop/network
 * even if multiple clients are typing simultaneously.
 */
const DOC_LIMIT_CAPACITY = 200;
const DOC_LIMIT_REFILL = 200;

interface CoalesceBuffer {
  updates: Uint8Array[];
  flushTimer: NodeJS.Timeout | null;
  senders: Set<string>;
}

export class CoalesceBufferManager {
  private buffers = new Map<string, CoalesceBuffer>();
  private docBuckets = new Map<string, TokenBucket>();
  private documentManager: DocumentUpdater;
  private roomManager: UpdateBroadcaster;
  private redisTransport: UpdatePublisher;
  private intervalMs: number;

  constructor(
    documentManager: DocumentUpdater,
    roomManager: UpdateBroadcaster,
    redisTransport: UpdatePublisher,
    intervalMs = readCoalesceIntervalMs(),
  ) {
    this.documentManager = documentManager;
    this.roomManager = roomManager;
    this.redisTransport = redisTransport;
    this.intervalMs = intervalMs;
  }

  public getIntervalMs(): number {
    return this.intervalMs;
  }

  /**
   * Enqueues an update for a document.
   * Flushes after the configured interval (one animation frame by default).
   */
  public enqueueUpdate(
    docId: string,
    update: Uint8Array,
    originClientId?: string,
  ): void {
    let buffer = this.buffers.get(docId);

    if (!buffer) {
      buffer = {
        updates: [],
        flushTimer: null,
        senders: new Set<string>(),
      };
      this.buffers.set(docId, buffer);
    }

    buffer.updates.push(update);
    if (originClientId) buffer.senders.add(originClientId);

    if (this.intervalMs === 0) {
      void this.flushBuffer(docId);
    } else if (!buffer.flushTimer) {
      buffer.flushTimer = setTimeout(() => {
        void this.flushBuffer(docId);
      }, this.intervalMs);
    }
  }

  /**
   * Handles updates received from other instances via Redis Pub/Sub.
   * Applied directly to the document and broadcasted to all local clients.
   * External updates are subject to the same document-level rate limiting.
   */
  public async handleExternalUpdate(
    docId: string,
    update: Uint8Array,
    originClientId: string,
  ): Promise<void> {
    // External updates don't use the coalesce buffer because they are
    // already coalesced by the originating instance.
    // However, we apply directly but must respect the local room's broadcast limit.

    const bucket = this.getDocBucket(docId);
    if (!bucket.consume()) {
      // If doc-level rate limited, we redirect to the coalesce buffer to delay
      this.enqueueUpdate(docId, update);
      return;
    }

    const applyResult = await this.documentManager.applyUpdate(docId, update);
    if (!applyResult.ok) {
      console.error(
        `Failed to apply external update for ${docId}:`,
        applyResult.error.message,
      );
      return;
    }

    const encodedMsg = encodeMessage({
      type: "update",
      update: update,
    });

    await this.roomManager.broadcast(docId, encodedMsg);
  }

  private getDocBucket(docId: string): TokenBucket {
    let bucket = this.docBuckets.get(docId);
    if (!bucket) {
      bucket = new TokenBucket(DOC_LIMIT_CAPACITY, DOC_LIMIT_REFILL);
      this.docBuckets.set(docId, bucket);
    }
    return bucket;
  }

  /**
   * Merges all queued updates for a document and applies them to the document manager
   * and broadcasts to all connected clients.
   */
  private async flushBuffer(docId: string): Promise<void> {
    const buffer = this.buffers.get(docId);
    if (!buffer || buffer.updates.length === 0) {
      this.buffers.delete(docId);
      return;
    }

    // DOCUMENT-LEVEL RATE LIMITING: COALESCE-AND-DELAY
    // If the document bucket is empty, we do NOT drop. We delay the flush.
    // This preserves CRDT consistency while protecting the system.
    const bucket = this.getDocBucket(docId);
    if (!bucket.consume()) {
      buffer.flushTimer = setTimeout(
        () => {
          void this.flushBuffer(docId);
        },
        Math.max(1, this.intervalMs),
      );
      return;
    }

    const updatesToFlush = buffer.updates;
    const senders = buffer.senders;

    buffer.updates = [];
    buffer.senders = new Set<string>();
    buffer.flushTimer = null;

    try {
      // 1. Merge updates into a single Y.js update using shared utility
      const mergedUpdate = mergeUpdates(updatesToFlush);

      // 2. Apply merged update once to the server doc
      const applyResult = await this.documentManager.applyUpdate(
        docId,
        mergedUpdate,
      );
      if (!applyResult.ok) {
        console.error(
          `Failed to apply merged update for ${docId}:`,
          applyResult.error.message,
        );
        return;
      }

      // 3. Broadcast merged update once to all local clients in the room
      const encodedMsg = encodeMessage({
        type: "update",
        update: mergedUpdate,
      });

      const excludeClientId =
        senders.size === 1 ? Array.from(senders)[0] : undefined;
      await this.roomManager.broadcast(docId, encodedMsg, excludeClientId);

      // 4. Redis Publish — fire and forget
      const primaryOriginId = Array.from(senders)[0] || "server-merged";
      this.redisTransport.publish(docId, mergedUpdate, primaryOriginId);
    } catch (error) {
      console.error(`Error during coalescing flush for ${docId}:`, error);
    } finally {
      if (buffer.updates.length === 0) {
        this.buffers.delete(docId);
      }
    }
  }

  /**
   * Forces an immediate flush of all pending buffers.
   * Useful during graceful shutdown.
   */
  public async flushAll(): Promise<void> {
    const docIds = Array.from(this.buffers.keys());
    await Promise.all(docIds.map((id) => this.flushBuffer(id)));
  }
}
