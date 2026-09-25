import express, { Router } from "express";
import { protect } from "../middlewares/auth.middleware.js";
import { getSharedBrain, shareBrain } from "../controllers/brain.controller.js";

const brainRouter: Router = express.Router();

brainRouter.post("/share", protect, shareBrain); //Share your brain (protected)
brainRouter.get("/:shareLink", getSharedBrain); //Get Someone else's brain (public)

export { brainRouter };
