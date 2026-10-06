import { companyFilter } from "../utils/companyScope.js";

export async function operationCustomer(id, scope, db, lock = false) {
  const company = companyFilter(scope, "company_id");
  const [rows] = await db.query(`SELECT CAST(id AS CHAR) AS id, CAST(company_id AS CHAR) AS company_id, status
    FROM customers WHERE id=? AND deleted_at IS NULL ${company.sql}${lock ? " FOR UPDATE" : ""}`, [id, ...company.values]);
  return rows[0];
}
export async function operationInvoice(id, customerId, scope, db, lock = false) {
  const company = companyFilter(scope, "company_id");
  const [rows] = await db.query(`SELECT CAST(id AS CHAR) AS id FROM invoices
    WHERE id=? AND customer_id=? AND deleted_at IS NULL ${company.sql}${lock ? " FOR UPDATE" : ""}`, [id, customerId, ...company.values]);
  return rows[0];
}
export async function listOperations(kind, customerId, invoiceId, scope, db) {
  const action = kind === "action";
  const table = action ? "collection_actions" : "payment_promises";
  const actor = action ? "user_id" : "created_by";
  const company = companyFilter(scope, "o.company_id", "c.company_id");
  const [rows] = await db.query(`SELECT CAST(o.id AS CHAR) AS id, CAST(o.customer_id AS CHAR) AS customer_id,
    CAST(o.invoice_id AS CHAR) AS invoice_id, CAST(o.${actor} AS CHAR) AS user_id,
    CONCAT_WS(' ', u.first_name, u.last_name) AS user_name, i.invoice_number, o.status,
    UNIX_TIMESTAMP(o.created_at)*1000 AS created_at,
    ${action ? "o.action_type,o.description,DATE_FORMAT(o.action_date,'%Y-%m-%dT%H:%i:%sZ') AS action_date" : "DATE_FORMAT(o.promised_date,'%Y-%m-%d') AS promised_date,o.promised_amount,o.notes"}
    FROM ${table} o INNER JOIN customers c ON c.id=o.customer_id
    LEFT JOIN users u ON u.id=o.${actor} AND (u.company_id=o.company_id OR u.company_id IS NULL)
    LEFT JOIN invoices i ON i.id=o.invoice_id AND i.customer_id=o.customer_id AND i.company_id=o.company_id
    WHERE o.customer_id=? AND (o.invoice_id IS NULL OR i.id IS NOT NULL) ${company.sql}${invoiceId ? " AND o.invoice_id=?" : ""}
    ORDER BY o.created_at DESC,o.id DESC`, [customerId, ...company.values, ...(invoiceId ? [invoiceId] : [])]);
  return rows.map(row => ({ ...row, created_at: new Date(Number(row.created_at)).toISOString() }));
}

export async function getDashboardPromiseSummary(scope, db) {
  const company = companyFilter(scope, "p.company_id");
  const [[row]] = await db.query(`SELECT COUNT(*) AS pending_count,
    COALESCE(SUM(p.promised_amount), 0) AS pending_amount
    FROM payment_promises p WHERE p.status='pending' ${company.sql}`, company.values);
  return { pending_count: Number(row.pending_count), pending_amount: String(row.pending_amount) };
}

export async function getDashboardActionCount(scope, fromUtc, toUtc, db) {
  const company = companyFilter(scope, "a.company_id");
  const [[row]] = await db.query(`SELECT COUNT(*) AS actions_period FROM collection_actions a
    WHERE a.action_date >= ? AND a.action_date < ? ${company.sql}`,
  [fromUtc, toUtc, ...company.values]);
  return Number(row.actions_period);
}
export async function insertOperation(kind, customerId, data, scope, db) {
  if (kind === "action") await db.query(`INSERT INTO collection_actions (company_id,customer_id,invoice_id,user_id,action_type,description,action_date,status)
    VALUES (?,?,?,?,?,?,UTC_TIMESTAMP(),'completed')`, [scope.companyId, customerId, data.invoice_id, scope.actorId, data.action_type, data.description]);
  else await db.query(`INSERT INTO payment_promises (company_id,customer_id,invoice_id,created_by,promised_date,promised_amount,notes,status)
    VALUES (?,?,?,?,?,CAST(? AS DECIMAL(15,2)),?,'pending')`, [scope.companyId, customerId, data.invoice_id, scope.actorId, data.promised_date, data.promised_amount, data.notes]);
  const [[row]] = await db.query("SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id");
  return row.id;
}
export async function auditOperation(kind, id, customerId, data, scope, db) {
  const snapshot = { customer_id: customerId, invoice_id: data.invoice_id,
    ...(kind === "action" ? { action_type: data.action_type, status: "completed" } : { promised_date: data.promised_date, promised_amount: data.promised_amount, status: "pending" }) };
  await db.query(`INSERT INTO audit_logs (company_id,user_id,entity_type,entity_id,action,new_values)
    VALUES (?,?,?,?,'create',?)`, [scope.companyId, scope.actorId, kind === "action" ? "collection_action" : "payment_promise", id, JSON.stringify(snapshot)]);
}
