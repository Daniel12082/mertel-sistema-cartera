import {
  getActiveCustomer,
  getCustomerPortfolioTotals,
  getPortfolioCustomers,
  getPortfolioInvoices,
  getPortfolioReconciliation,
  getPortfolioTotals,
} from "../models/portfolio.model.js";
import { calculatePortfolioState } from "./portfolio.calculation.js";

function addCalculatedState(invoices, referenceDate) {
  return invoices.map((invoice) => ({
    ...invoice,
    ...calculatePortfolioState({
      dueDate: invoice.due_date,
      balance: invoice.balance,
      referenceDate,
    }),
  }));
}

export async function listPortfolio(criteria) {
  const invoices = await getPortfolioInvoices(criteria);
  return addCalculatedState(invoices, criteria.referenceDate);
}

export async function getPortfolioSummary(referenceDate) {
  return getPortfolioTotals(referenceDate);
}

export async function listPortfolioCustomers(referenceDate) {
  return getPortfolioCustomers(referenceDate);
}

export async function getCustomerPortfolio(customerId, criteria) {
  const customer = await getActiveCustomer(customerId);
  if (!customer) return null;
  const [totals, invoices] = await Promise.all([
    getCustomerPortfolioTotals(customerId, criteria.referenceDate),
    getPortfolioInvoices({ ...criteria, customerId }),
  ]);
  return { customer, totals, invoices: addCalculatedState(invoices, criteria.referenceDate) };
}

export async function listPortfolioInconsistencies() {
  return getPortfolioReconciliation();
}
