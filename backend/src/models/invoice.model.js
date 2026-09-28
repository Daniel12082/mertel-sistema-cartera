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
  i.balance AS balance_days,
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

export function calculateDiscountFromRule(baseValue, rule) {
  if (!rule || rule.active !== true) {
    return null;
  }

  if (rule.baseCalculation !== "base_value") {
    throw new Error("Regla de descuento con base de cálculo no soportada");
  }

  const percentage = Number(rule.percentage);
  if (!Number.isFinite(percentage) || percentage < 0) {
    throw new Error("Regla de descuento con porcentaje inválido");
  }

  return Math.round((Number(baseValue) * percentage) / 100);
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

export async function createInvoice(invoice, discountRule = null) {
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
    balance_days = 0,
    credit_days = null,
    status = "pending",
    promo_18 = null,
    discount = null,
    email = null,
    notes = null,
  } = invoice;
  const resolvedDiscount = discountRule
    ? calculateDiscountFromRule(base_value, discountRule)
    : discount;

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
      balance_days,
      credit_days,
      status,
      promo_18,
      resolvedDiscount,
      email,
      notes,
    ],
  );

  return await getInvoiceById(result.insertId);
}

export async function updateInvoice(id, invoice, discountRule = null) {
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
        balance_days = 0,
    credit_days = null,
    status = "pending",
    promo_18 = null,
    discount = null,
    email = null,
    notes = null,
  } = invoice;
  const resolvedDiscount = discountRule
    ? calculateDiscountFromRule(base_value, discountRule)
    : discount;

  await pool.query(
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
        balance = ?,
        credit_days = ?,
        status = ?,
        promo_18 = ?,
        discount = ?,
        email = ?,
        notes = ?
      WHERE id = ?
        AND deleted_at IS NULL
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
      balance_days,
      credit_days,
      status,
      promo_18,
      resolvedDiscount,
      email,
      notes,
      id,
    ],
  );

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
