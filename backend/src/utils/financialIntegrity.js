export function financialError(code, message, status = 409) {
  return Object.assign(new Error(message), { code, status });
}

export function compatibleCompanies(left, right) {
  return left == null || right == null || String(left) === String(right);
}

// The schema and existing data only identify confirmed as applicable.
// Other legacy states remain readable/editable, but cannot carry applications.
export function isApplicablePayment(status) {
  return status === "confirmed";
}

export async function lockActiveCustomer(customerId, db) {
  const [rows] = await db.query(`
    SELECT id, company_id, status FROM customers
    WHERE id = ? AND deleted_at IS NULL
    LIMIT 1 FOR UPDATE
  `, [customerId]);
  if (!rows[0]) throw financialError("CUSTOMER_NOT_FOUND", "Cliente no encontrado", 404);
  if (rows[0].status !== "active") {
    throw financialError("CUSTOMER_INACTIVE", "El cliente no está activo");
  }
  return rows[0];
}

export async function validateCompanyCustomer(companyId, customer, db) {
  if (companyId != null) {
    const [rows] = await db.query(`
      SELECT id FROM companies WHERE id = ? AND deleted_at IS NULL LIMIT 1
    `, [companyId]);
    if (!rows[0]) throw financialError("COMPANY_NOT_FOUND", "Empresa no encontrada", 404);
  }
  if (!compatibleCompanies(companyId, customer.company_id)) {
    throw financialError("COMPANY_MISMATCH", "La empresa del documento no corresponde a la empresa del cliente");
  }
}
