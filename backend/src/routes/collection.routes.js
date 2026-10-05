import express from "express";
import { requirePermission } from "../middleware/requirePermission.js";
import { getCollection } from "../controllers/collection.controller.js";
import { collectionOperationController } from "../controllers/collectionOperations.controller.js";

const router = express.Router();
router.use(requirePermission("collection.view"));
router.get("/", getCollection);
router.get("/customers/:customerId/actions", collectionOperationController("action"));
router.post("/customers/:customerId/actions", requirePermission("collection.manage"), collectionOperationController("action", true));
router.get("/customers/:customerId/promises", collectionOperationController("promise"));
router.post("/customers/:customerId/promises", requirePermission("collection.manage"), collectionOperationController("promise", true));

export default router;
