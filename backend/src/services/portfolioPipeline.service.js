import pool from "../config/database.js";
import { loadCompanyCollectionRules, evaluateCompanyCollection } from "./companyCollection.service.js";
import { buildCollectionResult } from "./collection.service.js";
import { evaluateCollectionInvoices } from "./collectionEngine.service.js";
import { collectionStageCatalog } from "./collectionPolicy.js";
import { normalizeMertelNit, parseMertelAmount, parseMertelPortfolioXlsx } from "./mertelPortfolioXlsxParser.js";
import { validCompanyId } from "../utils/companyScope.js";

const AGING_COLUMNS = ["Corriente", "1-30 días", "30-45 días", "45-60 días", "60-90 días", "+90 días"];
const validDate = value => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return year >= 1000 && parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
};
const clean = value => String(value ?? "").trim() || null;
const cents = amount => Math.round(amount * 100);
const money = value => `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;

function sourceCustomer(row) {
  const values = row.values;
  const cupo = parseMertelAmount(values.Cupo);
  return {
    id: `xlsx:${row.customer_nit_normalized}`, company_id: null,
    nit: row.customer_nit_original, name: clean(values["Nombre cliente"]),
    representative: clean(values["Rep Legal"]), address: clean(values.Direccion), city: clean(values.Ciudad),
    department: clean(values.Departamento), phone: clean(values.Telefono), mobile: clean(values.Celular),
    credit_limit: cupo == null ? null : String(cupo), collector: clean(values.Cobrador), seller: clean(values.Vendedor), zone: clean(values.Zona),
  };
}

function documentView(row, balance = null) {
  return {
    source_row: row.row_number, document_number: row.document_number, movement: row.movement,
    movement_type: row.movement_type, issue_date: row.issue_date, due_date: row.due_date,
    document_value: row.document_value, iva: row.iva, balance: balance == null ? null : money(balance),
    observations: clean(row.values.Observaciones),
  };
}

/** Builds a non-persistent MERTEL pipeline directly from parser rows and the existing collection engine. */
export function buildPortfolioPipeline({ parsed, referenceDate, fileName, processedAt = new Date().toISOString(), companyId, rules }) {
  if (!validCompanyId(companyId)) throw Object.assign(new Error("El contexto MERTEL no está disponible"), { status: 403 });
  if (!validDate(referenceDate)) throw Object.assign(new Error("reference_date es obligatoria y debe usar YYYY-MM-DD"), { status: 400, code: "INVALID_REFERENCE_DATE" });
  const identityIssue = parsed.issues?.find(issue => ["SOURCE_COMPANY_MISMATCH", "SOURCE_NIT_MISMATCH"].includes(issue.error_code));
  if (identityIssue) throw Object.assign(new Error(identityIssue.message), { status: 400, code: identityIssue.error_code });

  const errors = (parsed.issues || []).filter(issue => issue.severity !== "warning" && issue.row_number > 7)
    .map(issue => ({ source_row: issue.row_number, code: issue.error_code, field: issue.field_name, message: issue.message }));
  const errorKeys = new Set(errors.map(issue => `${issue.source_row}:${issue.code}`));
  const addError = (row, code, field, message) => {
    const key = `${row.row_number}:${code}`;
    if (!errorKeys.has(key)) { errorKeys.add(key); errors.push({ source_row: row.row_number, code, field, message }); }
  };
  const invoiceRows = (parsed.documents || []).filter(row => row.movement_type === "invoice");
  const duplicates = new Set(); const seen = new Map();
  for (const row of invoiceRows) {
    const key = [row.customer_nit_normalized, String(row.document_number || "").trim().toUpperCase(), row.issue_date || ""].join("|");
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(row);
  }
  for (const group of seen.values()) if (group.length > 1) for (const row of group) {
    duplicates.add(row.row_number); addError(row, "DUPLICATE_DOCUMENT", "Numero", "Documento duplicado; se excluyó del pipeline para evitar contar cartera dos veces.");
  }

  const customersById = new Map(); const customerDocuments = new Map(); const invoices = []; const invoiceByRow = new Map();
  for (const row of parsed.documents || []) {
    const customer = sourceCustomer(row);
    if (row.customer_nit_normalized) {
      if (!customersById.has(customer.id)) customersById.set(customer.id, customer);
      if (!customerDocuments.has(customer.id)) customerDocuments.set(customer.id, []);
      customerDocuments.get(customer.id).push(documentView(row));
    }
    if (row.movement_type !== "invoice" || row.type !== "DOCUMENT" || duplicates.has(row.row_number)) continue;
    if (!row.customer_nit_normalized || !row.document_number || !row.issue_date || !row.due_date) {
      addError(row, "INCOMPLETE_INVOICE", null, "Factura sin NIT, número o fechas válidas; no se clasificó."); continue;
    }
    const buckets = AGING_COLUMNS.map(column => {
      const raw = row.values[column];
      if (!raw) return 0;
      const amount = parseMertelAmount(raw);
      return amount == null || amount < 0 ? null : amount;
    });
    if (buckets.some(value => value == null)) {
      addError(row, "INVALID_AGING_BALANCE", "Cartera por edades", "Un bucket de antigüedad no es numérico o es negativo; el saldo no es confiable."); continue;
    }
    const balanceCents = buckets.reduce((sum, value) => sum + cents(value), 0);
    if (!Number.isSafeInteger(balanceCents) || balanceCents <= 0) {
      addError(row, "NO_OPEN_BALANCE", "Cartera por edades", "La factura no tiene saldo pendiente positivo en los buckets de cartera."); continue;
    }
    const invoice = {
      id: `xlsx:row:${row.row_number}`, company_id: companyId, customer_id: customer.id,
      invoice_number: row.document_number, issue_date: row.issue_date, due_date: row.due_date,
      document_value: row.document_value == null ? null : String(row.document_value), iva_value: row.iva == null ? null : String(row.iva),
      balance: money(balanceCents), base_value: null, notes: clean(row.values.Observaciones),
      source_row: row.row_number, movement: row.movement,
    };
    invoices.push(invoice); invoiceByRow.set(row.row_number, { invoice, balanceCents });
  }

  const customers = [...customersById.values()].filter(customer => invoices.some(invoice => invoice.customer_id === customer.id));
  for (const customer of customers) customer.company_id = companyId;
  const raw = buildCollectionResult({ company: { id: companyId }, referenceDate, customers, invoices, rules });
  const byCustomer = new Map();
  for (const customer of customers) byCustomer.set(customer.id, []);
  const classified = evaluateCollectionInvoices({ referenceDate, invoices, rules });
  for (const result of classified) byCustomer.get(result.customerId)?.push(result);
  const pipeline = raw.customers.map(item => {
    const id = item.customer.id;
    const invoiceDocs = (byCustomer.get(id) || []).map(result => ({
      invoice: result.invoice,
      ...documentView({ row_number: result.invoice.source_row, document_number: result.invoice.invoice_number, movement: result.invoice.movement,
        movement_type: "invoice", issue_date: result.invoice.issue_date, due_date: result.invoice.due_date,
        document_value: result.invoice.document_value == null ? null : Number(result.invoice.document_value),
        iva: result.invoice.iva_value == null ? null : Number(result.invoice.iva_value), values: { Observaciones: result.invoice.notes } },
      invoiceByRow.get(result.invoice.source_row)?.balanceCents),
      stage: result.stage, stage_label: raw.stage_catalog.find(stage => stage.key === result.stage)?.label || result.stage,
      priority: result.priority, eligible: result.eligible, reason: result.reason,
      days_until_due: result.invoice.due_date ? Math.round((Date.parse(`${result.invoice.due_date}T00:00:00Z`) - Date.parse(`${referenceDate}T00:00:00Z`)) / 86400000) : null,
      prompt_payment: result.promptPayment,
    }));
    const documents = (customerDocuments.get(id) || []).map(document => {
      const classifiedInvoice = invoiceDocs.find(invoice => invoice.source_row === document.source_row);
      return classifiedInvoice ? { ...document, ...classifiedInvoice } : { ...document, stage: "informational", stage_label: "Informativo", eligible: false, reason: "Movimiento informativo; no se trata como factura de cobranza." };
    });
    return { ...item, source_details: item.customer, documents, invoices: invoiceDocs,
      main_document: documents.find(document => document.source_row === item.main_invoice?.invoice?.source_row) || null };
  });
  const categoryByKey = new Map(raw.stage_catalog.map(stage => [stage.key, stage.category]));
  const stageCounts = Object.create(null);
  for (const item of pipeline) {
    const category = categoryByKey.get(item.stage);
    if (category) stageCounts[category] = (stageCounts[category] || 0) + 1;
  }
  const promptCustomers = pipeline.filter(item => item.stage === "prompt_payment").length;
  const unclassified = classified.filter(item => !item.eligible).length;
  return {
    source: { file_name: String(fileName || "cartera MERTEL.xlsx").slice(0, 255), reference_date: referenceDate, processed_at: processedAt, label: "Archivo de cartera MERTEL" },
    reference_date: referenceDate, status: raw.status, rules_configured: raw.rules_configured,
    stage_catalog: raw.stage_catalog, priority_basis: raw.priority_basis, configuration_warnings: raw.configuration_warnings,
    summary: {
      customers: customers.length, documents: invoices.length,
      overdue: stageCounts.overdue || 0, due_today: stageCounts.due_today || 0,
      due_in_five_days: stageCounts.days_before_due || 0, prompt_payment: promptCustomers,
      unclassified, errors: errors.length,
    },
    pipeline, errors, informational_documents: (parsed.documents || []).filter(row => row.movement_type === "return" || row.movement_type === "debit_note").length,
    metadata: { read_only: true, persisted: false, balance_source: "Suma de buckets de antigüedad por factura", document_value_used_as_balance: false },
  };
}

export async function generatePortfolioPipeline({ bytes, scope, referenceDate, fileName, processedAt }) {
  if (!validCompanyId(scope?.companyId)) throw Object.assign(new Error("El contexto MERTEL no está disponible"), { status: 403 });
  if (!validDate(referenceDate)) throw Object.assign(new Error("reference_date es obligatoria y debe usar YYYY-MM-DD"), { status: 400, code: "INVALID_REFERENCE_DATE" });
  const parsed = await parseMertelPortfolioXlsx(bytes);
  const connection = await pool.getConnection();
  try {
    await connection.query("START TRANSACTION READ ONLY");
    const [companies] = await connection.query("SELECT id FROM companies WHERE id=? AND status='active' AND deleted_at IS NULL", [scope.companyId]);
    if (!companies.length) throw Object.assign(new Error("Empresa no disponible"), { status: 404 });
    const rules = await loadCompanyCollectionRules(scope.companyId, connection);
    await connection.commit();
    return buildPortfolioPipeline({ parsed, referenceDate, fileName, processedAt, companyId: scope.companyId, rules });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally { connection.release(); }
}
