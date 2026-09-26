import express, { Router } from "express";
import { rateLimit } from "../middlewares/rateLimit.js";
import {
  getPublicAttachment,
  getPublicNote,
} from "../controllers/public.controller.js";

/** Unauthenticated, read-only. Rate limited per IP. */
const publicRouter: Router = express.Router();
publicRouter.use(rateLimit({ name: "public", max: 240, windowMs: 60_000 }));

publicRouter.get("/notes/:docId", getPublicNote);
publicRouter.get("/attachments/:docId/:attachmentId", getPublicAttachment);

export { publicRouter };
