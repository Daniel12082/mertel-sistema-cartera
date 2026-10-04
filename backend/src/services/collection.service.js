import pool from "../config/database.js";
import { getActiveCollectionCustomers, getCollectionOpenInvoices } from "../models/collection.model.js";
import { loadCompanyCollectionRules, evaluateCompanyCollection } from "./companyCollection.service.js";
import { evaluateCollectionInvoices } from "./collectionEngine.service.js";
import { validCompanyId } from "../utils/companyScope.js";

function amountCents(value) {
  const text = typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : value;
  if (typeof text !== "string" || !/^\d{1,13}(?:\.\d{1,2})?$/.test(text)) throw new TypeError("Saldo de factura inválido");
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
}

function money(cents) {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

function invoiceView(classification) {
  return {
    invoice: classification.invoice,
    stage: classification.stage,
    priority: classification.priority,
    reason: classification.reason,
    eligible: classification.eligible,
    stage_candidates: classification.stageCandidates,
  };
}

/** Pure response builder; selection and tie-breaking come from the existing collection engine/adapter. */
export function buildCollectionResult({ company, referenceDate, customers, invoices, rules, filters = {} }) {
  evaluateCollectionInvoices({ referenceDate, invoices: [], rules });
  const pendingInvoices = invoices.filter(invoice => amountCents(invoice.balance) > 0n);
  const cases = evaluateCompanyCollection({ company, referenceDate, customers, invoices: pendingInvoices, rules });
  const allInvoicesByCustomer = new Map();
  for (const invoice of pendingInvoices) {
    const key = String(invoice.customer_id);
    if (!allInvoicesByCustomer.has(key)) allInvoicesByCustomer.set(key, []);
    allInvoicesByCustomer.get(key).push(invoice);
  }

  let totalBalanceCents = 0n;
  for (const invoice of pendingInvoices) totalBalanceCents += amountCents(invoice.balance);
  const eligibleCustomers = [];
  const stageSummary = Object.create(null);
  let eligibleBalanceCents = 0n;

  for (const result of cases) {
    const classified = result.classifiedInvoices;
    const eligible = classified.filter(item => item.eligible);
    if (!eligible.length) continue;
    const customerInvoices = allInvoicesByCustomer.get(String(result.customerId)) || [];
    const totalCustomerBalance = customerInvoices.reduce((sum, invoice) => sum + amountCents(invoice.balance), 0n);
    const customerEligibleBalance = eligible.reduce((sum, item) => sum + amountCents(item.invoice.balance), 0n);
    const primaryClassification = result.primaryInvoice
      ? eligible.find(item => String(item.invoiceId) === String(result.primaryInvoice.invoice_id ?? result.primaryInvoice.id))
      : null;
    eligibleBalanceCents += customerEligibleBalance;

    const stage = stageSummary[result.stage] || (stageSummary[result.stage] = { customers: 0, invoices: 0, eligible_balance: "0.00", _cents: 0n });
    stage.customers += 1;
    stage.invoices += eligible.length;
    stage._cents += customerEligibleBalance;

    eligibleCustomers.push({
      customer: result.customer,
      stage: result.stage,
      priority: result.priority,
      reason: result.reason,
      total_balance: money(totalCustomerBalance),
      eligible_balance: money(customerEligibleBalance),
      main_invoice: primaryClassification ? invoiceView(primaryClassification) : null,
      invoices: classified.map(invoiceView),
    });
  }

  for (const value of Object.values(stageSummary)) {
    value.eligible_balance = money(value._cents);
    delete value._cents;
  }

  const customersResult = eligibleCustomers.filter(result =>
    (filters.customerId === undefined || String(result.customer.id) === String(filters.customerId)) &&
    (filters.stage === undefined || result.stage === filters.stage));

  return {
    reference_date: referenceDate,
    status: rules.length ? "ready" : "no_rules_configured",
    rules_configured: rules.length > 0,
    message: rules.length ? null : "No hay reglas de cobranza configuradas para esta empresa.",
    summary: {
      total_customers: eligibleCustomers.length,
      total_balance: money(totalBalanceCents),
      eligible_balance: money(eligibleBalanceCents),
      stages: stageSummary,
    },
    customers: customersResult,
  };
}

/** Reads rules and source data in one consistent, non-mutating transaction. */
export async function getCompanyCollection({ referenceDate, scope, filters = {} }) {
  if (!scope || !validCompanyId(scope.companyId)) {
    const error = new TypeError("Debe especificarse una empresa para consultar la cobranza");
    error.status = 400;
    throw error;
  }
  const connection = await pool.getConnection();
  try {
    await connection.query("START TRANSACTION READ ONLY");
    const company = { id: scope.companyId };
    const rules = await loadCompanyCollectionRules(scope.companyId, connection);
    const customers = await getActiveCollectionCustomers(scope, connection);
    const invoices = await getCollectionOpenInvoices(scope, connection);
    await connection.commit();
    return buildCollectionResult({ company, referenceDate, customers, invoices, rules, filters });
  } catch (error) {
    try { await connection.rollback(); } catch { /* preserve the original failure */ }
    throw error;
  } finally {
    connection.release();
  }
}
