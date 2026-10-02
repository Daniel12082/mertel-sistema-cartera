import pool from "../config/database.js";
const columns = "CAST(id AS CHAR) AS id, name, legal_name, tax_id, email, phone, address, city, country, status";
// Called only behind requireGlobalAdmin; no company creation in this phase.
export async function listCompanies() {
  const [rows] = await pool.query(`SELECT ${columns} FROM companies WHERE deleted_at IS NULL ORDER BY name,id`);
  return rows;
}
export async function findCompany(id) {
  const [rows] = await pool.query(`SELECT ${columns} FROM companies WHERE id=? AND deleted_at IS NULL`, [id]);
  return rows[0] ?? null;
}
