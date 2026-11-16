import { WebSocket } from "ws";
import { TokenBucket } from "./token-bucket.js";
import { ConnectionContext as SharedConnectionContext } from "@repo/types";
import { decodeMessage } from "./protocol.js";

/**
 * 1MB Backpressure Threshold.
 * If a client's kernel send buffer exceeds this, we skip updates to prevent
 * Head-of-Line (HOL) blocking across the entire room.
 */
const MAX_BUFFER_BYTES = 1_048_576;

export interface ConnectionContext extends SharedConnectionContext {
  ws: WebSocket;
  bucket: TokenBucket;
  benchRole?: string;
}

/**
 * Minimal interface for DocumentManager to avoid tight coupling.
 */
export interface IDocumentRegistry {
  incrementClients(docId: string): Promise<any>;
  decrementClients(docId: string): Promise<any>;
}

export interface Logger {
  info(ctx: any, msg: string): void;
  warn(ctx: any, msg: string): void;
  error(ctx: any, msg: string): void;
}

export interface OutboundUpdateStats {
  frames: number;
  bytes: number;
}

export class RoomManager {
  // Registry: Map<docId, Map<clientId, ConnectionContext>>
  private registry = new Map<string, Map<string, ConnectionContext>>();
  private documentManager: IDocumentRegistry;
  private logger: Logger;
  private outboundUpdateStats = new Map<string, OutboundUpdateStats>();

  constructor(documentManager: IDocumentRegistry, logger: Logger) {
    this.documentManager = documentManager;
    this.logger = logger;
  }

  /**
   * Adds a client to a room.
   * Idempotent: If clientId already exists, the context is updated (handles reconnects).
   */
  public async join(docId: string, ctx: ConnectionContext): Promise<void> {
    let room = this.registry.get(docId);
    if (!room) {
      room = new Map<string, ConnectionContext>();
      this.registry.set(docId, room);
    }

    const isNewToRoom = !room.has(ctx.clientId);
    room.set(ctx.clientId, ctx);

    if (isNewToRoom) {
      await this.documentManager.incrementClients(docId);
      this.logger.info(
        { docId, clientId: ctx.clientId, roomSize: room.size },
        "room:joined",
      );
    }
  }

  /**
   * Removes a client from a room.
   * Idempotent: Safe to call multiple times for the same clientId.
   * Prevents memory leaks by deleting empty room maps.
   */
  public async leave(docId: string, clientId: string): Promise<void> {
    const room = this.registry.get(docId);
    if (!room) return;

    if (room.has(clientId)) {
      room.delete(clientId);
      await this.documentManager.decrementClients(docId);

      const newSize = room.size;
      if (newSize === 0) {
        this.registry.delete(docId);
      }

      this.logger.info({ docId, clientId, roomSize: newSize }, "room:left");
    }
  }

  /**
   * Broadcasts a binary update to all healthy clients in a room.
   * Uses Promise.allSettled to ensure one slow/dead client doesn't block others.
   */
  public async broadcast(
    docId: string,
    update: Uint8Array,
    excludeClientId?: string,
  ): Promise<void> {
    const room = this.registry.get(docId);
    if (!room) return;

    const clients = Array.from(room.values());

    await Promise.allSettled(
      clients
        .filter((ctx) => ctx.clientId !== excludeClientId)
        .filter((ctx) => ctx.ws.readyState === WebSocket.OPEN)
        .map((ctx) => this.safeSend(ctx, update)),
    );
  }

  /**
   * Specific broadcast for awareness (presence) data.
   */
  public async broadcastAwareness(
    docId: string,
    state: Uint8Array,
    excludeClientId: string,
  ): Promise<void> {
    return this.broadcast(docId, state, excludeClientId);
  }

  /**
   * Sends a message with backpressure awareness.
   * If the OS TCP buffer is full, we skip the update.
   */
  private async safeSend(
    ctx: ConnectionContext,
    update: Uint8Array,
  ): Promise<void> {
    /**
     * HEAD-OF-LINE BLOCKING PREVENTION:
     * ws.bufferedAmount measures the bytes queued in the kernel send buffer.
     * If this is high, the client's TCP connection is congested.
     * Sending more data would only increase memory usage and latency for this client,
     * and potentially block the event loop for others if handled synchronously.
     */
    if (ctx.ws.bufferedAmount > MAX_BUFFER_BYTES) {
      this.logger.warn(
        { clientId: ctx.clientId, buffered: ctx.ws.bufferedAmount },
        "client:backpressure",
      );
      // We skip this update. Because of CRDT coalescing, the client will
      // receive the missing state in the next successful flush.
      return;
    }

    return new Promise((resolve, reject) => {
      ctx.ws.send(update, (err) => {
        if (err) {
          // Failure here usually means the socket closed during the attempt.
          // Promise.allSettled will catch this without affecting other clients.
          reject(err);
        } else {
          this.recordOutboundUpdate(ctx.benchRole ?? ctx.clientId, update);
          resolve();
        }
      });
    });
  }

  public getOutboundUpdateStats(
    rolePrefix?: string,
  ): Record<string, OutboundUpdateStats> {
    return Object.fromEntries(
      Array.from(this.outboundUpdateStats.entries())
        .filter(
          ([clientId]) =>
            rolePrefix === undefined || clientId.startsWith(rolePrefix),
        )
        .map(([clientId, stats]) => [clientId, { ...stats }]),
    );
  }

  public resetOutboundUpdateStats(): void {
    this.outboundUpdateStats.clear();
  }

  private recordOutboundUpdate(clientId: string, frame: Uint8Array): void {
    let messageType: string;
    try {
      messageType = decodeMessage(frame).type;
    } catch {
      return;
    }
    if (messageType !== "update") return;

    const current = this.outboundUpdateStats.get(clientId) ?? {
      frames: 0,
      bytes: 0,
    };
    current.frames += 1;
    current.bytes += frame.byteLength;
    this.outboundUpdateStats.set(clientId, current);
  }

  public getClientCount(docId: string): number {
    return this.registry.get(docId)?.size ?? 0;
  }

  public getRoomIds(): string[] {
    return Array.from(this.registry.keys());
  }
}

/**
 * --- ARCHITECTURAL EXPLANATION ---
 *
 * 1. Head-of-Line (HOL) Blocking:
 * In a collaborative system, a single slow receiver (due to poor network) can
 * cause the server to wait on a TCP ACK before proceeding with the next send
 * if handled sequentially. RoomManager solves this by using asynchronous
 * concurrent sends (Promise.allSettled) and backpressure checks.
 *
 * 2. bufferedAmount:
 * This property measures the number of bytes of data that have been queued
 * using send() but have not yet been transmitted to the network.
 * High bufferedAmount = Congested Client.
 *
 * 3. Why Promise.allSettled?
 * Promise.all fails fast—if one client's send fails (e.g., socket suddenly closed),
 * the entire broadcast would throw an error and stop. allSettled ensures we
 * attempt to reach every client regardless of individual failures.
 *
 * 4. Backpressure + Coalescing:
 * Because Y.js updates are idempotent and merging them captures the total state,
 * skipping a frame for a congested client is safe. They will "jump" to the
 * latest state on the next 16ms flush that their buffer can handle.
 */
