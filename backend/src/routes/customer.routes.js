import express from "express";

import {
  getCustomers,
  createCustomer,
  getCustomerById,
  updateCustomer,
  deleteCustomer,
} from "../controllers/customer.controller.js";

const router = express.Router();

router.get("/", getCustomers);

router.post("/", createCustomer);

router.get("/:id", getCustomerById);

router.put("/:id", updateCustomer);

router.delete("/:id", deleteCustomer);

export default router;