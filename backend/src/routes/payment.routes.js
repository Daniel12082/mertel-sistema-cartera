import express from "express";
import { requirePermission } from "../middleware/requirePermission.js";
import {
  createPayment,
  createPaymentAllocation,
  deletePayment,
  deletePaymentAllocation,
  getPaymentAllocations,
  getPaymentById,
  getPayments,
  updatePayment,
} from "../controllers/payment.controller.js";

const router = express.Router();

router.get("/", requirePermission("payments.view"), getPayments);
router.post("/", requirePermission("payments.create"), createPayment);
router.get("/:paymentId/allocations", requirePermission("payment_allocations.view"), getPaymentAllocations);
router.post("/:paymentId/allocations", requirePermission("payment_allocations.create"), createPaymentAllocation);
router.delete("/:paymentId/allocations/:allocationId", requirePermission("payment_allocations.reverse"), deletePaymentAllocation);
router.get("/:id", requirePermission("payments.view"), getPaymentById);
router.put("/:id", requirePermission("payments.update"), updatePayment);
router.delete("/:id", requirePermission("payments.delete"), deletePayment);

export default router;
