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

export async function listPortfolio(criteria, scope) {
  const invoices = await getPortfolioInvoices(criteria, scope);
  return addCalculatedState(invoices, criteria.referenceDate);
}

export async function getPortfolioSummary(referenceDate, scope) {
  return getPortfolioTotals(referenceDate, scope);
}

export async function listPortfolioCustomers(referenceDate, scope) {
  return getPortfolioCustomers(referenceDate, scope);
}

export async function getCustomerPortfolio(customerId, criteria, scope) {
  const customer = await getActiveCustomer(customerId, scope);
  if (!customer) return null;
  const [totals, invoices] = await Promise.all([
    getCustomerPortfolioTotals(customerId, criteria.referenceDate, scope),
    getPortfolioInvoices({ ...criteria, customerId }, scope),
  ]);
  return { customer, totals, invoices: addCalculatedState(invoices, criteria.referenceDate) };
}

export async function listPortfolioInconsistencies(scope) {
  return getPortfolioReconciliation(scope);
}
