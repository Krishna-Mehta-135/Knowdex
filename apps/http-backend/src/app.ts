import "./env.js";
import express, { Express } from "express";
import cors from "cors";
import { authRouter } from "./routers/auth.routes.js";
import { contentRouter } from "./routers/content.routes.js";
import { brainRouter } from "./routers/brain.routes.js";
import { documentRouter } from "./routers/document.routes.js";
import { workspaceRouter } from "./routers/workspace.routes.js";
import { semanticRouter } from "./routers/semantic.routes.js";

const app: Express = express();

// 1. Tell Express to trust the GCP Load Balancer
app.set("trust proxy", 1);

// CORS Configuration
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "https://knowdex.me",
      "https://api.knowdex.me",
      "https://canvassync.tech",
      process.env.FRONTEND_URL || "http://localhost:3000",
      /\.vercel\.app$/,
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    optionsSuccessStatus: 200,
  }),
);

// Bulk import carries whole vaults of Markdown; give it room before the
// default (small) JSON parser claims the request.
app.use("/api/v1/kx/import", express.json({ limit: "9mb" }));
app.use(express.json());

// Request Logger for debugging
app.use((req, res, next) => {
  console.log(`[Request] ${req.method} ${req.url}`);
  next();
});

// Health check — must be before auth middleware
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// Root route for initial GCP load balancers
app.get("/", (_req, res) => {
  res.sendStatus(200);
});

//Routes
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/content", contentRouter);
app.use("/api/v1/brain", brainRouter);
app.use("/api/v1/documents", documentRouter);
app.use("/api/v1/workspaces", workspaceRouter);
app.use("/api/v1/kx", semanticRouter);

// Global Error Handler
app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    console.error("[Fatal Error]", err);
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: err.message || "Internal Server Error",
      stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
    });
  },
);

// Catch-all for 404s
app.use((req, res) => {
  console.log(`[404] Not Found: ${req.method} ${req.url}`);
  res.status(404).json({ message: `Route ${req.method} ${req.url} not found` });
});

export { app };
