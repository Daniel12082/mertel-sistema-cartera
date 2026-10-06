import pool from "../config/database.js";
import { companyContext, validCompanyId } from "../utils/companyScope.js";
import { resolveMertelCompany } from "../services/mertelCompany.service.js";

export async function requireCompanyScope(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, message: "Autenticación requerida" });
  try {
    const identity = companyContext(req.user);
    const company = await resolveMertelCompany(pool);
    if (identity.companyId !== null && identity.companyId !== company.id) {
      return res.status(403).json({ success: false, message: "La cuenta no pertenece al contexto MERTEL." });
    }
    if (req.query.company_id !== undefined) {
      if (!validCompanyId(req.query.company_id)) return res.status(400).json({ success: false, message: "company_id inválido" });
      if (String(req.query.company_id) !== company.id) return res.status(403).json({ success: false, message: "El contexto MERTEL no se puede cambiar." });
    }
    req.companyScope = Object.freeze({ ...identity, companyId: company.id, companyName: company.name });
    return next();
  } catch (error) {
    if (error.status === 503) return res.status(503).json({ success: false, message: "El contexto MERTEL no está disponible." });
    return next(new Error("No se pudo resolver el contexto MERTEL"));
  }
}
export function requireGlobalAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, message: "Autenticación requerida" });
  if (!companyContext(req.user).globalAdmin) return res.status(403).json({ success: false, message: "Se requiere administración global" });
  return next();
}
