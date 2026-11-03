import { getReports } from '../services/reports.service.js';
export async function getReportsController(req,res,next){
  try { res.set('Cache-Control','no-store'); return res.json({success:true,data:await getReports({scope:req.companyScope,query:req.query})}); }
  catch(error){ if(error.status===400||error.status===403)return res.status(error.status).json({success:false,message:error.message}); return next(error); }
}
