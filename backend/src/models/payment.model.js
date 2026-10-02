import pool from "../config/database.js";

const paymentSelect = `
  SELECT
    p.id,
    p.company_id,
    p.customer_id,
    p.payment_date,
    p.amount,
    p.payment_method,
    p.reference,
    p.status,
    p.notes,
    p.created_by,
    p.created_at,
    p.updated_at,
    c.name AS customer_name,
    c.nit AS customer_nit,
    CAST(COALESCE(a.total_allocated, 0) AS DECIMAL(15,2)) AS total_allocated,
    CAST(p.amount - COALESCE(a.total_allocated, 0) AS DECIMAL(15,2)) AS available_amount
  FROM payments p
  LEFT JOIN customers c ON c.id = p.customer_id
  LEFT JOIN (
    SELECT payment_id, SUM(amount) AS total_allocated
    FROM payment_allocations
    WHERE deleted_at IS NULL
    GROUP BY payment_id
  ) a ON a.payment_id = p.id`;

export async function getAllPayments(db = pool) {
  const [rows] = await db.query(`
    ${paymentSelect}
    ORDER BY p.payment_date DESC, p.id DESC
  `);
  return rows;
}

export async function getPaymentById(id, db = pool) {
  const [rows] = await db.query(`
    ${paymentSelect}
    WHERE p.id = ?
    LIMIT 1
  `, [id]);
  return rows[0] || null;
}

export async function getPaymentForUpdate(id, db) {
  const [rows] = await db.query(`
    SELECT id, company_id, customer_id, amount, status
    FROM payments
    WHERE id = ?
    LIMIT 1
    FOR UPDATE
  `, [id]);
  return rows[0] || null;
}

export async function getActiveAllocatedAmount(paymentId, db = pool) {
  const [rows] = await db.query(`
    SELECT CAST(COALESCE(SUM(amount), 0) AS DECIMAL(15,2)) AS total_allocated
    FROM payment_allocations
    WHERE payment_id = ?
      AND deleted_at IS NULL
  `, [paymentId]);
  return rows[0].total_allocated;
}

export async function comparePaymentAmountToAllocated(amount, allocated, db) {
  const [rows] = await db.query(`
    SELECT CAST(? AS DECIMAL(15,2)) >= CAST(? AS DECIMAL(15,2)) AS sufficient
  `, [amount, allocated]);
  return Boolean(rows[0].sufficient);
}

export async function hasAnyAllocationRows(paymentId, db) {
  const [rows] = await db.query(
    "SELECT COUNT(*) > 0 AS has_allocations FROM payment_allocations WHERE payment_id = ?",
    [paymentId],
  );
  return Boolean(rows[0].has_allocations);
}

export async function customerExists(customerId, db = pool) {
  const [rows] = await db.query(`
    SELECT id FROM customers
    WHERE id = ? AND deleted_at IS NULL
    LIMIT 1
  `, [customerId]);
  return rows.length > 0;
}

export async function companyExists(companyId, db = pool) {
  const [rows] = await db.query(`
    SELECT id FROM companies
    WHERE id = ? AND deleted_at IS NULL
    LIMIT 1
  `, [companyId]);
  return rows.length > 0;
}

export async function userExists(userId, db = pool) {
  const [rows] = await db.query(`
    SELECT id FROM users
    WHERE id = ? AND deleted_at IS NULL
    LIMIT 1
  `, [userId]);
  return rows.length > 0;
}

export async function createPayment(payment, db = pool) {
  const {
    company_id = null,
    customer_id,
    payment_date,
    amount,
    payment_method = null,
    reference = null,
    status = "confirmed",
    notes = null,
    created_by = null,
  } = payment;
  const [result] = await db.query(`
    INSERT INTO payments (
      company_id, customer_id, payment_date, amount,
      payment_method, reference, status, notes, created_by
    ) VALUES (?, ?, ?, CAST(? AS DECIMAL(15,2)), ?, ?, ?, ?, ?)
  `, [company_id, customer_id, payment_date, amount, payment_method, reference, status, notes, created_by]);
  return result.insertId;
}

export async function updatePayment(id, payment, db) {
  const {
    company_id = null,
    customer_id,
    payment_date,
    amount,
    payment_method = null,
    reference = null,
    status = "confirmed",
    notes = null,
    created_by = null,
  } = payment;
  await db.query(`
    UPDATE payments
    SET company_id = ?, customer_id = ?, payment_date = ?,
        amount = CAST(? AS DECIMAL(15,2)), payment_method = ?,
        reference = ?, status = ?, notes = ?, created_by = ?
    WHERE id = ?
  `, [company_id, customer_id, payment_date, amount, payment_method, reference, status, notes, created_by, id]);
}
