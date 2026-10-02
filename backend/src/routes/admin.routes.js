import express from "express";
import { roleCatalog } from "../config/permissions.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { requireGlobalAdmin } from "../middleware/companyScope.js";
import { findCompany, listCompanies } from "../models/company.model.js";
import { validCompanyId } from "../utils/companyScope.js";
const router = express.Router();
router.get("/companies", requirePermission("companies.view"), requireGlobalAdmin, async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store");
    return res.json({ success: true, data: await listCompanies() });
  } catch { return next(new Error("No se pudieron consultar las empresas")); }
});
router.get("/companies/:id", requirePermission("companies.view"), requireGlobalAdmin, async (req, res, next) => {
  if (!validCompanyId(req.params.id)) return res.status(400).json({ success: false, message: "ID de empresa inválido" });
  try {
    res.set("Cache-Control", "no-store");
    const company = await findCompany(req.params.id);
    if (!company) return res.status(404).json({ success: false, message: "Empresa no encontrada" });
    return res.json({ success: true, data: company });
  } catch { return next(new Error("No se pudo consultar la empresa")); }
});
router.get("/roles", requirePermission("roles.view"), (req, res) => {
  res.set("Cache-Control", "no-store");
  return res.json({ success: true, data: roleCatalog() });
});
export default router;
