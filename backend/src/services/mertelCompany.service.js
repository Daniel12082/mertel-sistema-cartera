export const MERTEL_COMPANY_NAME = "MERTEL IMPORTACIONES";
const PROVISION_LOCK = "mertel_single_company_provision_v1";

export async function resolveMertelCompany(db) {
  const [rows] = await db.query(
    "SELECT CAST(id AS CHAR) AS id, name, status, deleted_at FROM companies WHERE name=? ORDER BY id LIMIT 2",
    [MERTEL_COMPANY_NAME],
  );
  if (rows.length !== 1 || rows[0].status !== "active" || rows[0].deleted_at !== null) {
    throw Object.assign(new Error("El contexto único de MERTEL no está provisionado o requiere revisión."), { status: 503 });
  }
  return rows[0];
}

export async function provisionMertelCompany(db) {
  const [[{ acquired }]] = await db.query("SELECT GET_LOCK(?, 10) AS acquired", [PROVISION_LOCK]);
  if (acquired !== 1) throw new Error("No se pudo adquirir el bloqueo de provisioning de MERTEL.");
  try {
    const [rows] = await db.query(
      "SELECT CAST(id AS CHAR) AS id, name, status, deleted_at FROM companies WHERE name=? ORDER BY id LIMIT 2",
      [MERTEL_COMPANY_NAME],
    );
    if (rows.length > 1) throw new Error("Hay más de un registro MERTEL; requiere revisión manual.");
    if (rows.length === 1) {
      if (rows[0].status !== "active" || rows[0].deleted_at !== null) {
        throw new Error("El registro MERTEL existente no está activo; no se modificó.");
      }
      return { company: rows[0], created: false };
    }
    const [insert] = await db.query("INSERT INTO companies (name, status) VALUES (?, 'active')", [MERTEL_COMPANY_NAME]);
    const [[company]] = await db.query(
      "SELECT CAST(id AS CHAR) AS id, name, status, deleted_at FROM companies WHERE id=?",
      [insert.insertId],
    );
    return { company, created: true };
  } finally {
    await db.query("SELECT RELEASE_LOCK(?)", [PROVISION_LOCK]);
  }
}
