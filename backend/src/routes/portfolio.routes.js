import express from "express";
import {
  getCustomerPortfolioById,
  getPortfolio,
  getPortfolioByCustomer,
  getPortfolioReconciliation,
  getPortfolioSummary,
} from "../controllers/portfolio.controller.js";

const router = express.Router();

router.get("/summary", getPortfolioSummary);
router.get("/customers", getPortfolioByCustomer);
router.get("/reconciliation", getPortfolioReconciliation);
router.get("/customer/:customerId", getCustomerPortfolioById);
router.get("/", getPortfolio);

export default router;
