import "./env.js";
import { createServer, type IncomingMessage } from "http";
import { randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import { WebSocketServer, WebSocket } from "ws";
import type { Duplex } from "stream";

import { DocumentManager } from "./document-manager.js";
import { PrismaRepository, PersistenceService, prisma } from "@repo/db";
import { GeminiAIService } from "./ai-service.js";

// PORT is injected by Heroku; WS_PORT is used by docker-compose and local dev.
const PORT = parseInt(process.env.PORT ?? process.env.WS_PORT ?? "8080", 10);
const HEARTBEAT_INTERVAL = 30_000;
const HEARTBEAT_TIMEOUT = 10_000;
const HEARTBEAT_SCAN_INTERVAL = 1_000;
const DOCUMENT_PATH_PREFIX = "/ws/documents/";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

import { encodeMessage, WSMessage, WSErrorCode } from "./protocol.js";
import { CoalesceBufferManager } from "./coalesce-buffer.js";
import { RoomManager, type ConnectionContext } from "./room-manager.js";
import { RedisTransport } from "./redis-transport.js";
import { TokenBucket } from "./token-bucket.js";
import { SecurityMiddleware } from "./security-middleware.js";
import { InsertPosition } from "@repo/types";

/** Per-connection token bucket: burst + sustained msgs/sec (selection/cursors can spike). */
const CLIENT_LIMIT_CAPACITY = parseInt(
  process.env.WS_CLIENT_RATE_CAPACITY ?? "220",
  10,
);
const CLIENT_LIMIT_REFILL = parseInt(
  process.env.WS_CLIENT_RATE_REFILL ?? "180",
  10,
);

const loggerInstance = {
  info: (ctx: any, msg: string) => logger("info", ctx, msg),
  warn: (ctx: any, msg: string) => logger("warn", ctx, msg),
  error: (ctx: any, msg: string) => logger("error", ctx, msg),
};

const repository = new PrismaRepository();
const persistenceService = new PersistenceService(repository, loggerInstance);

const documentManager = new DocumentManager({
  loadSnapshot: async (docId) => {
    const result = await repository.load(docId);
    return result?.state ?? null;
  },
  flushSnapshot: async (docId, state) => {
    // Immediate flush (used on destroy/eviction)
    await persistenceService.flush(docId, () => state);
  },
  onUpdate: (docId) => {
    // Debounced flush (used on every change)
    persistenceService.scheduleWrite(docId, () => {
      const result = documentManager.getState(docId);
      return result.ok ? result.value : new Uint8Array();
    });
  },
  onError: (error) => {
    logger("error", { reason: error.message }, "document manager error");
  },
});

const aiService = new GeminiAIService(documentManager);

type AuthResult =
  | { success: true; userId: string; docId: string }
  | { success: false; reason: string; httpCode: 401 | 403 };

type UpgradeMiddleware = (req: IncomingMessage) => Promise<AuthResult>;

interface JwtPayload {
  id: string;
  iat?: number;
  exp?: number;
}

interface LoggerContext {
  clientId?: string;
  docId?: string;
  userId?: string;
  reason?: string;
  connectedAt?: number;
  isOfflineClient?: boolean;
  documentWasWarm?: boolean;
}

// Prefer REDIS_HOST (GCP Memorystore) with namespacing; fall back to REDIS_URL for local dev.
const redisConfig = process.env.REDIS_HOST
  ? {
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT ?? "6379", 10),
      keyPrefix: "knowdex:",
    }
  : (process.env.REDIS_URL ?? "redis://localhost:6379");

const redisTransport = new RedisTransport(redisConfig, loggerInstance);
const roomManager = new RoomManager(documentManager, loggerInstance);
const coalesceManager = new CoalesceBufferManager(
  documentManager,
  roomManager,
  redisTransport,
);

const server = createServer((req, res) => {
  // Lightweight health probe — no auth required
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  // Root route for initial GCP load balancers handshake
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200);
    res.end("OK");
    return;
  }

  // All other HTTP requests are not handled; WS upgrade handles the real traffic
  res.writeHead(404);
  res.end();
});
const wss = new WebSocketServer({ noServer: true });
const allConnections = new Map<string, ConnectionContext>();
const pendingHeartbeatAt = new Map<string, number>();
const lastPongAt = new Map<string, number>();
const authMiddleware = createUpgradeMiddleware(process.env.JWT_SECRET ?? "");

server.on("upgrade", async (req, socket, head) => {
  const authResult = await authMiddleware(req);
  if (!authResult.success) {
    rejectUpgrade(socket, authResult.httpCode);
    logger("warn", { reason: authResult.reason }, "upgrade rejected");
    return;
  }

  const { userId, docId } = authResult;

  try {
    const wasAlreadyWarm = documentManager.has(docId);
    // The socket stays unopened until the document is ready so the client never races an empty state load.
    await documentManager.getOrCreate(docId);

    logger(
      "info",
      { docId, userId, documentWasWarm: wasAlreadyWarm },
      "document prewarmed before websocket upgrade",
    );
  } catch (error: unknown) {
    rejectUpgrade(socket, 403);
    logger(
      "error",
      { docId, userId, reason: "document prewarm failed" },
      "upgrade rejected",
    );
    return;
  }

  const clientId = randomUUID();
  const isOfflineClient = req.headers["x-client-state"] === "offline-reconnect";

  wss.handleUpgrade(req, socket, head, (ws) => {
    const ctx: ConnectionContext = {
      ws,
      userId,
      docId,
      clientId,
      connectedAt: Date.now(),
      isAlive: true,
      isOfflineClient,
      bucket: new TokenBucket(CLIENT_LIMIT_CAPACITY, CLIENT_LIMIT_REFILL),
    };

    void registerConnection(ctx).then((registered) => {
      if (registered) {
        handleConnection(ws, ctx);
        return;
      }

      ws.terminate();
    });
  });
});

function handleConnection(ws: WebSocket, ctx: ConnectionContext): void {
  logger(
    "info",
    { clientId: ctx.clientId, docId: ctx.docId, userId: ctx.userId },
    "connection established",
  );

  // Phase 1 of Sync Handshake: Server sends its state vector to the client
  const serverStateVectorResult = documentManager.getStateVector(ctx.docId);
  if (serverStateVectorResult.ok) {
    ws.send(
      encodeMessage({
        type: "sync-step-1",
        stateVector: serverStateVectorResult.value,
      }),
    );
  }

  ws.on("message", async (data) => {
    // 1. Check Message Size
    if (!SecurityMiddleware.checkMessageSize(data)) {
      ws.send(
        encodeMessage({
          type: "error",
          code: "MESSAGE_TOO_LARGE",
          message: "Message exceeds 512KB safety limit",
        }),
      );
      return;
    }

    // 2. Check Per-Client Rate Limit
    if (!SecurityMiddleware.checkRateLimit(ctx)) {
      ws.send(
        encodeMessage({
          type: "error",
          code: "RATE_LIMITED",
          message: `Exceeded message rate limit (~${CLIENT_LIMIT_REFILL}/s sustained; reduce edits or reconnect)`,
        }),
      );
      return;
    }

    // 3. Parse and Validate Protocol
    const message = SecurityMiddleware.parseMessage(data);
    if (!message) {
      ws.send(
        encodeMessage({
          type: "error",
          code: "INVALID_MESSAGE",
          message: "Malformed protocol frame",
        }),
      );
      return;
    }

    try {
      switch (message.type) {
        case "ping":
          ws.send(encodeMessage({ type: "pong" }));
          break;

        case "sync-step-1": {
          // Phase 2: Client sent its state vector.
          // Server computes the diff and sends it back (Step 2).
          const diffResult = await documentManager.getUpdateSince(
            ctx.docId,
            message.stateVector,
          );
          if (diffResult.ok) {
            ws.send(
              encodeMessage({
                type: "sync-step-2",
                update: diffResult.value,
              }),
            );
          }
          break;
        }

        case "sync-step-2":
        case "update":
        case "ai-update": {
          // Apply to local doc and broadcast via coalesce buffer
          coalesceManager.enqueueUpdate(
            ctx.docId,
            message.update,
            ctx.clientId,
          );
          break;
        }

        case "awareness": {
          // Awareness is volatile and usually not persisted,
          // we broadcast it immediately with backpressure handling.
          const encoded = encodeMessage(message);
          void roomManager.broadcastAwareness(ctx.docId, encoded, ctx.clientId);
          break;
        }

        case "ai-request": {
          try {
            const generator = aiService.startWriting({
              docId: ctx.docId,
              prompt: message.prompt,
              insertPosition: message.insertPosition,
              requestId: message.requestId,
              userId: ctx.userId,
            });

            // Process the AI stream without blocking the main socket message loop
            void (async () => {
              try {
                for await (const chunk of generator) {
                  if (chunk.isDone) {
                    // Notify the requesting client that the stream is complete.
                    // The client will have inserted all content via Tiptap, which
                    // then propagates to other collaborators via Y.Doc sync.
                    ws.send(
                      encodeMessage({
                        type: "ai-update",
                        update: new Uint8Array(0),
                        text: "",
                        requestId: chunk.requestId,
                        isDone: true,
                      }),
                    );
                    persistenceService.scheduleWrite(ctx.docId, () => {
                      const res = documentManager.getState(ctx.docId);
                      return res.ok ? res.value : new Uint8Array();
                    });
                    break;
                  }

                  // Send raw text token to requesting client only.
                  // The client accumulates tokens and inserts them via
                  // Tiptap's Markdown extension so formatting is preserved.
                  ws.send(
                    encodeMessage({
                      type: "ai-update",
                      update: new Uint8Array(0),
                      text: chunk.text,
                      requestId: chunk.requestId,
                      isDone: false,
                    }),
                  );
                }
              } catch (e: unknown) {
                console.error("[AI Service Error]", e);
                let errorMsg = "AI generation failed";
                let code: WSErrorCode = "INVALID_UPDATE";

                if (e instanceof Error) {
                  errorMsg = e.message;
                  if (e.message.includes("RATE_LIMITED")) {
                    code = "RATE_LIMITED";
                  } else if (e.message.includes("API key")) {
                    errorMsg = "Invalid or missing GEMINI_API_KEY";
                    code = "INVALID_UPDATE";
                  } else if (e.message.includes("safety filters")) {
                    code = "INVALID_UPDATE";
                  } else if (e.message.includes("stream error")) {
                    code = "AI_UNAVAILABLE";
                  }
                }

                ws.send(
                  encodeMessage({
                    type: "error",
                    code,
                    message: errorMsg,
                  }),
                );
              }
            })();
          } catch (e: unknown) {
            ws.send(
              encodeMessage({
                type: "error",
                code: "RATE_LIMITED",
                message: e instanceof Error ? e.message : "Rate limited",
              }),
            );
          }
          break;
        }

        case "ai-cancel": {
          aiService.cancelWriting(message.requestId);
          break;
        }
      }
    } catch (err) {
      logger(
        "error",
        { clientId: ctx.clientId, reason: "internal error" },
        "unexpected failure in message loop",
      );
    }
  });
}

const heartbeatInterval = setInterval(() => {
  const now = Date.now();

  for (const [clientId, ctx] of allConnections) {
    const heartbeatStartedAt = pendingHeartbeatAt.get(clientId);

    if (
      heartbeatStartedAt !== undefined &&
      now - heartbeatStartedAt >= HEARTBEAT_TIMEOUT &&
      !ctx.isAlive
    ) {
      logger(
        "warn",
        { clientId, docId: ctx.docId, userId: ctx.userId },
        "zombie connection terminated",
      );

      ctx.ws.terminate();
      void roomManager.leave(ctx.docId, clientId);
      allConnections.delete(clientId);
      pendingHeartbeatAt.delete(clientId);
      lastPongAt.delete(clientId);
      continue;
    }

    const lastSeenAt = lastPongAt.get(clientId) ?? ctx.connectedAt;
    if (
      heartbeatStartedAt === undefined &&
      now - lastSeenAt >= HEARTBEAT_INTERVAL
    ) {
      ctx.isAlive = false;
      pendingHeartbeatAt.set(clientId, now);
      ctx.ws.ping();
    }
  }
}, HEARTBEAT_SCAN_INTERVAL);

wss.on("close", () => {
  clearInterval(heartbeatInterval);
});

server.listen(PORT, () => {
  logger("info", {}, `WebSocket server is running on ws://localhost:${PORT}`);
});

async function shutdown() {
  loggerInstance.info({}, "persistence:shutdown-flush-start");

  // Stop accepting new connections
  server.close();
  wss.close();

  // 1. Flush any pending coalesce buffers to DocumentManager
  await coalesceManager.flushAll();

  // 2. Flush all dirty documents from DocumentManager to DB
  await persistenceService.flushAll((docId) => {
    const result = documentManager.getState(docId);
    return result.ok ? result.value : null;
  });

  loggerInstance.info({}, "persistence:shutdown-flush-complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

function createUpgradeMiddleware(jwtSecret: string): UpgradeMiddleware {
  return async (req: IncomingMessage): Promise<AuthResult> => {
    if (jwtSecret.length === 0) {
      return { success: false, reason: "missing jwt secret", httpCode: 401 };
    }

    const token = extractBearerToken(req);
    if (token === null) {
      return { success: false, reason: "missing bearer token", httpCode: 401 };
    }

    const docId = extractDocumentId(req);
    if (docId === null) {
      return { success: false, reason: "invalid document path", httpCode: 403 };
    }

    const userId = verifyToken(token, jwtSecret);
    if (userId === null) {
      return { success: false, reason: "invalid bearer token", httpCode: 401 };
    }

    // Permission Check: Verify user has access to this document
    const content = await prisma.content.findUnique({
      where: { id: docId },
      select: {
        userId: true,
        workspaceId: true,
        isPublic: true,
        workspace: {
          select: {
            isPublic: true,
            members: {
              where: { userId },
              select: { userId: true },
            },
          },
        },
      },
    });

    if (!content) {
      return { success: false, reason: "document not found", httpCode: 403 };
    }

    if (content.userId !== userId) {
      const isPublicDoc = content.isPublic === true;
      const isPublicWs = content.workspace?.isPublic === true;
      const isMember = (content.workspace?.members?.length ?? 0) > 0;

      if (!isMember && !isPublicDoc && !isPublicWs) {
        return {
          success: false,
          reason: "forbidden: access denied",
          httpCode: 403,
        };
      }
    }

    return { success: true, userId, docId };
  };
}

async function registerConnection(ctx: ConnectionContext): Promise<boolean> {
  ctx.ws.on("pong", () => {
    ctx.isAlive = true;
    pendingHeartbeatAt.delete(ctx.clientId);
    lastPongAt.set(ctx.clientId, Date.now());
  });

  const cleanup = (): void => {
    void (async () => {
      await roomManager.leave(ctx.docId, ctx.clientId);
      if (roomManager.getClientCount(ctx.docId) === 0) {
        await redisTransport.unsubscribe(ctx.docId);
      }
      allConnections.delete(ctx.clientId);
      pendingHeartbeatAt.delete(ctx.clientId);
      lastPongAt.delete(ctx.clientId);
    })();
  };

  // Cleanup stays at the connection boundary so transport failures cannot leave stale room membership behind.
  ctx.ws.on("close", cleanup);
  ctx.ws.on("error", cleanup);

  await roomManager.join(ctx.docId, ctx);

  // Subscribe when the first local client joins the document room
  if (roomManager.getClientCount(ctx.docId) === 1) {
    await redisTransport.subscribe(ctx.docId, (update, originId) => {
      void coalesceManager.handleExternalUpdate(ctx.docId, update, originId);
    });
  }

  if (ctx.ws.readyState !== WebSocket.OPEN) {
    await roomManager.leave(ctx.docId, ctx.clientId);
    if (roomManager.getClientCount(ctx.docId) === 0) {
      await redisTransport.unsubscribe(ctx.docId);
    }
    return false;
  }

  allConnections.set(ctx.clientId, ctx);
  lastPongAt.set(ctx.clientId, ctx.connectedAt);

  return true;
}

function extractBearerToken(req: IncomingMessage): string | null {
  const authorization = req.headers.authorization;

  if (typeof authorization === "string") {
    const [scheme, token] = authorization.split(" ");
    if (scheme === "Bearer" && typeof token === "string" && token.length > 0) {
      return token;
    }
  }

  const url = getRequestUrl(req);
  const token = url.searchParams.get("token");

  return token && token.length > 0 ? token : null;
}

function extractDocumentId(req: IncomingMessage): string | null {
  const url = getRequestUrl(req);
  if (!url.pathname.startsWith(DOCUMENT_PATH_PREFIX)) {
    return null;
  }

  const docId = url.pathname.slice(DOCUMENT_PATH_PREFIX.length);

  return UUID_PATTERN.test(docId) ? docId : null;
}

function getRequestUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? "", "http://localhost");
}

function verifyToken(token: string, jwtSecret: string): string | null {
  try {
    const decoded = jwt.verify(token, jwtSecret);
    if (typeof decoded !== "object" || decoded === null || !("id" in decoded)) {
      return null;
    }

    const { id } = decoded as JwtPayload;
    return typeof id === "string" && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

function rejectUpgrade(socket: Duplex, httpCode: 401 | 403): void {
  const statusLine = httpCode === 401 ? "401 Unauthorized" : "403 Forbidden";
  socket.write(`HTTP/1.1 ${statusLine}\r\n\r\n`);
  socket.destroy();
}

function logger(
  level: "info" | "warn" | "error",
  context: LoggerContext,
  message: string,
): void {
  console.log(
    JSON.stringify({
      level,
      ...context,
      message,
      timestamp: new Date().toISOString(),
    }),
  );
}
