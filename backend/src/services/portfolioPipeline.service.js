import pool from "../config/database.js";
import { createHmac, timingSafeEqual, randomUUID, createHash } from "node:crypto";
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

function signSourceContext(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifySourceContext(token, secret, companyId) {
  if (typeof token !== "string" || token.length > 12000) throw Object.assign(new Error("Contexto temporal inválido."), { status: 400 });
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) throw Object.assign(new Error("Contexto temporal inválido."), { status: 400 });
  const expected = createHmac("sha256", secret).update(encoded).digest();
  let actual;
  try { actual = Buffer.from(signature, "base64url"); } catch { actual = Buffer.alloc(0); }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw Object.assign(new Error("Contexto temporal inválido."), { status: 403 });
  let payload;
  try { payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch { throw Object.assign(new Error("Contexto temporal inválido."), { status: 400 }); }
  if (String(payload.company_id) !== String(companyId) || !/^\d{6,15}$/.test(payload.nit || "") || !/^[a-f0-9]{64}$/.test(payload.source_hash || "") || !Array.isArray(payload.documents) || !Number.isSafeInteger(payload.expires_at) || payload.expires_at < Date.now()) {
    throw Object.assign(new Error("El contexto temporal expiró o no pertenece a esta empresa."), { status: 403 });
  }
  return payload;
}

function operationText(value, maxLength, required = false) {
  if (typeof value !== "string" || value.trim().length > maxLength || (required && !value.trim())) throw Object.assign(new Error("Revisa el tipo de gestión y la observación."), { status: 400 });
  return value.trim() || null;
}

export async function recordImportedPipelineAction({ scope, token, body, ipAddress = null, userAgent = null }) {
  if (!validCompanyId(scope?.companyId) || !validCompanyId(scope?.actorId)) throw Object.assign(new Error("La gestión manual requiere contexto de empresa autorizado."), { status: 403 });
  const context = verifySourceContext(token, process.env.JWT_SECRET, scope.companyId);
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["document_number", "action_type", "description"].includes(key))) throw Object.assign(new Error("Campos de gestión no válidos."), { status: 400 });
  const actionType = operationText(body.action_type, 50, true);
  const description = operationText(body.description, 4000, true);
  const documentNumber = body.document_number == null || body.document_number === "" ? null : operationText(body.document_number, 80, true);
  if (documentNumber && !context.documents.includes(documentNumber)) throw Object.assign(new Error("El documento no pertenece al contexto de cartera firmado."), { status: 400 });
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const payload = {
      source: "mertel_xlsx_pipeline", source_hash: context.source_hash, source_file: context.file_name,
      reference_date: context.reference_date, customer_nit: context.nit, customer_name: context.customer_name,
      document_number: documentNumber, pipeline_stage: context.stage, pipeline_reason: context.reason,
      action_type: actionType, description, operation_id: randomUUID(),
    };
    const [result] = await db.query(`INSERT INTO audit_logs (company_id,user_id,entity_type,entity_id,action,new_values,ip_address,user_agent)
      VALUES (?,?, 'portfolio_pipeline_action', NULL, 'create', CAST(? AS JSON), ?, ?)`,
    [scope.companyId, scope.actorId, JSON.stringify(payload), ipAddress, userAgent]);
    await db.commit();
    return { id: String(result.insertId), ...payload, created_at: new Date().toISOString() };
  } catch (error) { try { await db.rollback(); } catch {} throw error; }
  finally { db.release(); }
}

export async function listImportedPipelineActions({ scope, token }) {
  if (!validCompanyId(scope?.companyId)) throw Object.assign(new Error("Se requiere contexto de empresa autorizado."), { status: 403 });
  const context = verifySourceContext(token, process.env.JWT_SECRET, scope.companyId);
  const db = await pool.getConnection();
  try {
    await db.query("START TRANSACTION READ ONLY");
    const [rows] = await db.query(`SELECT CAST(a.id AS CHAR) AS id, CAST(a.user_id AS CHAR) AS user_id,
      CONCAT_WS(' ',u.first_name,u.last_name) AS user_name, a.new_values,
      DATE_FORMAT(a.created_at,'%Y-%m-%dT%H:%i:%sZ') AS created_at
      FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id AND (u.company_id=a.company_id OR u.company_id IS NULL)
      WHERE a.company_id=? AND a.entity_type='portfolio_pipeline_action'
        AND JSON_UNQUOTE(JSON_EXTRACT(a.new_values,'$.source_hash'))=?
        AND JSON_UNQUOTE(JSON_EXTRACT(a.new_values,'$.customer_nit'))=?
      ORDER BY a.created_at DESC,a.id DESC LIMIT 100`, [scope.companyId, context.source_hash, context.nit]);
    await db.commit();
    return rows.map(row => {
      const value = typeof row.new_values === "string" ? JSON.parse(row.new_values) : row.new_values;
      return { id: row.id, user_id: row.user_id, user_name: row.user_name, created_at: row.created_at,
        action_type: value.action_type, description: value.description, document_number: value.document_number,
        pipeline_stage: value.pipeline_stage, pipeline_reason: value.pipeline_reason, reference_date: value.reference_date,
        source_file: value.source_file };
    });
  } catch (error) { try { await db.rollback(); } catch {} throw error; }
  finally { db.release(); }
}

function sourceCustomer(row, resolutionByNit = null) {
  const values = row.values;
  const cupo = parseMertelAmount(values.Cupo);
  return {
    id: resolutionByNit?.get(row.customer_nit_normalized) || `xlsx:${row.customer_nit_normalized}`, company_id: null,
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
export function buildPortfolioPipeline({ parsed, referenceDate, fileName, processedAt = new Date().toISOString(), companyId, rules, sourceHash, secret, resolutionByNit = null }) {
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
    const customer = sourceCustomer(row, resolutionByNit);
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
    const sourceContext = secret && sourceHash ? signSourceContext({
      version: 1, company_id: String(companyId), source_hash: sourceHash, file_name: String(fileName || "cartera MERTEL.xlsx").slice(0, 255),
      reference_date: referenceDate, nit: normalizeMertelNit(item.customer.nit).normalized, customer_name: item.customer.name,
      documents: documents.filter(document => document.movement_type === "invoice").map(document => document.document_number),
      stage: item.stage, reason: item.reason, expires_at: Date.now() + 30 * 86400000,
    }, secret) : null;
    return { ...item, source_details: item.customer, documents, invoices: invoiceDocs, source_context: sourceContext,
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
  const sourceHash = createHash("sha256").update(bytes).digest("hex");
  const connection = await pool.getConnection();
  try {
    await connection.query("START TRANSACTION READ ONLY");
    const [companies] = await connection.query("SELECT id FROM companies WHERE id=? AND status='active' AND deleted_at IS NULL", [scope.companyId]);
    if (!companies.length) throw Object.assign(new Error("Empresa no disponible"), { status: 404 });
    const [resolutionRows] = await connection.query(`SELECT nit_normalized,CAST(customer_id AS CHAR) customer_id,status
      FROM mertel_customer_resolution_rows WHERE company_id=? AND import_batch_id=(
        SELECT id FROM import_batches WHERE company_id=? AND file_sha256=? AND file_type='xlsx' ORDER BY id DESC LIMIT 1
      )`, [scope.companyId, scope.companyId, sourceHash]);
    const expected = new Set((parsed.customer_records || []).map(row => row.customer_nit_normalized).filter(Boolean));
    const resolved = new Map(resolutionRows.filter(row => ["PERSISTENT","RESOLVED"].includes(row.status) && row.customer_id).map(row => [row.nit_normalized, row.customer_id]));
    if (!resolutionRows.length || resolutionRows.some(row => !["PERSISTENT","RESOLVED"].includes(row.status)) || [...expected].some(nit => !resolved.has(nit))) {
      throw Object.assign(new Error("Hay clientes pendientes de resolución. Completa la revisión antes de generar el pipeline."), { status: 409, code: "CUSTOMER_RESOLUTION_PENDING" });
    }
    for (const customerId of resolved.values()) {
      const [customers] = await connection.query("SELECT id FROM customers WHERE id=? AND company_id=? AND deleted_at IS NULL", [customerId, scope.companyId]);
      if (!customers.length) throw Object.assign(new Error("Un cliente resuelto ya no está disponible. Revisa la importación."), { status: 409, code: "CUSTOMER_RESOLUTION_STALE" });
    }
    const rules = await loadCompanyCollectionRules(scope.companyId, connection);
    await connection.commit();
    return buildPortfolioPipeline({ parsed, referenceDate, fileName, processedAt, companyId: scope.companyId, rules,
      sourceHash, secret: process.env.JWT_SECRET, resolutionByNit: resolved });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally { connection.release(); }
}
