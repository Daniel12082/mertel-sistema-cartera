import express from "express";
import { requirePermission } from "../middleware/requirePermission.js";
import { getCollection } from "../controllers/collection.controller.js";
import { collectionOperationController } from "../controllers/collectionOperations.controller.js";
import { collectionMessageController } from "../controllers/collectionMessages.controller.js";

const router = express.Router();
router.use(requirePermission("collection.view"));
router.get("/", getCollection);
router.get("/customers/:customerId/actions", collectionOperationController("action"));
router.post("/customers/:customerId/actions", requirePermission("collection.manage"), collectionOperationController("action", true));
router.get("/customers/:customerId/promises", collectionOperationController("promise"));
router.post("/customers/:customerId/promises", requirePermission("collection.manage"), collectionOperationController("promise", true));
router.get("/customers/:customerId/message-templates", requirePermission("collection.manage"), collectionMessageController("templates"));
router.post("/customers/:customerId/messages/preview", requirePermission("collection.manage"), collectionMessageController("preview"));
router.post("/customers/:customerId/messages/prepare", requirePermission("collection.manage"), collectionMessageController("prepare"));

export default router;
