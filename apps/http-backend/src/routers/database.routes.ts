import express, { Router } from "express";
import { protect } from "../middlewares/auth.middleware.js";
import { rateLimit } from "../middlewares/rateLimit.js";
import {
  createDatabase,
  createRow,
  deleteDatabase,
  getDatabase,
  getRow,
  listDatabases,
  updateDatabase,
  updateRow,
} from "../controllers/database.controller.js";

const databaseRouter: Router = express.Router();
databaseRouter.use(protect);
// Cell edits are frequent; keep the ceiling generous but bounded.
databaseRouter.use(rateLimit({ name: "database", max: 600, windowMs: 60_000 }));

databaseRouter.get("/workspaces/:workspaceId/databases", listDatabases);
databaseRouter.post("/workspaces/:workspaceId/databases", createDatabase);
databaseRouter.get("/databases/:databaseId", getDatabase);
databaseRouter.patch("/databases/:databaseId", updateDatabase);
databaseRouter.delete("/databases/:databaseId", deleteDatabase);
databaseRouter.post("/databases/:databaseId/rows", createRow);
databaseRouter.get("/databases/:databaseId/rows/:rowId", getRow);
databaseRouter.patch("/databases/:databaseId/rows/:rowId", updateRow);

export { databaseRouter };
