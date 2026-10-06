import pool from "../config/database.js";
import { MERTEL_COMPANY_NAME } from "../services/mertelCompany.service.js";
const columns = "CAST(id AS CHAR) AS id, name, legal_name, tax_id, email, phone, address, city, country, status";
// Read-only compatibility endpoints expose only MERTEL; application routes cannot switch context.
export async function listCompanies() {
  const [rows] = await pool.query(`SELECT ${columns} FROM companies WHERE name=? AND status='active' AND deleted_at IS NULL ORDER BY id LIMIT 1`, [MERTEL_COMPANY_NAME]);
  return rows;
}
export async function findCompany(id) {
  const [rows] = await pool.query(`SELECT ${columns} FROM companies WHERE id=? AND name=? AND status='active' AND deleted_at IS NULL`, [id, MERTEL_COMPANY_NAME]);
  return rows[0] ?? null;
}
