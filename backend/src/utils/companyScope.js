// Scope is derived exclusively from the authenticated database user, never request data.
export function validCompanyId(value) {
  return (typeof value === "string" || Number.isSafeInteger(value)) && /^[1-9]\d{0,19}$/.test(String(value)) &&
    BigInt(value) <= 18446744073709551615n;
}
export function companyContext(user) {
  const globalAdmin = user?.company_id === null && user.roles?.some(role => role.name === "admin") === true;
  const companyId = validCompanyId(user?.company_id) ? String(user.company_id) : null;
  return Object.freeze({ globalAdmin, companyId, actorId: user?.id ?? null });
}
export function scopeError(message = "No tienes una empresa asignada", status = 403) {
  return Object.assign(new Error(message), { status });
}
export function companyFilter(scope, ...columns) {
  if (!scope || (!scope.globalAdmin && !validCompanyId(scope.companyId))) throw scopeError();
  if (scope.companyId === null && scope.globalAdmin) return { sql: "", values: [] };
  if (!validCompanyId(scope.companyId) || !columns.length || columns.some(column => !/^(?:[a-z_]+\.)?company_id$/.test(column))) {
    throw scopeError("Alcance empresarial inválido");
  }
  return { sql: ` AND ${columns.map(column => `${column} = ?`).join(" AND ")}`, values: columns.map(() => scope.companyId) };
}
export function sameCompany(left, right) {
  return left == null ? right == null : right != null && String(left) === String(right);
}
export function assertCompanyRecord(record, scope, message = "Recurso no encontrado") {
  companyFilter(scope, "company_id");
  if (!record || (scope.companyId !== null && !sameCompany(record.company_id, scope.companyId))) throw scopeError(message, 404);
}
export async function assertCompanyCustomerReference(record, db, scope, message) {
  const filter = companyFilter(scope, "company_id");
  if (!record || scope.companyId === null) return;
  // Ownership only: historical reversal must still work for inactive/deleted customers.
  const [rows] = await db.query(`SELECT id FROM customers WHERE id=? ${filter.sql}`, [record.customer_id, ...filter.values]);
  if (!rows.length) throw scopeError(message, 404);
}
export function documentCompany(document, customer, scope, existing) {
  assertCompanyRecord(customer, scope, "Cliente no encontrado");
  if (existing) {
    assertCompanyRecord(existing, scope);
    if (scope.globalAdmin && document.company_id !== undefined && !sameCompany(document.company_id, existing.company_id)) {
      throw scopeError("No se puede cambiar la empresa del documento", 409);
    }
  }
  const companyId = existing ? existing.company_id : scope.companyId ?? document.company_id ?? customer.company_id;
  if (!sameCompany(companyId, customer.company_id)) throw scopeError("La empresa del documento no corresponde a la empresa del cliente", 409);
  return companyId ?? null;
}
