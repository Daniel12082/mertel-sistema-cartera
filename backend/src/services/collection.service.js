import pool from "../config/database.js";
import { getActiveCollectionCustomers, getCollectionOpenInvoices } from "../models/collection.model.js";
import { loadCompanyCollectionRules, evaluateCompanyCollection } from "./companyCollection.service.js";
import { compareCollectionCustomers, evaluateCollectionInvoices } from "./collectionEngine.service.js";
import { collectionStageCatalog, resolveCollectionPolicy } from "./collectionPolicy.js";
import { validCompanyId } from "../utils/companyScope.js";
import { moneyCents } from "./collectionMoney.js";
import { dateDay } from "./promptPayment.service.js";

function amountCents(value) {
  return moneyCents(value);
}

function money(cents) {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

function invoiceView(classification, catalog) {
  return {
    invoice: classification.invoice,
    stage: classification.stage,
    priority: classification.priority,
    reason: classification.reason,
    eligible: classification.eligible,
    stage_candidates: classification.stageCandidates,
    stage_label: catalog.find(stage => stage.key === classification.stage)?.label ?? (classification.stage === "no_eligible" ? "No elegible" : classification.stage),
    prompt_payment: classification.promptPayment,
    conditional_discount: classification.conditionalDiscount,
    benefits: classification.benefits,
  };
}

/** Pure response builder; selection and tie-breaking come from the existing collection engine/adapter. */
export function buildCollectionResult({ company, referenceDate, customers, invoices, rules, filters = {} }) {
  evaluateCollectionInvoices({ referenceDate, invoices: [], rules });
  const policy = resolveCollectionPolicy(rules);
  const catalog = collectionStageCatalog(rules);
  const promptPending = catalog.some(stage => stage.category === "prompt_payment") &&
    (policy.promptPayment.window.day_type === "pending" || policy.promptPayment.window.include_issue_date === null || policy.promptPayment.window.include_day_ten === null ||
      (policy.promptPayment.window.day_type === "business" && (!policy.promptPayment.window.calendar?.working_weekdays?.length || !Array.isArray(policy.promptPayment.window.calendar?.holidays))));
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
  const pendingOnlyCustomers = [];
  const nonOverdueInvoices = [];
  const stageSummary = Object.create(null);
  let eligibleBalanceCents = 0n;

  for (const result of cases) {
    const classified = result.classifiedInvoices;
    const eligible = classified.filter(item => item.eligible);
    const customerInvoices = allInvoicesByCustomer.get(String(result.customerId)) || [];
    const totalCustomerBalance = customerInvoices.reduce((sum, invoice) => sum + amountCents(invoice.balance), 0n);
    const nonOverdue = classified.filter(item => !item.eligible && item.invoice.due_date && dateDay(item.invoice.due_date) > dateDay(referenceDate) && item.invoice.deleted_at == null && item.invoice.active !== false);
    nonOverdueInvoices.push(...nonOverdue.map(item => ({ ...invoiceView(item, catalog), customer: result.customer, operational_group: "non_overdue_pending" })));
    if (!eligible.length) {
      if (nonOverdue.length) pendingOnlyCustomers.push({ customer: result.customer, stage: "no_eligible", stage_label: "Facturas no vencidas", priority: null,
        reason: "Saldo pendiente sin una etapa activa de cobranza.", total_balance: money(totalCustomerBalance), eligible_balance: "0.00", main_invoice: null,
        invoices: classified.map(item => invoiceView(item, catalog)) });
      continue;
    }
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
      stage_label: catalog.find(stage => stage.key === result.stage)?.label ?? result.stage,
      priority: result.priority,
      reason: result.reason,
      total_balance: money(totalCustomerBalance),
      eligible_balance: money(customerEligibleBalance),
      main_invoice: primaryClassification ? invoiceView(primaryClassification, catalog) : null,
      invoices: classified.map(item => invoiceView(item, catalog)),
    });
  }

  for (const value of Object.values(stageSummary)) {
    value.eligible_balance = money(value._cents);
    delete value._cents;
  }

  eligibleCustomers.sort((left, right) => compareCollectionCustomers(left, right, referenceDate));
  const customersResult = eligibleCustomers.filter(result =>
    (filters.customerId === undefined || String(result.customer.id) === String(filters.customerId)) &&
    (filters.stage === undefined || result.stage === filters.stage));

  return {
    reference_date: referenceDate,
    status: policy.rules.length ? "ready" : "no_rules_configured",
    rules_configured: policy.rules.length > 0,
    message: policy.rules.length ? null : "No hay reglas de cobranza configuradas para esta empresa.",
    stage_catalog: catalog,
    priority_basis: "stage_order_ordinal",
    configuration_warnings: [
      ...(promptPending ? ["Pronto Pago pendiente: definir tipo de día, calendario si corresponde y límites de diez días desde emisión. No se asigna esa etapa mientras falte configuración."] : []),
      ...(policy.conditionalDiscount?.active ? ["Beneficios independientes: combinación financiera y coexistencia de ventanas 0–10 / 60–70 días pendientes de precisión. No se aplica descuento al saldo."] : []),
    ],
    summary: {
      total_customers: eligibleCustomers.length,
      total_balance: money(totalBalanceCents),
      eligible_balance: money(eligibleBalanceCents),
      stages: stageSummary,
    },
    customers: customersResult,
    non_overdue_pending: {
      label: "Facturas no vencidas",
      total_invoices: nonOverdueInvoices.length,
      total_customers: new Set(nonOverdueInvoices.map(item => String(item.customer.id))).size,
      total_balance: money(nonOverdueInvoices.reduce((sum, item) => sum + amountCents(item.invoice.balance), 0n)),
      invoices: nonOverdueInvoices.filter(item => filters.stage === undefined && (filters.customerId === undefined || String(item.customer.id) === String(filters.customerId))),
      customers: pendingOnlyCustomers.filter(item => filters.stage === undefined && (filters.customerId === undefined || String(item.customer.id) === String(filters.customerId))),
    },
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
