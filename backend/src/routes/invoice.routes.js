import express from "express";
import { requirePermission } from "../middleware/requirePermission.js";
import {
  getInvoices,
  getInvoiceById,
  createInvoice,
  updateInvoice,
  deleteInvoice,
  voidInvoice,
  markPaid,
  getHistory,
} from "../controllers/invoice.controller.js";

const router = express.Router();

router.get("/", requirePermission("invoices.view"), getInvoices);
router.post("/", requirePermission("invoices.create"), createInvoice);
router.get("/:id", requirePermission("invoices.view"), getInvoiceById);
router.get("/:id/history", requirePermission("invoices.view"), getHistory);
router.post("/:id/paid", requirePermission("invoices.update"), requirePermission("payments.create"), requirePermission("payment_allocations.create"), markPaid);
router.put("/:id", requirePermission("invoices.update"), updateInvoice);
router.post("/:id/void", requirePermission("invoices.delete"), voidInvoice);
router.delete("/:id", requirePermission("invoices.delete"), deleteInvoice);

export default router;
