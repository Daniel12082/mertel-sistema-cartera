import express from "express";
import { requirePermission } from "../middleware/requirePermission.js";
import { getCollection } from "../controllers/collection.controller.js";
import { collectionOperationController } from "../controllers/collectionOperations.controller.js";
import { collectionMessageController } from "../controllers/collectionMessages.controller.js";
import { activateTemplate, createTemplate, deactivateTemplate, listTemplates, updateTemplate } from "../controllers/messageTemplatesAdmin.controller.js";

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
router.get("/message-templates", requirePermission("message_templates.manage"), listTemplates);
router.post("/message-templates", requirePermission("message_templates.manage"), createTemplate);
router.put("/message-templates/:templateId", requirePermission("message_templates.manage"), updateTemplate);
router.post("/message-templates/:templateId/activate", requirePermission("message_templates.manage"), activateTemplate);
router.post("/message-templates/:templateId/deactivate", requirePermission("message_templates.manage"), deactivateTemplate);

export default router;
