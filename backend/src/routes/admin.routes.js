import express from "express";
import { requirePermission } from "../middleware/requirePermission.js";
import { requireCompanyScope, requireGlobalAdmin } from "../middleware/companyScope.js";
import { findCompany, listCompanies } from "../models/company.model.js";
import { validCompanyId } from "../utils/companyScope.js";
import { getCollectionSettings, updateCollectionStageSettings } from "../services/collectionSettingsAdmin.service.js";
import { analyzePortfolioFile, listPortfolioImports, MAX_IMPORT_BYTES } from "../services/portfolioImport.service.js";
import { reconcilePortfolio } from "../services/portfolioReconciliation.service.js";
import { generatePortfolioPipeline, listImportedPipelineActions, recordImportedPipelineAction } from "../services/portfolioPipeline.service.js";
import { getCollectionDashboardController } from "../controllers/collectionDashboard.controller.js";
import { analyzeCustomerResolution, decideCustomerResolution, getCustomerResolution, getCustomerResolutionDashboard } from "../services/customerResolution.service.js";
import { administrativeCollectionHistory, administrativeHistoryActors } from "../controllers/collectionHistory.controller.js";
import { getAdminDashboard } from "../services/adminDashboard.service.js";
import {listManagedUsers,saveManagedUser} from '../services/userManagement.service.js';
import {listRoleCatalog,saveCustomRole} from '../services/roleManagement.service.js';
import {changeManagedPassword,recoveryStatus,verifyRecoveryMail} from '../services/passwordRecovery.service.js';
const router = express.Router();
function managedUsers(handler){return async(req,res)=>{try{res.set('Cache-Control','no-store');return res.json({success:true,data:await handler(req)});}catch(error){const status=[400,403,404,409].includes(error.status)?error.status:500;return res.status(status).json({success:false,message:status===500?'No se pudo guardar o consultar el usuario.':error.message});}};}
router.get('/users',requirePermission('users.view'),requireCompanyScope,managedUsers(req=>listManagedUsers(req.companyScope)));
router.post('/users',requirePermission('users.create'),requireCompanyScope,managedUsers(req=>saveManagedUser({scope:req.companyScope,actorId:req.user.id,body:req.body})));
router.get('/users/recovery-status',requirePermission('users.reset_password'),requireCompanyScope,managedUsers(()=>recoveryStatus()));
router.post('/users/recovery-verify',requirePermission('users.reset_password'),requireCompanyScope,managedUsers(()=>verifyRecoveryMail()));
router.put('/users/:id',requirePermission('users.update'),requireCompanyScope,managedUsers(req=>saveManagedUser({scope:req.companyScope,actorId:req.user.id,userId:req.params.id,body:req.body})));
router.put('/users/:id/password',requirePermission('users.reset_password'),requireCompanyScope,managedUsers(req=>changeManagedPassword({scope:req.companyScope,actorId:req.user.id,userId:req.params.id,body:req.body})));
router.patch('/users/:id/status',requirePermission('users.deactivate'),requireCompanyScope,managedUsers(req=>saveManagedUser({scope:req.companyScope,actorId:req.user.id,userId:req.params.id,body:req.body,statusOnly:true})));
router.get('/main-dashboard',requirePermission('dashboard.view'),requireCompanyScope,async(req,res,next)=>{
  try{res.set('Cache-Control','no-store');res.json({success:true,data:await getAdminDashboard({scope:req.companyScope,query:req.query})});}catch(error){next(error);}
});
router.get('/dashboard', requirePermission('admin_dashboard.view'), requireCompanyScope, async(req,res,next)=>{
  try { res.set('Cache-Control','no-store');return res.json({success:true,data:await getAdminDashboard({scope:req.companyScope,query:req.query})}); }
  catch(error) { if([400,403].includes(error.status))return res.status(error.status).json({success:false,message:error.message});return next(error); }
});
router.post("/portfolio/imports/resolution/analyze", requirePermission("portfolio.import"), requireCompanyScope,
  express.raw({ type: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], limit: MAX_IMPORT_BYTES }), async (req, res, next) => {
    try {
      if (!Buffer.isBuffer(req.body)) return res.status(400).json({ success: false, message: "Envía la cartera MERTEL como XLSX" });
      res.set("Cache-Control", "no-store");
      return res.json({ success: true, data: await analyzeCustomerResolution({ bytes: req.body, scope: req.companyScope,
        batchId: req.query.batch_id, actorId: req.user.id }) });
    } catch (error) { if ([400,403,404,409,413].includes(error.status)) return res.status(error.status).json({ success:false,message:error.message,code:error.code }); return next(error); }
  });
router.get("/portfolio/imports/resolution", requirePermission("portfolio.import"), requireCompanyScope, async (req,res,next) => {
  try { res.set("Cache-Control","no-store"); return res.json({ success:true,data:await getCustomerResolution({ scope:req.companyScope,batchId:req.query.batch_id,status:req.query.status,search:req.query.search }) }); }
  catch(error) { if([400,403].includes(error.status)) return res.status(error.status).json({success:false,message:error.message}); return next(error); }
});
router.get("/portfolio/imports/resolution/summary", requirePermission("portfolio.import"), requireCompanyScope, async (req,res,next) => {
  try { res.set("Cache-Control","no-store"); const data=await getCustomerResolutionDashboard(req.companyScope); return res.json({success:true,data}); }
  catch(error) { if([400,403].includes(error.status)) return res.status(error.status).json({success:false,message:error.message}); return next(error); }
});
router.post("/portfolio/imports/resolution/:id/decision", requirePermission("portfolio.import"), requireCompanyScope, async (req,res,next) => {
  try { res.set("Cache-Control","no-store"); return res.json({success:true,data:await decideCustomerResolution({scope:req.companyScope,actorId:req.user.id,rowId:req.params.id,body:req.body,ipAddress:req.ip,userAgent:req.get("user-agent")})}); }
  catch(error) { if([400,403,404,409].includes(error.status)) return res.status(error.status).json({success:false,message:error.message,code:error.code}); return next(error); }
});
router.get("/collection/dashboard", requirePermission("collection_dashboard.view"), requireCompanyScope, getCollectionDashboardController);
router.get("/collection/history", requirePermission("audit.view"), requireCompanyScope, administrativeCollectionHistory);
router.get("/collection/history/actors", requirePermission("audit.view"), requireCompanyScope, administrativeHistoryActors);
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
        referenceDate: req.query.reference_date, fileName: req.query.file_name, secret: req.app.get("authConfig")?.secret });
      return res.json({ success: true, data });
    } catch (error) {
      if ([400, 403, 404, 409, 413].includes(error.status)) return res.status(error.status).json({ success: false, message: error.message, code: error.code });
      return next(error);
    }
  });
router.get("/portfolio/imports/pipeline/actions", requirePermission("collection.view"), requireCompanyScope, async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store");
    return res.json({ success: true, data: await listImportedPipelineActions({ scope: req.companyScope, token: req.query.context_token, secret: req.app.get("authConfig")?.secret }) });
  } catch (error) {
    if ([400, 403].includes(error.status)) return res.status(error.status).json({ success: false, message: error.message });
    return next(error);
  }
});
router.post("/portfolio/imports/pipeline/actions", requirePermission("collection.manage"), requireCompanyScope, async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store");
    const data = await recordImportedPipelineAction({ scope: req.companyScope, token: req.body?.context_token, secret: req.app.get("authConfig")?.secret,
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
router.get('/roles',requirePermission('roles.view'),requireCompanyScope,managedUsers(req=>listRoleCatalog(req.companyScope)));
router.post('/roles',requirePermission('roles.manage'),requireCompanyScope,managedUsers(req=>saveCustomRole({scope:req.companyScope,actorId:req.user.id,body:req.body})));
router.put('/roles/:id',requirePermission('roles.manage'),requireCompanyScope,managedUsers(req=>saveCustomRole({scope:req.companyScope,actorId:req.user.id,roleId:req.params.id,body:req.body})));
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
