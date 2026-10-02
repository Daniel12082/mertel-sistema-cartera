import pool from "../config/database.js";
import { companyContext, validCompanyId } from "../utils/companyScope.js";

export async function requireCompanyScope(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, message: "Autenticación requerida" });
  let scope = companyContext(req.user);
  if (!scope.globalAdmin && scope.companyId === null) return res.status(403).json({ success: false, message: "No tienes una empresa asignada" });
  // Only global admins can narrow their scope. Tenant query/body/header values never change it.
  if (scope.globalAdmin && req.query.company_id !== undefined) {
    if (!validCompanyId(req.query.company_id)) return res.status(400).json({ success: false, message: "company_id inválido" });
    scope = Object.freeze({ ...scope, companyId: String(req.query.company_id) });
  }
  try {
    if (scope.companyId !== null) {
      const [companies] = await pool.query("SELECT status FROM companies WHERE id=? AND deleted_at IS NULL", [scope.companyId]);
      if (!companies[0] || (!scope.globalAdmin && companies[0].status !== "active")) {
        return res.status(scope.globalAdmin ? 404 : 403).json({ success: false, message: scope.globalAdmin ? "Empresa no encontrada" : "Empresa no disponible" });
      }
    }
    req.companyScope = scope;
    return next();
  } catch { return next(new Error("No se pudo verificar la empresa")); }
}
export function requireGlobalAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, message: "Autenticación requerida" });
  if (!companyContext(req.user).globalAdmin) return res.status(403).json({ success: false, message: "Se requiere administración global" });
  return next();
}
