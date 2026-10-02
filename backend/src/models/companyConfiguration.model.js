import pool from "../config/database.js";
import { validCompanyId } from "../utils/companyScope.js";

function requireCompanyId(companyId) {
  if (!validCompanyId(companyId)) throw new TypeError("La configuración empresarial exige company_id explícito");
}
// Internal loaders: call with a company authorized by the backend, never a raw request identifier.
// Legacy NULL settings/templates are deliberately excluded; there is no commercial global fallback.
export async function getCompanySettings(companyId, db = pool) {
  requireCompanyId(companyId);
  const [rows] = await db.query(`SELECT setting_key, setting_value, value_type FROM settings
    WHERE company_id=? ORDER BY setting_key,id`, [companyId]);
  return rows;
}
export async function getCompanyMessageTemplates(companyId, { channel, stage } = {}, db = pool) {
  requireCompanyId(companyId);
  const clauses = ["company_id=?", "status='active'"];
  const values = [companyId];
  for (const [column, value] of [["channel", channel], ["stage", stage]]) {
    if (value !== undefined) {
      if (typeof value !== "string" || !value.trim()) throw new TypeError("Canal/etapa inválido");
      clauses.push(`${column}=?`); values.push(value);
    }
  }
  const [rows] = await db.query(`SELECT id,company_id,name,channel,stage,subject,content,status
    FROM message_templates WHERE ${clauses.join(" AND ")} ORDER BY id`, values);
  return rows;
}
