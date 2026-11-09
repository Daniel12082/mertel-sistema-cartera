import pool from "../config/database.js";
import { financialError, lockActiveCustomer, validateCompanyCustomer } from "../utils/financialIntegrity.js";
import { assertCompanyCustomerReference, companyFilter, documentCompany } from "../utils/companyScope.js";

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

const auditedFields = ["customer_id", "invoice_number", "issue_date", "due_date", "document_value", "base_value",
  "iva_value", "balance", "credit_days", "status", "promo_18", "discount", "email", "notes"];
const invoiceSnapshot = invoice => Object.fromEntries(auditedFields.map(field => [field, invoice[field] ?? null]));

async function auditInvoice(db, scope, action, invoice, before, after) {
  await db.query(`INSERT INTO audit_logs (company_id,user_id,entity_type,entity_id,action,old_values,new_values)
    VALUES (?,?,'invoice',?,?,?,?)`, [invoice.company_id, scope.actorId, invoice.id, action,
    before && JSON.stringify(before), JSON.stringify(after)]);
}

export async function getAllInvoices(scope) {
  const filter = companyFilter(scope, "i.company_id", "c.company_id");
  const [rows] = await pool.query(`
    SELECT ${invoiceColumns}
    FROM invoices i
    INNER JOIN customers c ON c.id = i.customer_id
    WHERE i.deleted_at IS NULL ${filter.sql}
    ORDER BY i.created_at DESC, i.id DESC
  `, filter.values);

  return rows;
}

export async function getInvoiceById(id, scope, db = pool) {
  const filter = companyFilter(scope, "i.company_id", "c.company_id");
  const [rows] = await db.query(
    `
      SELECT ${invoiceColumns}
      FROM invoices i
      INNER JOIN customers c ON c.id = i.customer_id
      WHERE i.id = ?
        AND i.deleted_at IS NULL ${filter.sql}
      LIMIT 1
    `,
    [id, ...filter.values],
  );

  return rows[0] || null;
}

export async function createInvoice(invoice, scope) {
  companyFilter(scope, "company_id");
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const customer = await lockActiveCustomer(invoice.customer_id, connection, scope);
    await validateCompanyCustomer(scope.companyId ?? invoice.company_id ?? customer.company_id, customer, connection);
    invoice = { ...invoice, company_id: documentCompany(invoice, customer, scope) };
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
    const [result] = await connection.query(
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

    const created = await getInvoiceById(result.insertId, scope, connection);
    await auditInvoice(connection, scope, "invoice_created", created, null, invoiceSnapshot(created));
    await connection.commit();
    return created;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

export async function updateInvoice(id, invoice, scope) {
  const filter = companyFilter(scope, "company_id");
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const customer = await lockActiveCustomer(invoice.customer_id, connection, scope);
    const [rows] = await connection.query(
      `SELECT invoices.*, CAST(company_id AS CHAR) AS company_id FROM invoices WHERE id = ? AND deleted_at IS NULL ${filter.sql} FOR UPDATE`, [id, ...filter.values],
    );
    const existing = rows[0];
    if (!existing) { await connection.commit(); return null; }
    await assertCompanyCustomerReference(existing, connection, scope, "Factura no encontrada");
    invoice = { ...invoice, company_id: documentCompany(invoice, customer, scope, existing) };
    const [history] = await connection.query(
      "SELECT COUNT(*) > 0 AS has_history FROM payment_allocations WHERE invoice_id = ?", [id],
    );
    if (history[0].has_history) {
      if (String(invoice.customer_id) !== String(existing.customer_id)) {
        throw financialError("INVOICE_CUSTOMER_IN_USE", "No se puede cambiar el cliente de una factura que tiene aplicaciones de pago o historial.");
      }
      if (String(invoice.company_id ?? null) !== String(existing.company_id)) {
        throw financialError("INVOICE_COMPANY_IN_USE", "No se puede cambiar la empresa de una factura que tiene aplicaciones de pago o historial.");
      }
    }
    if (String(invoice.customer_id) !== String(existing.customer_id) ||
        String(invoice.company_id ?? null) !== String(existing.company_id)) {
      const [promises] = await connection.query(
        "SELECT COUNT(*) > 0 AS has_history FROM payment_promises WHERE invoice_id = ?", [id],
      );
      if (promises[0].has_history) {
        throw financialError("INVOICE_PROMISE_IN_USE", "No se puede cambiar el cliente o la empresa de una factura con promesas de pago registradas.");
      }
    }
    await validateCompanyCustomer(invoice.company_id, customer, connection);
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
    const [result] = await connection.query(
      `
        UPDATE invoices
        SET
          company_id = ?,
          customer_id = ?,
          invoice_number = ?,
          issue_date = ?,
          due_date = ?,
          base_value = ?,
          iva_value = ?,
          credit_days = ?,
          status = ?,
          promo_18 = ?,
          discount = ?,
          email = ?,
          notes = ?,
          balance = CASE WHEN document_value = CAST(? AS DECIMAL(15,2)) THEN balance
            ELSE CAST(? AS DECIMAL(15,2)) - COALESCE((
            SELECT SUM(pa.amount)
            FROM payment_allocations pa
            WHERE pa.invoice_id = invoices.id
              AND pa.deleted_at IS NULL
          ), 0) END,
          document_value = ?
        WHERE id = ?
          AND deleted_at IS NULL ${filter.sql}
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
        base_value,
        iva_value,
        credit_days,
        status,
        promo_18,
        discount,
        email,
        notes,
        document_value,
        document_value,
        document_value,
        id,
        ...filter.values,
        document_value,
      ],
    );

    if (result.affectedRows === 0) {
      const current = await getInvoiceById(id, scope, connection);
      if (!current) { await connection.commit(); return null; }
      const error = new Error("El valor del documento no puede ser menor que las asignaciones activas");
      error.code = "INVOICE_VALUE_BELOW_ALLOCATIONS";
      throw error;
    }

    const updated = await getInvoiceById(id, scope, connection);
    await auditInvoice(connection, scope, "invoice_updated", updated, invoiceSnapshot(existing), invoiceSnapshot(updated));
    await connection.commit();
    return updated;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

export async function deleteInvoice(id, scope, { voidReason = null } = {}) {
  const filter = companyFilter(scope, "company_id");
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT * FROM invoices WHERE id = ? AND deleted_at IS NULL ${filter.sql} FOR UPDATE`, [id, ...filter.values],
    );
    const invoice = rows[0];
    if (!invoice) { await connection.commit(); return false; }
    await assertCompanyCustomerReference(invoice, connection, scope, "Factura no encontrada");
    if (!voidReason && Number(invoice.balance) > 0) throw financialError("INVOICE_HAS_BALANCE", "La factura no puede eliminarse porque tiene saldo pendiente.");
    const [allocations] = await connection.query(
      "SELECT COUNT(*) > 0 AS active FROM payment_allocations WHERE invoice_id = ? AND deleted_at IS NULL", [id],
    );
    if (allocations[0].active) throw financialError("INVOICE_HAS_ALLOCATIONS", "La factura no puede eliminarse porque tiene aplicaciones de pago activas.");
    const [promises] = await connection.query(
      "SELECT COUNT(*) > 0 AS pending FROM payment_promises WHERE invoice_id = ? AND status = 'pending'", [id],
    );
    if (promises[0].pending) throw financialError("INVOICE_HAS_PROMISES", "La factura no puede eliminarse porque tiene promesas de pago pendientes.");
    const status = voidReason ? "cancelled" : invoice.status;
    await connection.query(`UPDATE invoices SET deleted_at = NOW(), status = ? WHERE id = ? AND deleted_at IS NULL ${filter.sql}`, [status, id, ...filter.values]);
    const before = invoiceSnapshot(invoice);
    await auditInvoice(connection, scope, voidReason ? "invoice_voided" : "invoice_deleted", invoice,
      before, { ...before, status, deleted: true, reason: voidReason });
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}
