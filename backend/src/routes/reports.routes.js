import express from 'express';
import { requirePermission } from '../middleware/requirePermission.js';
import { requireCompanyScope } from '../middleware/companyScope.js';
import { getReportsController } from '../controllers/reports.controller.js';
const router=express.Router();
router.get('/',requirePermission('reports.view'),requireCompanyScope,getReportsController);
export default router;
