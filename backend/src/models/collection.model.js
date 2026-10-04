import pool from "../config/database.js";
import { companyFilter } from "../utils/companyScope.js";

export async function getActiveCollectionCustomers(scope, db = pool) {
  const company = companyFilter(scope, "c.company_id");
  const [rows] = await db.query(`
    SELECT c.id, c.company_id, c.name, c.nit, c.phone, c.email
    FROM customers c
    WHERE c.deleted_at IS NULL AND c.status = 'active' ${company.sql}
    ORDER BY c.name ASC, c.id ASC
  `, company.values);
  return rows;
}

export async function getCollectionOpenInvoices(scope, db = pool) {
  const company = companyFilter(scope, "i.company_id", "c.company_id");
  const [rows] = await db.query(`
    SELECT i.id AS invoice_id, i.company_id, i.customer_id, i.invoice_number,
      i.issue_date, i.due_date, i.document_value, i.balance, i.status AS invoice_status
    FROM invoices i
    INNER JOIN customers c ON c.id = i.customer_id
    WHERE i.deleted_at IS NULL AND c.deleted_at IS NULL AND c.status = 'active'
      AND i.balance > 0 ${company.sql}
    ORDER BY c.name ASC, i.due_date ASC, i.id ASC
  `, company.values);
  return rows;
}
