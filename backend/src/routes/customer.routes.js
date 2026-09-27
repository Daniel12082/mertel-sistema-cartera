import express from "express";
import {
  getCustomers,
  createCustomer,
} from "../controllers/customer.controller.js";

const router = express.Router();

router.get("/", getCustomers);
router.post("/", createCustomer);

export default router;