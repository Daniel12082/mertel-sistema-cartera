import express from "express";
import { roleCatalog } from "../config/permissions.js";
import { requirePermission } from "../middleware/requirePermission.js";
const router = express.Router();
router.get("/roles", requirePermission("roles.view"), (req, res) => {
  res.set("Cache-Control", "no-store");
  return res.json({ success: true, data: roleCatalog() });
});
export default router;
