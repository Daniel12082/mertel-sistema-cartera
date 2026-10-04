import express from "express";
import { requirePermission } from "../middleware/requirePermission.js";
import { getCollection } from "../controllers/collection.controller.js";

const router = express.Router();
router.use(requirePermission("collection.view"));
router.get("/", getCollection);

export default router;
