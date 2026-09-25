import express, { Router } from "express";
import { protect } from "../middlewares/auth.middleware.js";
import {
  askWorkspace,
  clipUrl,
  deleteAttachment,
  downloadAttachment,
  getIndexStatus,
  getRelated,
  getUnlinkedMentions,
  getWorkspaceGraph,
  linkPreview,
  semanticSearch,
  uploadAttachment,
} from "../controllers/semantic.controller.js";

const semanticRouter: Router = express.Router();
semanticRouter.use(protect);

semanticRouter.get("/workspaces/:workspaceId/graph", getWorkspaceGraph);
semanticRouter.get("/workspaces/:workspaceId/index-status", getIndexStatus);
semanticRouter.post("/workspaces/:workspaceId/search", semanticSearch);
semanticRouter.post("/workspaces/:workspaceId/ask", askWorkspace);

semanticRouter.get("/documents/:docId/related", getRelated);
semanticRouter.get("/documents/:docId/unlinked-mentions", getUnlinkedMentions);

semanticRouter.post(
  "/attachments",
  express.raw({ type: () => true, limit: "21mb" }),
  uploadAttachment,
);
semanticRouter.get("/attachments/:attachmentId", downloadAttachment);
semanticRouter.delete("/attachments/:attachmentId", deleteAttachment);

semanticRouter.post("/clip", clipUrl);
semanticRouter.post("/link-preview", linkPreview);

export { semanticRouter };
