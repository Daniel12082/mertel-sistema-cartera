import pool from "../config/database.js";

const invoiceColumns = `
  i.id,
  i.company_id,
  i.customer_id,
  i.invoice_number,
  i.issue_date,
  i.due_date,
  i.document_value,
  i.base_value,
  i.iva_value,
  i.balance,
  i.credit_days,
  i.status,
  i.promo_18,
  i.discount,
  i.email,
  i.notes,
  i.created_at,
  i.updated_at,
  c.name AS customer_name,
  c.nit AS customer_nit`;

function customerNotFoundError() {
  const error = new Error("Cliente no encontrado");
  error.code = "CUSTOMER_NOT_FOUND";
  return error;
}

async function ensureCustomerExists(customerId) {
  const [rows] = await pool.query(
    `
      SELECT id
      FROM customers
      WHERE id = ?
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [customerId],
  );

  if (rows.length === 0) {
    throw customerNotFoundError();
  }
}

export async function getAllInvoices() {
  const [rows] = await pool.query(`
    SELECT ${invoiceColumns}
    FROM invoices i
    INNER JOIN customers c ON c.id = i.customer_id
    WHERE i.deleted_at IS NULL
    ORDER BY i.created_at DESC, i.id DESC
  `);

  return rows;
}

export async function getInvoiceById(id) {
  const [rows] = await pool.query(
    `
      SELECT ${invoiceColumns}
      FROM invoices i
      INNER JOIN customers c ON c.id = i.customer_id
      WHERE i.id = ?
        AND i.deleted_at IS NULL
      LIMIT 1
    `,
    [id],
  );

  return rows[0] || null;
}

export async function createInvoice(invoice) {
  await ensureCustomerExists(invoice.customer_id);

  const {
    company_id = null,
    customer_id,
    invoice_number,
    issue_date = null,
    due_date = null,
    document_value,
    base_value,
    iva_value,
    credit_days = null,
    status = "pending",
    promo_18 = null,
    discount = null,
    email = null,
    notes = null,
  } = invoice;
  const [result] = await pool.query(
    `
      INSERT INTO invoices (
        company_id,
        customer_id,
        invoice_number,
        issue_date,
        due_date,
        document_value,
        base_value,
        iva_value,
        balance,
        credit_days,
        status,
        promo_18,
        discount,
        email,
        notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      company_id,
      customer_id,
      invoice_number,
      issue_date,
      due_date,
      document_value,
      base_value,
      iva_value,
      document_value,
      credit_days,
      status,
      promo_18,
      discount,
      email,
      notes,
    ],
  );

  return await getInvoiceById(result.insertId);
}

export async function updateInvoice(id, invoice) {
  const existing = await getInvoiceById(id);
  if (!existing) {
    return null;
  }

  await ensureCustomerExists(invoice.customer_id);

  const {
    company_id = null,
    customer_id,
    invoice_number,
    issue_date = null,
    due_date = null,
    document_value,
    base_value,
    iva_value,
    credit_days = null,
    status = "pending",
    promo_18 = null,
    discount = null,
    email = null,
    notes = null,
  } = invoice;
  const [result] = await pool.query(
    `
      UPDATE invoices
      SET
        company_id = ?,
        customer_id = ?,
        invoice_number = ?,
        issue_date = ?,
        due_date = ?,
        document_value = ?,
        base_value = ?,
        iva_value = ?,
        credit_days = ?,
        status = ?,
        promo_18 = ?,
        discount = ?,
        email = ?,
        notes = ?,
        balance = CAST(? AS DECIMAL(15,2)) - COALESCE((
          SELECT SUM(pa.amount)
          FROM payment_allocations pa
          WHERE pa.invoice_id = invoices.id
            AND pa.deleted_at IS NULL
        ), 0)
      WHERE id = ?
        AND deleted_at IS NULL
        AND CAST(? AS DECIMAL(15,2)) >= COALESCE((
          SELECT SUM(pa.amount)
          FROM payment_allocations pa
          WHERE pa.invoice_id = invoices.id
            AND pa.deleted_at IS NULL
        ), 0)
    `,
    [
      company_id,
      customer_id,
      invoice_number,
      issue_date,
      due_date,
      document_value,
      base_value,
      iva_value,
      credit_days,
      status,
      promo_18,
      discount,
      email,
      notes,
      document_value,
      id,
      document_value,
    ],
  );

  if (result.affectedRows === 0) {
    const current = await getInvoiceById(id);
    if (!current) return null;
    const error = new Error("El valor del documento no puede ser menor que las asignaciones activas");
    error.code = "INVOICE_VALUE_BELOW_ALLOCATIONS";
    throw error;
  }

  return await getInvoiceById(id);
}

export async function deleteInvoice(id) {
  const [result] = await pool.query(
    `
      UPDATE invoices
      SET deleted_at = NOW()
      WHERE id = ?
        AND deleted_at IS NULL
    `,
    [id],
  );

  return result.affectedRows > 0;
}
