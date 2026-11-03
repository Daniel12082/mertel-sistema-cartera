import express from 'express';
import {getAppearance, saveAppearance} from '../services/appearance.service.js';
import {requirePermission} from '../middleware/requirePermission.js';
const router = express.Router();
function respond(work) {
  return async(req,res) => {
    res.set('Cache-Control','no-store');
    try { return res.json({success:true,data:await work(req)}); }
    catch(error) { const status = [400,403,409].includes(error.status) ? error.status : 500; return res.status(status).json({success:false,message:status === 500 ? 'No se pudo consultar o guardar la apariencia.' : error.message}); }
  };
}
// Branding is safe for every authenticated MERTEL account; edits remain administrative.
router.get('/', respond(req => getAppearance(req.companyScope)));
router.put('/', requirePermission('settings.manage'), respond(req => saveAppearance({scope:req.companyScope,actorId:req.user.id,body:req.body})));
export default router;
