import pool from '../config/database.js';
import { readCompanyCollection } from './collection.service.js';
import { getCustomerResolutionDashboard } from './customerResolution.service.js';
import { bogotaDate, defaultWhatsAppSettings } from './whatsappPolicy.js';
import { moneyCents } from './collectionMoney.js';
import { centsMoney } from './collectionResults.validation.js';
import { dateDay } from './promptPayment.service.js';
import { validCompanyId } from '../utils/companyScope.js';

export function shiftDay(day, offset) { return new Date((dateDay(day) + offset) * 86400000).toISOString().slice(0,10); }
export function dashboardPeriod(query = {}, now = new Date()) {
  const today = bogotaDate(now), period = query.period || 'today';
  let from = today, to = today;
  if (period === '7') from = shiftDay(today,-6);
  else if (period === 'month') from = `${today.slice(0,7)}-01`;
  else if (period === 'custom') {
    from = query.from; to = query.to;
    try { dateDay(from); dateDay(to); } catch { throw Object.assign(new Error('Selecciona fechas válidas YYYY-MM-DD.'),{status:400}); }
    if (from > to || dateDay(to)-dateDay(from)>365 || to>today) throw Object.assign(new Error('El período debe ser de hasta 366 días y no incluir fechas futuras.'),{status:400});
  } else if (period !== 'today') throw Object.assign(new Error('Período inválido.'),{status:400});
  return { period, from, to, reference_date:today, timezone:'America/Bogota', from_utc:`${from} 05:00:00`, to_utc:`${shiftDay(to,1)} 05:00:00` };
}

export function dashboardPortfolio(collection) {
  const stages = collection.stage_catalog.map(stage=>({key:stage.key,label:stage.label,category:stage.category,customers:0,documents:0,balance:'0.00'}));
  const map=new Map(stages.map(stage=>[stage.key,stage]));
  for(const item of collection.customers) for(const document of item.invoices) {
    if(!document.eligible) continue;
    const stage=map.get(document.stage); if(!stage) continue;
    stage.documents++; stage.balance=centsMoney(moneyCents(stage.balance)+moneyCents(document.invoice.balance));
  }
  for(const stage of stages) stage.customers=collection.customers.filter(item=>item.invoices.some(document=>document.eligible&&document.stage===stage.key)).length;
  const view=item=>({id:String(item.customer.id),name:item.customer.name,nit:item.customer.nit,balance:item.total_balance,stage:item.stage_label,
    priority:item.priority,invoice:item.main_invoice?.invoice?.invoice_number||null,due_date:item.main_invoice?.invoice?.due_date||null,
    overdue_days:item.main_invoice?.days_until_due<0?-item.main_invoice.days_until_due:null,collector:null});
  const all=[...collection.customers,...collection.non_overdue_pending.customers];
  return { summary:{total_balance:collection.summary.total_balance,customers_in_collection:collection.summary.total_customers,stages,warnings:collection.configuration_warnings},
    top_customers:[...all].sort((a,b)=>moneyCents(a.total_balance)>moneyCents(b.total_balance)?-1:moneyCents(a.total_balance)<moneyCents(b.total_balance)?1:0).slice(0,10).map(view),
    priority_customers:collection.customers.slice(0,10).map(view),customer_contexts:all.map(view) };
}

// Bounded reads in a consistent read-only transaction. Section failures never become zero values.
export async function getAdminDashboard({scope,query={},now=new Date()}, dbPool=pool) {
  if(!validCompanyId(scope?.companyId)) throw Object.assign(new Error('El contexto MERTEL no está disponible.'),{status:403});
  const period=dashboardPeriod(query,now), db=await dbPool.getConnection();
  let engineCustomers=new Map();
  const result={company:'MERTEL Importaciones',updated_at:now.toISOString(),period,definitions:{contacts:'Resultados CONTACTED',no_response:'Clientes distintos con resultado NO_RESPONSE',recovery:'Payments confirmed registrados (created_at); sin atribución comercial a gestión',promises:'Pendiente activa si promised_date >= referencia; vencida si < referencia; próxima: hoy a cinco días',partial_full:'Resultados PARTIAL_PAYMENT / PAID; no inferidos de importes',settled:'Eventos invoice_settled de auditoría en el período'}};
  async function section(key,work) { try { result[key]={status:'ok',data:await work()}; } catch { result[key]={status:'error',message:'No fue posible cargar esta sección.'}; } }
  try {
    await db.query('START TRANSACTION READ ONLY');
    await section('summary',async()=>{
      const value=dashboardPortfolio(await readCompanyCollection({scope,referenceDate:period.reference_date},db));
      engineCustomers=new Map(value.customer_contexts.map(row=>[row.id,row]));
      result.priority_customers={status:'ok',data:value.priority_customers};return value.summary;
    });
    if(result.summary.status==='error') for(const key of ['top_customers','priority_customers']) result[key]={status:'error',message:'No fue posible cargar la cartera.'};
    if(result.summary.status==='ok') await section('top_customers',async()=>{
      const [rows]=await db.query(`SELECT CAST(c.id AS CHAR) id,c.name,c.nit,SUM(i.balance) balance FROM customers c
        JOIN invoices i ON i.customer_id=c.id AND i.company_id=c.company_id
        WHERE c.company_id=? AND c.status='active' AND c.deleted_at IS NULL AND i.deleted_at IS NULL AND i.balance>0
        GROUP BY c.id,c.name,c.nit ORDER BY balance DESC,c.id LIMIT 10`,[scope.companyId]);
      return rows.map(row=>({...engineCustomers.get(row.id),...row,stage:engineCustomers.get(row.id)?.stage||'Sin etapa elegible',collector:null}));
    });
    const utc=[period.from_utc,period.to_utc,scope.companyId];
    await section('collection',async()=>{
      const [[row]]=await db.query(`SELECT COUNT(*) actions_count,COUNT(DISTINCT customer_id) managed_customers,
        COALESCE(SUM(action_type='CONTACTED'),0) contacts,COUNT(DISTINCT CASE WHEN action_type='NO_RESPONSE' THEN customer_id END) no_response,
        COALESCE(SUM(action_type='PARTIAL_PAYMENT'),0) partial_payments,COALESCE(SUM(action_type='PAID'),0) full_payments
        FROM collection_actions WHERE action_date>=? AND action_date<? AND company_id=?`,utc);return row;
    });
    await section('recovery',async()=>{
      const [[payments]]=await db.query(`SELECT COUNT(*) payments_count,COALESCE(SUM(amount),0) payments_amount FROM payments
        WHERE created_at>=? AND created_at<? AND company_id=? AND status='confirmed'`,utc);
      const [[allocations]]=await db.query(`SELECT COUNT(*) allocations_count,COALESCE(SUM(a.amount),0) allocations_amount FROM payment_allocations a
        JOIN payments p ON p.id=a.payment_id JOIN invoices i ON i.id=a.invoice_id AND i.company_id=p.company_id
        WHERE a.created_at>=? AND a.created_at<? AND p.company_id=? AND a.deleted_at IS NULL AND p.status='confirmed'`,utc);
      const [[settled]]=await db.query(`SELECT COUNT(DISTINCT entity_id) settled_invoices FROM audit_logs
        WHERE created_at>=? AND created_at<? AND company_id=? AND action='invoice_settled'`,utc);
      const [[confirmed]]=await db.query(`SELECT COUNT(*) confirmed_reports FROM collection_actions WHERE reviewed_at>=? AND reviewed_at<? AND company_id=? AND action_type='PAYMENT_REPORTED' AND status='CONFIRMED'`,utc);
      return {...payments,...allocations,...settled,...confirmed};
    });
    await section('reported_payments',async()=>{const [[row]]=await db.query(`SELECT COUNT(*) count,COALESCE(SUM(reported_amount),0) amount FROM collection_actions WHERE company_id=? AND action_type='PAYMENT_REPORTED' AND status='PENDING_REVIEW'`,[scope.companyId]);return row;});
    await section('resolution',()=>getCustomerResolutionDashboard(scope,db));
    await section('promises',async()=>{
      const [[row]]=await db.query(`SELECT COALESCE(SUM(status='pending' AND promised_date>=?),0) active,
        COALESCE(SUM(status='pending' AND promised_date<?),0) overdue,COALESCE(SUM(status='pending' AND promised_date BETWEEN ? AND ?),0) upcoming,
        COALESCE(SUM(status='fulfilled' AND fulfilled_at>=? AND fulfilled_at<?),0) fulfilled_period
        FROM payment_promises WHERE company_id=?`,[period.reference_date,period.reference_date,period.reference_date,shiftDay(period.reference_date,5),...utc]);return row;
    });
    await section('whatsapp',async()=>{
      const [[setting]]=await db.query("SELECT setting_value FROM settings WHERE company_id=? AND setting_key='whatsapp_center'",[scope.companyId]);
      const settings=setting?{...defaultWhatsAppSettings(),...JSON.parse(setting.setting_value)}:defaultWhatsAppSettings();
      const [[pending]]=await db.query("SELECT COALESCE(SUM(UPPER(status) IN ('PENDING','PROCESSING')),0) pending,COALESCE(SUM(UPPER(status)='FAILED'),0) failed_current FROM messages WHERE company_id=? AND channel='whatsapp'",[scope.companyId]);
      const [[activity]]=await db.query(`SELECT COALESCE(SUM(UPPER(status)='SENT'),0) sent,COALESCE(SUM(UPPER(status)='DELIVERED'),0) delivered,
        COALESCE(SUM(UPPER(status)='READ'),0) read_count,COALESCE(SUM(UPPER(status)='FAILED'),0) failed FROM messages
        WHERE created_at>=? AND created_at<? AND company_id=? AND channel='whatsapp'`,utc);
      return {provider:settings.provider,connection_status:settings.connection_status,...pending,...activity};
    });
    await section('recent_activity',async()=>{
      const [rows]=await db.query(`SELECT CAST(l.id AS CHAR) id,l.action,l.entity_type,CAST(l.entity_id AS CHAR) entity_id,
        DATE_FORMAT(l.created_at,'%Y-%m-%dT%H:%i:%sZ') occurred_at,CONCAT_WS(' ',u.first_name,u.last_name) user_name,
        JSON_UNQUOTE(JSON_EXTRACT(l.new_values,'$.actor_type')) actor_type,
        JSON_UNQUOTE(JSON_EXTRACT(l.new_values,'$.customer_id')) customer_id,
        JSON_UNQUOTE(JSON_EXTRACT(l.new_values,'$.amount')) amount,c.name customer_name,i.invoice_number
        FROM audit_logs l LEFT JOIN users u ON u.id=l.user_id AND (u.company_id=l.company_id OR u.company_id IS NULL)
        LEFT JOIN customers c ON c.id=JSON_UNQUOTE(JSON_EXTRACT(l.new_values,'$.customer_id')) AND c.company_id=l.company_id
        LEFT JOIN invoices i ON i.id=COALESCE(JSON_UNQUOTE(JSON_EXTRACT(l.new_values,'$.invoice_id')),IF(l.entity_type='invoice',l.entity_id,NULL)) AND i.company_id=l.company_id
        WHERE l.created_at>=? AND l.created_at<? AND l.company_id=?
          AND l.entity_type IN ('collection_action','payment_promise','payment','payment_allocation','invoice','collection_pipeline','customer_resolution','customer','whatsapp_message','whatsapp_setting','setting','import_batch')
        ORDER BY l.created_at DESC,l.id DESC LIMIT 20`,utc);
      return rows.map(row=>({...row,actor:row.actor_type==='SYSTEM'||!row.user_name?'Sistema':row.user_name}));
    });
    await db.commit();return result;
  } catch(error) { try{await db.rollback();}catch{/* original error */}throw error; }
  finally{db.release();}
}
