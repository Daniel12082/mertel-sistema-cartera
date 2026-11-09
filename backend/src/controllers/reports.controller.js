import { getReports } from '../services/reports.service.js';
export async function getReportsController(req,res,next){
  try {
    const permissions = req.user.permissions ?? [];
    const includeAdministrativeHistory = permissions.includes('history.view') && permissions.includes('settings.manage');
    res.set('Cache-Control','no-store');
    return res.json({success:true,data:await getReports({scope:req.companyScope,query:req.query,includeAdministrativeHistory})});
  }
  catch(error){ if(error.status===400||error.status===403)return res.status(error.status).json({success:false,message:error.message}); return next(error); }
}
