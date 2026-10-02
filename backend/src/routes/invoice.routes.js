import express from "express";
import { requirePermission } from "../middleware/requirePermission.js";
import {
  getInvoices,
  getInvoiceById,
  createInvoice,
  updateInvoice,
  deleteInvoice,
} from "../controllers/invoice.controller.js";

const router = express.Router();

router.get("/", requirePermission("invoices.view"), getInvoices);
router.post("/", requirePermission("invoices.create"), createInvoice);
router.get("/:id", requirePermission("invoices.view"), getInvoiceById);
router.put("/:id", requirePermission("invoices.update"), updateInvoice);
router.delete("/:id", requirePermission("invoices.delete"), deleteInvoice);

export default router;
