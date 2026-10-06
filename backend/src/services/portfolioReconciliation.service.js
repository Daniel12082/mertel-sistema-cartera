import pool from "../config/database.js";
import { normalizeMertelNit } from "./mertelPortfolioXlsxParser.js";

const labels = { NEW: "Nuevo", UPDATED: "Actualizado", UNCHANGED: "Sin cambios", DISAPPEARED: "No aparece en archivo", DUPLICATE: "Duplicado", RETURN: "Devolución", DEBIT_NOTE: "Nota débito", ERROR: "Error" };
const date = value => value == null ? null : value instanceof Date ? `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}` : String(value).slice(0, 10);
const money = value => value == null || value === "" ? null : Math.round(Number(value) * 100);
const movementType = row => row.movement_type || "unknown";
const canonicalMovement = value => {
  const text = String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (text.startsWith("012 ")) return "012 factura de venta credito";
  return text;
};
const docKey = row => [row.customer_nit_normalized, String(row.document_number || "").trim().toUpperCase(), movementType(row), row.issue_date || ""].join("|");
const simpleKey = row => `${row.customer_nit_normalized}|${String(row.document_number || "").trim().toUpperCase()}`;
const field = (key, label, dbValue, fileValue, normalize = value => value) => normalize(dbValue) === normalize(fileValue) ? null : { field: key, label, databaseValue: dbValue ?? null, fileValue: fileValue ?? null };

export async function reconcilePortfolio({ bytes, scope }) {
  if (!scope?.companyId) throw Object.assign(new Error("El contexto MERTEL no está disponible"), { status: 403 });
  const { parseMertelPortfolioXlsx } = await import("./mertelPortfolioXlsxParser.js");
  const parsed = await parseMertelPortfolioXlsx(bytes);
  const identityIssue = parsed.issues.find(issue => ["SOURCE_COMPANY_MISMATCH", "SOURCE_NIT_MISMATCH"].includes(issue.error_code));
  if (identityIssue) throw Object.assign(new Error(identityIssue.message), { status: 400, code: identityIssue.error_code });
  const db = await pool.getConnection();
  try {
    await db.query("SET TRANSACTION READ ONLY");
    await db.beginTransaction();
    const [companies] = await db.query("SELECT id FROM companies WHERE id=? AND status='active' AND deleted_at IS NULL", [scope.companyId]);
    if (!companies.length) throw Object.assign(new Error("Empresa no disponible"), { status: 404 });
    const [customers] = await db.query("SELECT id,nit FROM customers WHERE company_id=? AND deleted_at IS NULL", [scope.companyId]);
    const [rows] = await db.query(`SELECT i.id, i.customer_id, i.invoice_number, i.issue_date, i.due_date, i.document_value, i.base_value, i.iva_value, i.balance, i.status, i.notes,
      c.nit, c.name, c.address, c.city, c.phone
      FROM invoices i INNER JOIN customers c ON c.id=i.customer_id
      WHERE i.company_id=? AND c.company_id=? AND i.deleted_at IS NULL AND c.deleted_at IS NULL ORDER BY i.id`, [scope.companyId, scope.companyId]);
    await db.commit();
    return buildReconciliation(parsed, rows, customers);
  } catch (error) {
    try { await db.rollback(); } catch {}
    throw error;
  } finally { db.release(); }
}

export function buildReconciliation(parsed, databaseRows, customerRows = [...new Map(databaseRows.map(row => [String(row.customer_id), { id: row.customer_id, nit: row.nit }])).values()]) {
  const docs = parsed.documents || [];
  const results = []; const seen = new Map(); const sourceInvoiceKeys = new Set(); const sourceInvoicePairs = new Set();
  const invoiceByKey = new Map();
  const customerIdsByNit = new Map();
  for (const customer of customerRows) {
    const nit = normalizeMertelNit(customer.nit).normalized;
    const ids = customerIdsByNit.get(nit) || new Set(); ids.add(String(customer.id)); customerIdsByNit.set(nit, ids);
  }
  for (const row of databaseRows) {
    const nit = normalizeMertelNit(row.nit).normalized;
    const key = `${nit}|${String(row.invoice_number).trim().toUpperCase()}`;
    const list = invoiceByKey.get(key) || []; list.push(row); invoiceByKey.set(key, list);
  }
  for (const row of docs) {
    if (movementType(row) !== "invoice" || !row.customer_nit_normalized || !row.document_number) continue;
    sourceInvoicePairs.add(simpleKey(row));
    const matches = invoiceByKey.get(simpleKey(row)) || [];
    if (matches.length === 1) sourceInvoiceKeys.add(String(matches[0].id));
  }
  for (const row of docs) {
    const type = movementType(row);
    const key = docKey(row); const group = seen.get(key) || []; group.push(row); seen.set(key, group);
  }
  const duplicateRows = new Map();
  for (const group of seen.values()) if (group.length > 1) {
    const involvedRows = group.map(row => row.row_number).sort((a, b) => a - b);
    for (const row of group) duplicateRows.set(row.row_number, involvedRows);
  }

  for (const row of docs) {
    const type = movementType(row);
    const values = row.values || {};
    const base = { customer: { nit: row.customer_nit_original, nitNormalized: row.customer_nit_normalized, name: values["Nombre cliente"] || null }, document: {
      number: row.document_number, movement: row.movement, movementType: movementType(row), issueDate: row.issue_date, dueDate: row.due_date,
      value: row.document_value, iva: row.iva, observations: values.Observaciones || null,
      seller: values.Vendedor || null, collector: values.Cobrador || null, zone: values.Zona || null,
    }, sourceRow: row.row_number, differences: [] };
    let category = "ERROR"; let reason = null;
    if (!row.customer_nit_normalized) reason = "NIT vacío o no normalizable";
    else if (!row.document_number) reason = "Falta número de documento";
    else if (!row.issue_date) reason = "Fecha de emisión inválida o vacía";
    else if (!row.movement) reason = "Falta movimiento";
    else if (type === "invoice" && !row.due_date) reason = "Fecha de vencimiento inválida o vacía";
    else if (row.document_value == null) reason = "Valor de documento vacío o no numérico";
    else if (row.iva == null) reason = "IVA vacío o no numérico";
    else if (type === "unknown") reason = `Movimiento no reconocido: ${row.movement}`;
    else if ((customerIdsByNit.get(row.customer_nit_normalized)?.size || 0) > 1) reason = "NIT ambiguo: identifica a más de un cliente en la base de datos";
    else if (duplicateRows.has(row.row_number)) category = "DUPLICATE";
    else if (type === "return") category = "RETURN";
    else if (type === "debit_note") category = "DEBIT_NOTE";
    else {
      const matches = invoiceByKey.get(simpleKey(row)) || [];
      if (matches.length > 1) reason = "Coincidencia ambigua: hay más de una factura en la base de datos para el NIT y número";
      else if (!matches.length) category = "NEW";
      else {
        const current = matches[0]; sourceInvoiceKeys.add(String(current.id));
        const dbCustomer = { nit: normalizeMertelNit(current.nit).normalized, name: current.name, address: current.address, city: current.city };
        const compare = [
          field("number", "Documento", current.invoice_number, row.document_number, value => String(value ?? "").trim().toUpperCase()),
          field("movement", "Movimiento", "012 Factura de venta credito", row.movement, canonicalMovement),
          field("issueDate", "Fecha de emisión", date(current.issue_date), row.issue_date, date),
          field("dueDate", "Fecha de vencimiento", date(current.due_date), row.due_date, date),
          field("documentValue", "Valor documento", current.document_value, row.document_value, money),
          field("iva", "IVA", current.iva_value, row.iva, money),
          field("customerNit", "NIT", dbCustomer.nit, row.customer_nit_normalized),
          field("customerName", "Cliente", current.name, values["Nombre cliente"] || null, value => String(value ?? "").trim().toLocaleLowerCase("es")),
          field("address", "Dirección", current.address, values.Direccion || null, value => String(value ?? "").trim().toLocaleLowerCase("es")),
          field("city", "Ciudad", current.city, values.Ciudad || null, value => String(value ?? "").trim().toLocaleLowerCase("es")),
          field("observations", "Observaciones", current.notes, values.Observaciones || null, value => String(value ?? "").trim()),
        ].filter(Boolean);
        category = compare.length ? "UPDATED" : "UNCHANGED";
        base.database = { customer: dbCustomer, document: { number: current.invoice_number, movement: "012 Factura de venta credito", issueDate: date(current.issue_date), dueDate: date(current.due_date), value: Number(current.document_value), iva: current.iva_value == null ? null : Number(current.iva_value), observations: current.notes, balance: Number(current.balance), status: current.status } };
        base.differences = compare;
      }
    }
    if (reason) category = "ERROR";
    results.push({ ...base, category, categoryLabel: labels[category], ...(duplicateRows.has(row.row_number) ? { duplicateSourceRows: duplicateRows.get(row.row_number) } : {}), ...(reason ? { reason } : {}) });
  }
  for (const current of databaseRows) {
    if (sourceInvoiceKeys.has(String(current.id))) continue;
    if (sourceInvoicePairs.has(`${normalizeMertelNit(current.nit).normalized}|${String(current.invoice_number).trim().toUpperCase()}`)) continue;
    const database = { customer: { nit: normalizeMertelNit(current.nit).normalized, name: current.name }, document: { number: current.invoice_number, movement: "012 Factura de venta credito", issueDate: date(current.issue_date), dueDate: date(current.due_date), value: Number(current.document_value), iva: current.iva_value == null ? null : Number(current.iva_value), balance: Number(current.balance), status: current.status } };
    results.push({ category: "DISAPPEARED", categoryLabel: labels.DISAPPEARED, customer: database.customer, document: database.document, database, differences: [], sourceRow: null, reason: "No aparece en el archivo actual; esto no indica pago, cancelación ni saldo cero." });
  }
  const summary = { total: results.length, new: 0, updated: 0, unchanged: 0, disappeared: 0, returns: 0, debitNotes: 0, duplicates: 0, errors: 0 };
  const keys = { NEW: "new", UPDATED: "updated", UNCHANGED: "unchanged", DISAPPEARED: "disappeared", RETURN: "returns", DEBIT_NOTE: "debitNotes", DUPLICATE: "duplicates", ERROR: "errors" };
  for (const result of results) summary[keys[result.category]] += 1;
  return { summary, results, metadata: { report: parsed.report, sourceDocumentRows: docs.length, generatedAt: new Date().toISOString(), readOnly: true } };
}
