import pool from "../config/database.js";

const portfolioBase = `
  FROM invoices i
  INNER JOIN customers c ON c.id = i.customer_id
  WHERE i.deleted_at IS NULL
    AND c.deleted_at IS NULL
    AND i.balance > 0
`;

function openInvoiceFilters(criteria) {
  const clauses = [];
  const values = [];
  if (criteria.customerId !== undefined) {
    clauses.push("i.customer_id = ?");
    values.push(criteria.customerId);
  }
  if (criteria.status === "current") {
    clauses.push("i.due_date > CAST(? AS DATE)");
    values.push(criteria.referenceDate);
  } else if (criteria.status === "due_today") {
    clauses.push("i.due_date = CAST(? AS DATE)");
    values.push(criteria.referenceDate);
  } else if (criteria.status === "overdue") {
    clauses.push("i.due_date < CAST(? AS DATE)");
    values.push(criteria.referenceDate);
  } else if (criteria.status === "no_due_date") {
    clauses.push("i.due_date IS NULL");
  }
  if (criteria.overdue === true) {
    clauses.push("i.due_date < CAST(? AS DATE)");
    values.push(criteria.referenceDate);
  } else if (criteria.overdue === false) {
    clauses.push("(i.due_date IS NULL OR i.due_date >= CAST(? AS DATE))");
    values.push(criteria.referenceDate);
  }
  if (criteria.dueFrom) {
    clauses.push("i.due_date >= CAST(? AS DATE)");
    values.push(criteria.dueFrom);
  }
  if (criteria.dueTo) {
    clauses.push("i.due_date <= CAST(? AS DATE)");
    values.push(criteria.dueTo);
  }
  return { sql: clauses.length ? `AND ${clauses.join(" AND ")}` : "", values };
}

function invoiceOrder(criteria) {
  const direction = criteria.sortOrder === "desc" ? "DESC" : "ASC";
  if (criteria.sortBy === "balance") return `i.balance ${direction}, i.id ASC`;
  if (criteria.sortBy === "customer") return `c.name ${direction}, i.due_date ASC, i.id ASC`;
  return `(i.due_date IS NULL) ASC, i.due_date ${direction}, i.id ASC`;
}

const aggregateColumns = `
  CAST(COALESCE(SUM(i.document_value), 0) AS DECIMAL(15,2)) AS total_document_value,
  CAST(COALESCE(SUM(i.balance), 0) AS DECIMAL(15,2)) AS total_balance,
  CAST(COALESCE(SUM(CASE WHEN i.due_date < CAST(? AS DATE) THEN i.balance ELSE 0 END), 0) AS DECIMAL(15,2)) AS total_overdue_balance,
  CAST(COALESCE(SUM(CASE WHEN i.due_date >= CAST(? AS DATE) THEN i.balance ELSE 0 END), 0) AS DECIMAL(15,2)) AS total_current_balance,
  CAST(COALESCE(SUM(CASE WHEN i.due_date IS NULL THEN i.balance ELSE 0 END), 0) AS DECIMAL(15,2)) AS total_no_due_date_balance`;

export async function getPortfolioInvoices(criteria) {
  const filters = openInvoiceFilters(criteria);
  const [rows] = await pool.query(`
    SELECT
      i.id AS invoice_id,
      i.invoice_number,
      i.customer_id,
      c.name AS customer_name,
      c.nit AS customer_nit,
      i.issue_date,
      i.due_date,
      i.document_value,
      i.balance,
      i.status AS invoice_status
    ${portfolioBase}
      ${filters.sql}
    ORDER BY ${invoiceOrder(criteria)}
  `, filters.values);
  return rows;
}

export async function getPortfolioTotals(referenceDate) {
  const [rows] = await pool.query(`
    SELECT ${aggregateColumns}
    ${portfolioBase}
  `, [referenceDate, referenceDate]);
  return rows[0];
}

export async function getPortfolioCustomers(referenceDate) {
  const [rows] = await pool.query(`
    SELECT
      i.customer_id,
      c.name AS customer_name,
      c.nit AS customer_nit,
      ${aggregateColumns},
      COUNT(*) AS open_invoice_count
    ${portfolioBase}
    GROUP BY i.customer_id, c.name, c.nit
    ORDER BY c.name ASC, i.customer_id ASC
  `, [referenceDate, referenceDate]);
  return rows;
}

export async function getActiveCustomer(customerId) {
  const [rows] = await pool.query(`
    SELECT id AS customer_id, name AS customer_name, nit AS customer_nit
    FROM customers
    WHERE id = ? AND deleted_at IS NULL
    LIMIT 1
  `, [customerId]);
  return rows[0] || null;
}

export async function getCustomerPortfolioTotals(customerId, referenceDate) {
  const [rows] = await pool.query(`
    SELECT ${aggregateColumns}
    ${portfolioBase}
      AND i.customer_id = ?
  `, [referenceDate, referenceDate, customerId]);
  return rows[0];
}

export async function getPortfolioReconciliation() {
  const [rows] = await pool.query(`
    SELECT
      i.id AS invoice_id,
      i.invoice_number,
      i.customer_id,
      c.name AS customer_name,
      i.document_value,
      i.balance AS stored_balance,
      CAST(COALESCE(a.active_allocated, 0) AS DECIMAL(15,2)) AS active_allocated,
      CAST(i.document_value - COALESCE(a.active_allocated, 0) AS DECIMAL(15,2)) AS expected_balance,
      CAST(i.balance - (i.document_value - COALESCE(a.active_allocated, 0)) AS DECIMAL(15,2)) AS difference
    FROM invoices i
    INNER JOIN customers c ON c.id = i.customer_id
    LEFT JOIN (
      SELECT invoice_id, SUM(amount) AS active_allocated
      FROM payment_allocations
      WHERE deleted_at IS NULL
      GROUP BY invoice_id
    ) a ON a.invoice_id = i.id
    WHERE i.deleted_at IS NULL
      AND c.deleted_at IS NULL
      AND i.balance <> i.document_value - COALESCE(a.active_allocated, 0)
    ORDER BY i.id ASC
  `);
  return rows;
}
