import express from "express";
import { roleCatalog } from "../config/permissions.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { requireCompanyScope, requireGlobalAdmin } from "../middleware/companyScope.js";
import { findCompany, listCompanies } from "../models/company.model.js";
import { validCompanyId } from "../utils/companyScope.js";
import { getCollectionSettings, updateCollectionStageSettings } from "../services/collectionSettingsAdmin.service.js";
import { analyzePortfolioFile, listPortfolioImports, MAX_IMPORT_BYTES } from "../services/portfolioImport.service.js";
import { reconcilePortfolio } from "../services/portfolioReconciliation.service.js";
import { generatePortfolioPipeline, listImportedPipelineActions, recordImportedPipelineAction } from "../services/portfolioPipeline.service.js";
import { getCollectionDashboardController } from "../controllers/collectionDashboard.controller.js";
import { administrativeCollectionHistory, administrativeHistoryActors } from "../controllers/collectionHistory.controller.js";
const router = express.Router();
router.get("/collection/dashboard", requirePermission("collection.view"), requirePermission("settings.manage"), requireCompanyScope, getCollectionDashboardController);
router.get("/collection/history", requirePermission("history.view"), requirePermission("settings.manage"), requireCompanyScope, administrativeCollectionHistory);
router.get("/collection/history/actors", requirePermission("history.view"), requirePermission("settings.manage"), requireCompanyScope, administrativeHistoryActors);
router.post("/portfolio/imports/analyze", requirePermission("portfolio.import"), requireCompanyScope,
  express.raw({ type: ["text/csv", "application/csv", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], limit: MAX_IMPORT_BYTES }), async (req, res, next) => {
    try {
      if (!Buffer.isBuffer(req.body)) return res.status(400).json({ success: false, message: "Envía el contenido del archivo como CSV o XLSX" });
      res.set("Cache-Control", "no-store");
      const data = await analyzePortfolioFile({ scope: req.companyScope, actorId: req.user.id, fileName: req.query.file_name,
        mimeType: req.get("content-type")?.split(";")[0], bytes: req.body, ipAddress: req.ip, userAgent: req.get("user-agent") });
      return res.json({ success: true, data });
    } catch (error) {
      if ([400, 403, 404, 409, 413].includes(error.status)) return res.status(error.status).json({ success: false, message: error.message, code: error.code });
      return next(error);
    }
  });
router.post("/portfolio/imports/reconcile", requirePermission("portfolio.import"), requireCompanyScope,
  express.raw({ type: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], limit: MAX_IMPORT_BYTES }), async (req, res, next) => {
    try {
      if (!Buffer.isBuffer(req.body)) return res.status(400).json({ success: false, message: "Envía el contenido de la cartera MERTEL como XLSX" });
      res.set("Cache-Control", "no-store");
      return res.json({ success: true, data: await reconcilePortfolio({ bytes: req.body, scope: req.companyScope }) });
    } catch (error) {
      if ([400, 403, 404, 409].includes(error.status)) return res.status(error.status).json({ success: false, message: error.message, code: error.code });
      return next(error);
    }
  });
router.post("/portfolio/imports/pipeline", requirePermission("portfolio.import"), requireCompanyScope,
  express.raw({ type: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], limit: MAX_IMPORT_BYTES }), async (req, res, next) => {
    try {
      if (!Buffer.isBuffer(req.body)) return res.status(400).json({ success: false, message: "Envía el contenido de la cartera MERTEL como XLSX" });
      res.set("Cache-Control", "no-store");
      const data = await generatePortfolioPipeline({ bytes: req.body, scope: req.companyScope,
        referenceDate: req.query.reference_date, fileName: req.query.file_name });
      return res.json({ success: true, data });
    } catch (error) {
      if ([400, 403, 404, 413].includes(error.status)) return res.status(error.status).json({ success: false, message: error.message, code: error.code });
      return next(error);
    }
  });
router.get("/portfolio/imports/pipeline/actions", requirePermission("collection.view"), requireCompanyScope, async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store");
    return res.json({ success: true, data: await listImportedPipelineActions({ scope: req.companyScope, token: req.query.context_token }) });
  } catch (error) {
    if ([400, 403].includes(error.status)) return res.status(error.status).json({ success: false, message: error.message });
    return next(error);
  }
});
router.post("/portfolio/imports/pipeline/actions", requirePermission("collection.manage"), requireCompanyScope, async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store");
    const data = await recordImportedPipelineAction({ scope: req.companyScope, token: req.body?.context_token,
      body: req.body?.operation, ipAddress: req.ip, userAgent: req.get("user-agent") });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    if ([400, 403].includes(error.status)) return res.status(error.status).json({ success: false, message: error.message });
    return next(error);
  }
});
router.get("/portfolio/imports", requirePermission("portfolio.import"), requireCompanyScope, async (req, res, next) => {
  try { res.set("Cache-Control", "no-store"); return res.json({ success: true, data: await listPortfolioImports(req.companyScope) }); }
  catch (error) {
    if ([400, 403, 404, 503].includes(error.status)) return res.status(error.status).json({ success: false, message: error.message, code: error.code });
    return next(error);
  }
});
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
router.get("/settings", requirePermission("settings.manage"), requireCompanyScope, async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store");
    return res.json({ success: true, data: await getCollectionSettings(req.companyScope) });
  } catch (error) {
    if ([400, 403, 404, 409].includes(error.status)) return res.status(error.status).json({ success: false, message: error.message });
    return next(error);
  }
});
router.put("/settings/collection-rules", requirePermission("settings.manage"), requireCompanyScope, async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store");
    return res.json({ success: true, data: await updateCollectionStageSettings({ scope: req.companyScope,
      actorId: req.user.id, body: req.body, ipAddress: req.ip, userAgent: req.get("user-agent") }) });
  } catch (error) {
    if ([400, 403, 404, 409].includes(error.status)) return res.status(error.status).json({ success: false, message: error.message });
    return next(error);
  }
});
export default router;
