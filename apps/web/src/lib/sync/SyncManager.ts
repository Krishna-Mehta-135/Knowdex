import * as Y from "yjs";
import { encodeStateVector, encodeStateAsUpdate } from "yjs";
import type { Awareness } from "y-protocols/awareness";
import type { WSMessage, InsertPosition } from "@repo/types";
import { db } from "./db";
import { encodeMessage, decodeMessage } from "./encode";

export type ConnectionStatus = "connecting" | "syncing" | "connected" | "error";

type Listener<T> = (value: T) => void;
type Unsubscribe = () => void;

export class SyncManager {
  public readonly doc: Y.Doc;
  public awareness: Awareness | null = null;

  private ws: WebSocket | null = null;
  private status: ConnectionStatus = "connecting";
  private syncComplete = false;
  private destroyed = false;
  /** Bumped by every init()/destroy() so stale async inits can bail out. */
  private lifecycle = 0;

  // Reconnect
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT = 10;
  private readonly BACKOFF_BASE = 1_000;
  private readonly BACKOFF_MAX = 30_000;

  // Snapshot debounce
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly SNAPSHOT_DEBOUNCE = 2_000;

  /** Batch local Yjs updates into fewer WS frames (avoids rate limits on large selections). */
  private pendingOutgoing: Uint8Array[] = [];
  private outgoingFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly OUTGOING_BATCH_MS = 24;

  // Event listeners
  private statusListeners = new Set<Listener<ConnectionStatus>>();
  private messageListeners = new Map<
    WSMessage["type"],
    Set<Listener<WSMessage>>
  >();

  constructor(
    public readonly docId: string,
    private readonly getToken: () => Promise<string>,
  ) {
    this.doc = new Y.Doc();
  }

  setAwareness(awareness: Awareness) {
    this.awareness = awareness;
  }

  async init(): Promise<void> {
    const gen = ++this.lifecycle;
    // 1. Restore from IndexedDB before connecting
    const saved = await db.getDocument(this.docId);
    // A destroy()/newer init() happened while we awaited: this run is stale.
    if (gen !== this.lifecycle) return;
    if (saved) {
      Y.applyUpdate(this.doc, saved.state);
    }

    // 2. Listen to local changes
    // (init() may run again after destroy() — React StrictMode remounts effects
    // in development — so this manager must be re-initialisable.)
    this.destroyed = false;
    this.doc.off("update", this.onLocalUpdate);
    this.doc.on("update", this.onLocalUpdate);

    // 3. Network events
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onOnline);
    }

    // 4. Connect
    this.connect();
  }

  private async connect(): Promise<void> {
    if (this.destroyed) return;

    try {
      const token = await this.getToken();
      const host =
        typeof window !== "undefined" ? window.location.hostname : "127.0.0.1";
      const resolvedHost = host === "localhost" ? "127.0.0.1" : host;
      // NEXT_PUBLIC_WS_URL is baked in at build time for production (wss://knowdex.me/ws).
      // Strip any trailing slash to avoid double-slash in the path.
      const wsBase = (
        process.env.NEXT_PUBLIC_WS_URL || `ws://${resolvedHost}:8080`
      ).replace(/\/$/, "");
      const url = `${wsBase}/ws/documents/${this.docId}?token=${encodeURIComponent(token)}`;

      this.ws = new WebSocket(url);
      this.ws.binaryType = "arraybuffer";

      this.ws.onopen = () => {
        if (this.destroyed) {
          this.ws?.close();
          return;
        }
        this.reconnectAttempts = 0;
        this.syncComplete = false;
        this.setStatus("syncing");

        this.send({
          type: "sync-step-1",
          stateVector: encodeStateVector(this.doc),
        });
      };

      this.ws.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        try {
          const msg = decodeMessage(new Uint8Array(event.data));
          this.handleMessage(msg);
        } catch (err) {
          console.error("[SyncManager] Failed to decode message:", err);
        }
      };

      this.ws.onclose = () => {
        this.syncComplete = false;
        this.setStatus("error");
        if (!this.destroyed) this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.setStatus("error");
      };
    } catch (err) {
      console.error("[SyncManager] Connection failed:", err);
      this.setStatus("error");
      this.scheduleReconnect();
    }
  }

  private handleMessage(msg: WSMessage): void {
    this.messageListeners.get(msg.type)?.forEach((fn) => fn(msg));

    switch (msg.type) {
      case "sync-step-1": {
        const diff = encodeStateAsUpdate(this.doc, msg.stateVector);
        this.send({ type: "sync-step-2", update: diff });
        break;
      }

      case "sync-step-2": {
        if (msg.update.length > 0) {
          Y.applyUpdate(this.doc, msg.update, "remote");
        }
        this.setStatus("connected");
        this.syncComplete = true;
        this.flushPendingUpdates();
        break;
      }

      case "update": {
        Y.applyUpdate(this.doc, msg.update, "remote");
        break;
      }

      case "awareness": {
        // Awareness updates are handled by AwarenessManager
        break;
      }

      case "ai-update": {
        // update is always empty now — Y.Doc is mutated client-side via Tiptap.
        // Guard retained for forward-compatibility if update gains content again.
        if (msg.update.length > 0) {
          Y.applyUpdate(this.doc, msg.update, "remote");
        }
        break;
      }

      case "error": {
        console.error(
          `[SyncManager] Server error: ${msg.code} — ${msg.message}`,
        );
        break;
      }

      case "ping": {
        this.send({ type: "pong" });
        break;
      }
    }
  }

  private async flushPendingUpdates(): Promise<void> {
    while (this.syncComplete && this.ws?.readyState === WebSocket.OPEN) {
      const pending = await db.getPendingUpdates(this.docId);
      if (!pending.length) break;
      const merged = Y.mergeUpdates(pending.map((p) => p.update));
      this.send({ type: "update", update: merged });
      for (const item of pending) {
        await db.deletePendingUpdate(item.id!);
      }
    }
  }

  private queueOutgoingUpdate(update: Uint8Array): void {
    this.pendingOutgoing.push(update);
    if (this.outgoingFlushTimer != null) return;
    this.outgoingFlushTimer = setTimeout(() => {
      this.outgoingFlushTimer = null;
      this.flushOutgoingBatch();
    }, this.OUTGOING_BATCH_MS);
  }

  private flushOutgoingBatch(): void {
    if (!this.pendingOutgoing.length) return;
    const merged = Y.mergeUpdates(this.pendingOutgoing);
    this.pendingOutgoing = [];
    if (this.syncComplete && this.ws?.readyState === WebSocket.OPEN) {
      this.send({ type: "update", update: merged });
    }
  }

  private scheduleSnapshot(): void {
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    this.snapshotTimer = setTimeout(async () => {
      const state = Y.encodeStateAsUpdate(this.doc);
      const stateVector = Y.encodeStateVector(this.doc);
      await db.saveDocument(this.docId, state, stateVector);
    }, this.SNAPSHOT_DEBOUNCE);
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.MAX_RECONNECT) {
      console.error("[SyncManager] Max reconnect attempts reached");
      this.setStatus("error");
      return;
    }
    const delay = Math.min(
      this.BACKOFF_BASE * Math.pow(2, this.reconnectAttempts),
      this.BACKOFF_MAX,
    );
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  // Public API

  send(msg: WSMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      // Cast to bypass TS complaining about SharedArrayBuffer vs ArrayBuffer incompatibility
      this.ws.send(encodeMessage(msg) as unknown as BufferSource);
    }
  }

  sendAIRequest(prompt: string, insertPosition: InsertPosition): string {
    const requestId = Math.random().toString(36).substring(7);
    this.send({
      type: "ai-request",
      prompt,
      insertPosition,
      requestId,
    });
    return requestId;
  }

  onMessage(
    type: WSMessage["type"],
    listener: Listener<WSMessage>,
  ): Unsubscribe {
    if (!this.messageListeners.has(type)) {
      this.messageListeners.set(type, new Set());
    }
    this.messageListeners.get(type)!.add(listener);
    return () => this.messageListeners.get(type)?.delete(listener);
  }

  onStatusChange(listener: Listener<ConnectionStatus>): Unsubscribe {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  private setStatus(s: ConnectionStatus): void {
    this.status = s;
    this.statusListeners.forEach((fn) => fn(s));
  }

  private onLocalUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === "remote") return;

    db.addPendingUpdate(this.docId, update);
    this.scheduleSnapshot();

    if (this.syncComplete && this.ws?.readyState === WebSocket.OPEN) {
      this.queueOutgoingUpdate(update);
    }
  };

  private onOnline = () => {
    if (!this.destroyed) this.connect();
  };

  destroy(): void {
    this.lifecycle++;
    this.destroyed = true;
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.onOnline);
    }
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    if (this.outgoingFlushTimer != null) {
      clearTimeout(this.outgoingFlushTimer);
      this.outgoingFlushTimer = null;
    }
    this.flushOutgoingBatch();
    this.ws?.close();
    this.ws = null;
    this.doc.off("update", this.onLocalUpdate);
    // The Y.Doc is intentionally not destroyed: init() can run again on the
    // same instance (StrictMode) and the doc is garbage-collected with it.
    this.statusListeners.clear();
    this.messageListeners.clear();
  }
}
