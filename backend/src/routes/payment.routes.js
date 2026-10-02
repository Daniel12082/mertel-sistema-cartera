import express from "express";
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

router.get("/", getPayments);
router.post("/", createPayment);
router.get("/:paymentId/allocations", getPaymentAllocations);
router.post("/:paymentId/allocations", createPaymentAllocation);
router.delete("/:paymentId/allocations/:allocationId", deletePaymentAllocation);
router.get("/:id", getPaymentById);
router.put("/:id", updatePayment);
router.delete("/:id", deletePayment);

export default router;
