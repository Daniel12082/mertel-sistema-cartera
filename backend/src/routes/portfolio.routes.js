import express from "express";
import { requirePermission } from "../middleware/requirePermission.js";
import {
  getCustomerPortfolioById,
  getPortfolio,
  getPortfolioByCustomer,
  getPortfolioReconciliation,
  getPortfolioSummary,
} from "../controllers/portfolio.controller.js";

const router = express.Router();
router.use(requirePermission("portfolio.view"));

router.get("/summary", getPortfolioSummary);
router.get("/customers", getPortfolioByCustomer);
router.get("/reconciliation", getPortfolioReconciliation);
router.get("/customer/:customerId", getCustomerPortfolioById);
router.get("/", getPortfolio);

export default router;
