import express from 'express';
import { requirePermission } from '../middleware/requirePermission.js';
import { requireCompanyScope } from '../middleware/companyScope.js';
import * as results from '../services/collectionResults.service.js';

function respond(work) {
  return async (req,res,next) => {
    res.set('Cache-Control','no-store');
    try { return res.json({success:true,data:await work({scope:req.companyScope,customerId:req.params.customerId,reportId:req.params.reportId,
      body:req.body,filters:req.query,referenceDate:req.query.reference_date,contextToken:req.query.context_token})}); }
    catch(error) {
      if ([400,403,404,409,503].includes(error.status)) return res.status(error.status).json({success:false,message:error.message});
      if (['ER_BAD_FIELD_ERROR','ER_NO_SUCH_TABLE'].includes(error.code)) return res.status(503).json({success:false,message:'Aplica la migración 009 de resultados de gestión antes de operar.'});
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({success:false,message:'La operación ya fue registrada. Consulta el historial.'});
      return next(error);
    }
  };
}
const router = express.Router();
router.use(requireCompanyScope,requirePermission('collection.view'));
router.get('/customers/:customerId/context',respond(results.getManagementContext));
router.post('/pipeline/refresh',respond(results.refreshManagedPipeline));
router.post('/customers/:customerId/result',requirePermission('collection.manage'),respond(results.recordManagementResult));
router.get('/customers/:customerId/reports',requirePermission('history.view'),respond(results.listReportedPayments));
const financial = [requirePermission('collection.manage'),requirePermission('payments.create'),requirePermission('payment_allocations.create')];
router.post('/customers/:customerId/payment-preview',...financial,respond(results.previewCollectionPayment));
router.post('/customers/:customerId/payments',...financial,respond(results.registerCollectionPayment));
router.get('/reports',requirePermission('settings.manage'),respond(results.listReportedPayments));
router.post('/reports/:reportId/payment-preview',requirePermission('settings.manage'),...financial,respond(results.previewReportedPayment));
router.post('/reports/:reportId/review',requirePermission('settings.manage'),(req,res,next) => {
  if (req.body?.decision === 'CONFIRMED') return requirePermission('payments.create')(req,res,() => requirePermission('payment_allocations.create')(req,res,next));
  return next();
},respond(results.reviewReportedPayment));
export default router;
