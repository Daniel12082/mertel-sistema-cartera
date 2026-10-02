import pool from "../config/database.js";
import { financialError } from "../utils/financialIntegrity.js";

export async function getAllCustomers() {
  const [rows] = await pool.query(`
    SELECT
      id,
      company_id,
      nit,
      name,
      phone,
      email,
      address,
      city,
      credit_limit,
      available_credit,
      status,
      notes,
      created_at,
      updated_at
    FROM customers
    WHERE deleted_at IS NULL
    ORDER BY name ASC
  `);

  return rows;
}

export async function getCustomerById(id) {
  const [rows] = await pool.query(
    `
      SELECT
        id,
        company_id,
        nit,
        name,
        phone,
        email,
        address,
        city,
        credit_limit,
        available_credit,
        status,
        notes,
        created_at,
        updated_at
      FROM customers
      WHERE id = ?
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [id],
  );

  return rows[0] || null;
}

export async function createCustomer(customer) {
  const {
    company_id = null,
    nit,
    name,
    phone = null,
    email = null,
    address = null,
    city = null,
    credit_limit = 0,
    available_credit = 0,
    status = "active",
    notes = null,
  } = customer;

  const [result] = await pool.query(
    `
      INSERT INTO customers (
        company_id,
        nit,
        name,
        phone,
        email,
        address,
        city,
        credit_limit,
        available_credit,
        status,
        notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      company_id,
      nit,
      name,
      phone,
      email,
      address,
      city,
      credit_limit,
      available_credit,
      status,
      notes,
    ],
  );

  return {
    id: result.insertId,
    company_id,
    nit,
    name,
    phone,
    email,
    address,
    city,
    credit_limit,
    available_credit,
    status,
    notes,
  };
}

export async function updateCustomer(id, customer) {
  const {
    nit,
    name,
    phone = null,
    email = null,
    address = null,
    city = null,
    credit_limit = 0,
    available_credit = 0,
    status = "active",
    notes = null,
  } = customer;

  const [result] = await pool.query(
    `
      UPDATE customers
      SET
        nit = ?,
        name = ?,
        phone = ?,
        email = ?,
        address = ?,
        city = ?,
        credit_limit = ?,
        available_credit = ?,
        status = ?,
        notes = ?
      WHERE id = ?
        AND deleted_at IS NULL
    `,
    [
      nit,
      name,
      phone,
      email,
      address,
      city,
      credit_limit,
      available_credit,
      status,
      notes,
      id,
    ],
  );

  if (result.affectedRows === 0) {
    return null;
  }

  return await getCustomerById(id);
}

export async function deleteCustomer(id) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // Creations/reassignments lock this same parent before writing.
    const [customers] = await connection.query(
      "SELECT id FROM customers WHERE id = ? AND deleted_at IS NULL FOR UPDATE", [id],
    );
    if (!customers[0]) { await connection.commit(); return false; }
    const [dependencies] = await connection.query(`
      SELECT
        EXISTS(SELECT 1 FROM invoices WHERE customer_id = ? AND deleted_at IS NULL AND balance > 0) AS debt,
        EXISTS(SELECT 1 FROM payments WHERE customer_id = ?) AS payments,
        EXISTS(SELECT 1 FROM payment_allocations a
          JOIN invoices i ON i.id = a.invoice_id
          JOIN payments p ON p.id = a.payment_id
          WHERE a.deleted_at IS NULL AND (i.customer_id = ? OR p.customer_id = ?)) AS allocations,
        EXISTS(SELECT 1 FROM payment_promises WHERE customer_id = ? AND status = 'pending') AS promises
    `, [id, id, id, id, id]);
    const dependency = dependencies[0];
    if (dependency.debt) throw financialError("CUSTOMER_HAS_DEBT", "El cliente no puede eliminarse porque tiene cartera pendiente.");
    if (dependency.payments) throw financialError("CUSTOMER_HAS_PAYMENTS", "El cliente no puede eliminarse porque tiene pagos registrados e historial financiero.");
    if (dependency.allocations) throw financialError("CUSTOMER_HAS_ALLOCATIONS", "El cliente no puede eliminarse porque tiene aplicaciones de pago activas.");
    if (dependency.promises) throw financialError("CUSTOMER_HAS_PROMISES", "El cliente no puede eliminarse porque tiene promesas de pago pendientes.");
    await connection.query("UPDATE customers SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL", [id]);
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}
