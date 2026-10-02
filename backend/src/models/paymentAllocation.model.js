import pool from "../config/database.js";

export async function getAllocationsByPayment(paymentId, db = pool) {
  const [rows] = await db.query(`
    SELECT
      pa.id,
      pa.payment_id,
      pa.invoice_id,
      i.invoice_number,
      pa.amount,
      pa.created_at
    FROM payment_allocations pa
    INNER JOIN invoices i ON i.id = pa.invoice_id
    WHERE pa.payment_id = ?
      AND pa.deleted_at IS NULL
    ORDER BY pa.created_at ASC, pa.id ASC
  `, [paymentId]);
  return rows;
}

export async function getInvoiceForUpdate(invoiceId, db, includeDeleted = false) {
  const activeFilter = includeDeleted ? "" : "AND deleted_at IS NULL";
  const [rows] = await db.query(`
    SELECT id, company_id, customer_id, balance, status
    FROM invoices
    WHERE id = ? ${activeFilter}
    LIMIT 1
    FOR UPDATE
  `, [invoiceId]);
  return rows[0] || null;
}

export async function getAllocationForPaymentInvoice(paymentId, invoiceId, db) {
  const [rows] = await db.query(`
    SELECT id, deleted_at
    FROM payment_allocations
    WHERE payment_id = ? AND invoice_id = ?
      AND deleted_at IS NULL
    LIMIT 1
    FOR UPDATE
  `, [paymentId, invoiceId]);
  return rows[0] || null;
}

export async function insertAllocation(paymentId, invoiceId, amount, db) {
  const [result] = await db.query(`
    INSERT INTO payment_allocations (payment_id, invoice_id, amount)
    VALUES (?, ?, CAST(? AS DECIMAL(15,2)))
  `, [paymentId, invoiceId, amount]);
  return result.insertId;
}

export async function getAllocationById(id, db = pool) {
  const [rows] = await db.query(`
    SELECT
      pa.id,
      pa.payment_id,
      pa.invoice_id,
      i.invoice_number,
      pa.amount,
      pa.created_at,
      pa.deleted_at
    FROM payment_allocations pa
    INNER JOIN invoices i ON i.id = pa.invoice_id
    WHERE pa.id = ?
    LIMIT 1
  `, [id]);
  return rows[0] || null;
}

export async function getAllocationForUpdate(paymentId, allocationId, db) {
  const [rows] = await db.query(`
    SELECT id, payment_id, invoice_id, amount, deleted_at
    FROM payment_allocations
    WHERE payment_id = ? AND id = ?
    LIMIT 1
    FOR UPDATE
  `, [paymentId, allocationId]);
  return rows[0] || null;
}

export async function getAllocationInvoiceId(paymentId, allocationId, db = pool) {
  const [rows] = await db.query(`
    SELECT invoice_id
    FROM payment_allocations
    WHERE payment_id = ? AND id = ?
    LIMIT 1
  `, [paymentId, allocationId]);
  return rows[0]?.invoice_id ?? null;
}

export async function reduceInvoiceBalance(invoiceId, amount, db) {
  const [result] = await db.query(`
    UPDATE invoices
    SET balance = balance - CAST(? AS DECIMAL(15,2))
    WHERE id = ?
      AND deleted_at IS NULL
      AND balance >= CAST(? AS DECIMAL(15,2))
  `, [amount, invoiceId, amount]);
  return result.affectedRows === 1;
}

export async function increaseInvoiceBalance(invoiceId, amount, db) {
  const [result] = await db.query(`
    UPDATE invoices
    SET balance = balance + CAST(? AS DECIMAL(15,2))
    WHERE id = ?
  `, [amount, invoiceId]);
  return result.affectedRows === 1;
}

export async function softDeleteAllocation(paymentId, allocationId, db) {
  const [result] = await db.query(`
    UPDATE payment_allocations
    SET deleted_at = NOW()
    WHERE payment_id = ?
      AND id = ?
      AND deleted_at IS NULL
  `, [paymentId, allocationId]);
  return result.affectedRows === 1;
}

export async function hasEnoughPaymentAvailable(paymentAmount, allocatedAmount, newAmount, db) {
  const [rows] = await db.query(`
    SELECT CAST(? AS DECIMAL(15,2)) >=
      CAST(? AS DECIMAL(15,2)) + CAST(? AS DECIMAL(15,2)) AS sufficient
  `, [paymentAmount, allocatedAmount, newAmount]);
  return Boolean(rows[0].sufficient);
}

export async function hasEnoughInvoiceBalance(balance, amount, db) {
  const [rows] = await db.query(`
    SELECT CAST(? AS DECIMAL(15,2)) >= CAST(? AS DECIMAL(15,2)) AS sufficient
  `, [balance, amount]);
  return Boolean(rows[0].sufficient);
}

export async function getInvoiceBalance(invoiceId, db = pool) {
  const [rows] = await db.query("SELECT balance FROM invoices WHERE id = ? LIMIT 1", [invoiceId]);
  return rows[0]?.balance ?? null;
}
