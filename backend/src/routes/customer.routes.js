import express from "express";
import { requirePermission } from "../middleware/requirePermission.js";

import {
  getCustomers,
  createCustomer,
  getCustomerById,
  updateCustomer,
  deleteCustomer,
} from "../controllers/customer.controller.js";

const router = express.Router();

router.get("/", requirePermission("customers.view"), getCustomers);

router.post("/", requirePermission("customers.create"), createCustomer);

router.get("/:id", requirePermission("customers.view"), getCustomerById);

router.put("/:id", requirePermission("customers.update"), updateCustomer);

router.delete("/:id", requirePermission("customers.delete"), deleteCustomer);

export default router;
