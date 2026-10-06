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
      DATE_FORMAT(i.issue_date, '%Y-%m-%d') AS issue_date,
      DATE_FORMAT(i.due_date, '%Y-%m-%d') AS due_date,
      i.document_value, i.base_value, i.promo_18, i.balance, i.status AS invoice_status
    FROM invoices i
    INNER JOIN customers c ON c.id = i.customer_id
    WHERE i.deleted_at IS NULL AND c.deleted_at IS NULL AND c.status = 'active'
      AND i.balance > 0 ${company.sql}
    ORDER BY c.name ASC, i.due_date ASC, i.id ASC
  `, company.values);
  return rows;
}

export async function getPendingCollectionPromises(scope, db = pool) {
  const company = companyFilter(scope, "p.company_id", "c.company_id");
  const [rows] = await db.query(`
    SELECT p.id, p.company_id, p.customer_id, p.invoice_id, p.promised_date,
      p.promised_amount, p.status, p.created_at
    FROM payment_promises p
    INNER JOIN customers c ON c.id = p.customer_id
    WHERE p.status = 'pending' AND c.deleted_at IS NULL AND c.status = 'active'
      ${company.sql}
    ORDER BY p.created_at DESC, p.id DESC
  `, company.values);
  return rows;
}
