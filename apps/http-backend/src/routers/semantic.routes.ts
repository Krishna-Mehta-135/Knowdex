import express, { Router } from "express";
import { importNotes } from "../controllers/import.controller.js";
import { rateLimit } from "../middlewares/rateLimit.js";
import { protect } from "../middlewares/auth.middleware.js";
import {
  askWorkspace,
  clipUrl,
  deleteAttachment,
  downloadAttachment,
  getIndexStatus,
  createVersion,
  getRelated,
  getVersion,
  listVersions,
  getUnlinkedMentions,
  getWorkspaceGraph,
  linkPreview,
  semanticSearch,
  uploadAttachment,
} from "../controllers/semantic.controller.js";

const semanticRouter: Router = express.Router();
semanticRouter.use(protect);

const limits = {
  ask: rateLimit({ name: "ask", max: 20, windowMs: 60_000 }),
  search: rateLimit({ name: "search", max: 90, windowMs: 60_000 }),
  fetch: rateLimit({ name: "web fetch", max: 20, windowMs: 60_000 }),
  bulk: rateLimit({ name: "import", max: 10, windowMs: 10 * 60_000 }),
  upload: rateLimit({ name: "upload", max: 30, windowMs: 60_000 }),
  version: rateLimit({ name: "version", max: 20, windowMs: 60_000 }),
};

semanticRouter.get("/workspaces/:workspaceId/graph", getWorkspaceGraph);
semanticRouter.get("/workspaces/:workspaceId/index-status", getIndexStatus);
semanticRouter.post(
  "/workspaces/:workspaceId/search",
  limits.search,
  semanticSearch,
);
semanticRouter.post("/workspaces/:workspaceId/ask", limits.ask, askWorkspace);

semanticRouter.get("/documents/:docId/related", getRelated);
semanticRouter.get("/documents/:docId/unlinked-mentions", getUnlinkedMentions);
semanticRouter.get("/documents/:docId/versions", listVersions);
semanticRouter.post(
  "/documents/:docId/versions",
  limits.version,
  createVersion,
);
semanticRouter.get("/documents/:docId/versions/:versionId", getVersion);

semanticRouter.post(
  "/attachments",
  limits.upload,
  express.raw({ type: () => true, limit: "21mb" }),
  uploadAttachment,
);
semanticRouter.get("/attachments/:attachmentId", downloadAttachment);
semanticRouter.delete("/attachments/:attachmentId", deleteAttachment);

semanticRouter.post("/import", limits.bulk, importNotes);
semanticRouter.post("/clip", limits.fetch, clipUrl);
semanticRouter.post("/link-preview", limits.fetch, linkPreview);

export { semanticRouter };
