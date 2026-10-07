import pool from '../config/database.js';
import { operationError, operationId } from './collectionOperations.validation.js';
import { validCompanyId } from '../utils/companyScope.js';
import { readCompanyCollection } from './collection.service.js';
import { collectionOperation } from './collectionOperations.service.js';
import { addPaymentWithAllocations } from './payment.service.js';
import { normalizeMertelNit } from './mertelPortfolioXlsxParser.js';
import { verifySourceContext } from './portfolioPipeline.service.js';
import { bogotaDate } from './whatsappPolicy.js';
import { moneyCents } from './collectionMoney.js';
import { RESULT_CATALOG, fields, resultText, resultDate, positiveMoney, centsMoney, operationKey, payloadHash,
  parseCollectionPayment, signPaymentPreview, verifyPaymentPreview } from './collectionResults.validation.js';

async function transact(scope, work, { readOnly = false, dbPool = pool } = {}) {
  if (!validCompanyId(scope?.companyId) || !validCompanyId(scope?.actorId)) throw operationError(403, 'La gestión requiere contexto MERTEL autorizado.');
  const db = await dbPool.getConnection();
  try {
    if (readOnly) await db.query('START TRANSACTION READ ONLY'); else await db.beginTransaction();
    const [[company]] = await db.query(`SELECT id FROM companies WHERE id=? AND status='active' AND deleted_at IS NULL${readOnly ? '' : ' FOR UPDATE'}`, [scope.companyId]);
    if (!company) throw operationError(403, 'MERTEL no está disponible.');
    const result = await work(db); await db.commit(); return result;
  } catch (error) { try { await db.rollback(); } catch { /* original */ } throw error; }
  finally { db.release(); }
}
async function customerFor(db, scope, customerId, lock = false) {
  const [[customer]] = await db.query(`SELECT CAST(id AS CHAR) AS id,name,nit,phone,status FROM customers WHERE id=? AND company_id=? AND deleted_at IS NULL${lock ? ' FOR UPDATE' : ''}`, [customerId, scope.companyId]);
  if (!customer) throw operationError(404, 'Cliente no encontrado.');
  if (customer.status !== 'active') throw operationError(409, 'El cliente no está activo.'); return customer;
}
async function invoicesFor(db, scope, customerId) {
  const [rows] = await db.query(`SELECT CAST(id AS CHAR) AS id,invoice_number,DATE_FORMAT(issue_date,'%Y-%m-%d') AS issue_date,
    DATE_FORMAT(due_date,'%Y-%m-%d') AS due_date,CAST(balance AS CHAR) AS balance,status FROM invoices
    WHERE company_id=? AND customer_id=? AND deleted_at IS NULL ORDER BY due_date,id`, [scope.companyId, customerId]);
  return rows;
}
const reportsColumns = `CAST(a.id AS CHAR) AS id,CAST(a.customer_id AS CHAR) AS customer_id,CAST(a.invoice_id AS CHAR) AS invoice_id,
  c.name AS customer_name,c.nit,i.invoice_number,CAST(i.balance AS CHAR) AS current_balance,
  CAST(a.reported_amount AS CHAR) AS reported_amount,DATE_FORMAT(a.reported_payment_date,'%Y-%m-%d') AS reported_payment_date,
  CONCAT_WS(' ',u.first_name,u.last_name) AS reported_by,a.action_date AS reported_at,a.status,a.description,a.review_reason,
  a.reviewed_at,CAST(a.confirmed_payment_id AS CHAR) AS confirmed_payment_id`;
async function reportsFor(db, scope, { customerId, status, reportId, lock = false, page = 1 } = {}) {
  const where = ["a.company_id=?", "a.action_type='PAYMENT_REPORTED'"]; const values = [scope.companyId];
  for (const [column, value] of [['a.customer_id', customerId], ['a.status', status], ['a.id', reportId]]) if (value) { where.push(`${column}=?`); values.push(value); }
  const [rows] = await db.query(`SELECT ${reportsColumns} FROM collection_actions a JOIN customers c ON c.id=a.customer_id AND c.company_id=a.company_id
    LEFT JOIN invoices i ON i.id=a.invoice_id AND i.customer_id=a.customer_id AND i.company_id=a.company_id
    LEFT JOIN users u ON u.id=a.user_id WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT 51 OFFSET ?${lock ? ' FOR UPDATE' : ''}`, [...values, (page - 1) * 50]);
  return rows;
}
async function audit(db, scope, entityId, action, value, entityType = 'collection_result', {system=false,correlationId=null}={}) {
  const actor={actor_type:system?'SYSTEM':'USER',...(system?{triggered_by:String(scope.actorId)}:{}),...(correlationId?{correlation_id:correlationId}:{})};
  await db.query('INSERT INTO audit_logs (company_id,user_id,entity_type,entity_id,action,new_values) VALUES (?,?,?,?,?,?)', [scope.companyId, system?null:scope.actorId, entityType, entityId, action, JSON.stringify({...value,...actor})]);
}
async function snapshot(db, scope, customerId, referenceDate) {
  const collection = await readCompanyCollection({ scope, referenceDate, filters: { customerId } }, db);
  const invoices = (await invoicesFor(db, scope, customerId)).filter(row => moneyCents(row.balance) > 0n);
  return { collection_item: [...collection.customers, ...collection.non_overdue_pending.customers].find(item => String(item.customer.id) === String(customerId)) || null,
    collection_eligible: collection.customers.some(item => String(item.customer.id) === String(customerId)),
    total_balance: centsMoney(invoices.reduce((sum, item) => sum + moneyCents(item.balance), 0n)),
    open_invoices: invoices, reports: await reportsFor(db, scope, { customerId }), stage_catalog: collection.stage_catalog, reference_date: referenceDate };
}
export async function getManagementContext({ scope, customerId, referenceDate = bogotaDate(), contextToken }, dbPool = pool) {
  customerId = operationId(customerId, 'customer_id'); resultDate(referenceDate);
  return transact(scope, async db => {
    const customer = await customerFor(db, scope, customerId);
    let source = null;
    if (contextToken) {
      source = verifySourceContext(contextToken, process.env.JWT_SECRET, scope.companyId);
      if (normalizeMertelNit(customer.nit).normalized !== source.nit) throw operationError(403, 'El cliente no pertenece al contexto del archivo.');
    }
    const invoices = await invoicesFor(db, scope, customerId);
    const missing = source ? source.documents.filter(number => invoices.filter(invoice => invoice.invoice_number === number).length !== 1) : [];
    return { customer, result_catalog: RESULT_CATALOG, ...await snapshot(db, scope, customerId, referenceDate),
      source_documents_pending: missing, financial_source_ready: !missing.length,
      notice: missing.length ? 'Hay documentos del archivo sin una factura financiera única. No se registrarán pagos sobre documentos temporales.' : null };
  }, { readOnly: true, dbPool });
}
export async function refreshManagedPipeline({ scope, body }, dbPool = pool) {
  fields(body, ['reference_date', 'customers']);
  const referenceDate = resultDate(body.reference_date || bogotaDate());
  if (!Array.isArray(body.customers) || body.customers.length > 2000) throw operationError(400, 'Lista de clientes inválida.');
  const requested = body.customers.map(item => {
    fields(item, ['customer_id', 'context_token']);
    return { customerId: operationId(item.customer_id,'customer_id'), source: item.context_token ? verifySourceContext(item.context_token,process.env.JWT_SECRET,scope.companyId) : null };
  });
  if (new Set(requested.map(item => item.customerId)).size !== requested.length) throw operationError(400,'No repitas clientes.');
  return transact(scope,async db => {
    const collection = await readCompanyCollection({scope,referenceDate},db);
    const engineById = new Map([...collection.customers,...collection.non_overdue_pending.customers].map(item => [String(item.customer.id),item]));
    const [customers] = await db.query("SELECT CAST(id AS CHAR) AS id,nit FROM customers WHERE company_id=? AND status='active' AND deleted_at IS NULL",[scope.companyId]);
    const byId = new Map(customers.map(customer => [customer.id,customer]));
    const [invoices] = await db.query("SELECT CAST(id AS CHAR) AS id,CAST(customer_id AS CHAR) AS customer_id,invoice_number,CAST(balance AS CHAR) AS balance FROM invoices WHERE company_id=? AND deleted_at IS NULL",[scope.companyId]);
    const [reports] = await db.query("SELECT CAST(customer_id AS CHAR) AS customer_id,COUNT(*) AS count FROM collection_actions WHERE company_id=? AND action_type='PAYMENT_REPORTED' AND status='PENDING_REVIEW' GROUP BY customer_id",[scope.companyId]);
    const reportById = new Map(reports.map(report => [report.customer_id,Number(report.count)]));
    const invoicesById = new Map();
    for (const invoice of invoices) { if (!invoicesById.has(invoice.customer_id)) invoicesById.set(invoice.customer_id,[]); invoicesById.get(invoice.customer_id).push(invoice); }
    return { reference_date:referenceDate,customers:requested.map(({customerId,source}) => {
      const customer = byId.get(customerId); if (!customer) throw operationError(404,'Cliente no encontrado.');
      if (source && normalizeMertelNit(customer.nit).normalized !== source.nit) throw operationError(403,'El cliente no pertenece al contexto firmado.');
      const rows = invoicesById.get(customerId) || [];
      const missing = source ? source.documents.filter(number => rows.filter(invoice => invoice.invoice_number === number).length !== 1) : [];
      return { customer_id:customerId,financial_source_ready:!missing.length,source_documents_pending:missing,
        collection_item:engineById.get(customerId) || null,pending_report_count:reportById.get(customerId) || 0,
        total_balance:centsMoney(rows.reduce((sum,invoice) => sum + moneyCents(invoice.balance),0n)) };
    }) };
  },{readOnly:true,dbPool});
}
async function previewLines(db, scope, customerId, payment) {
  await customerFor(db, scope, customerId);
  const invoices = await invoicesFor(db, scope, customerId); const lines = [];
  for (const allocation of payment.allocations) {
    const invoice = invoices.find(row => row.id === allocation.invoice_id);
    if (!invoice) throw operationError(404, 'Factura no encontrada para este cliente.');
    const balance = moneyCents(invoice.balance); const amount = moneyCents(allocation.amount);
    if (balance <= 0n || ['cancelled','inactive','void','paid'].includes(invoice.status)) throw operationError(409, 'La factura no está activa o ya está pagada.');
    if (amount > balance) throw operationError(409, 'El monto supera el saldo de la factura.');
    if (payment.payment_kind === 'TOTAL' && amount !== balance) throw operationError(409, 'El pago total debe cubrir el saldo actual de la factura.');
    if (payment.payment_kind === 'PARTIAL' && amount >= balance) throw operationError(409, 'El pago parcial debe ser menor que el saldo actual.');
    lines.push({ ...invoice, allocation_amount: allocation.amount, resulting_balance: centsMoney(balance - amount) });
  }
  return lines;
}
export async function previewCollectionPayment({ scope, customerId, body }, dbPool = pool) {
  customerId = operationId(customerId, 'customer_id'); const payment = parseCollectionPayment(body);
  const key = operationKey(body.idempotency_key, scope, customerId); const hash = payloadHash(payment);
  return transact(scope, async db => {
    const lines = await previewLines(db, scope, customerId, payment);
    const customer = await customerFor(db, scope, customerId);
    return { customer, payment, invoices: lines, unallocated_amount: centsMoney(moneyCents(payment.amount) - payment.allocations.reduce((sum,item) => sum + moneyCents(item.amount),0n)),
      confirmation_token: signPaymentPreview({ company_id: String(scope.companyId), customer_id: customerId, actor_id: String(scope.actorId), hash, key,
        balances: Object.fromEntries(lines.map(line => [line.id,line.balance])), expires_at: Date.now() + 15 * 60000 }),
      notice: 'Esta acción modificará el registro financiero y el saldo de la factura.' };
  }, { readOnly: true, dbPool });
}
async function resultAction(db, scope, customerId, { invoiceId = null, type, description, key = null, hash = null, paymentId = null, amount = null }) {
  const created = await collectionOperation({ kind: 'action', customerId, scope, transactionDb: db,
    body: { invoice_id: invoiceId, action_type: type, description: description || type } });
  await db.query('UPDATE collection_actions SET operation_key=?,operation_payload_hash=?,confirmed_payment_id=?,reported_amount=? WHERE id=?', [key, hash, paymentId, amount, created.id]);
  return created.id;
}
async function settlePromises(db, scope, customerId, correlationId) {
  // Existing pending/fulfilled states; only fully settled invoice/customer debt is evidence.
  const [rows] = await db.query(`SELECT CAST(p.id AS CHAR) AS id FROM payment_promises p WHERE p.company_id=? AND p.customer_id=? AND p.status='pending'
    AND ((p.invoice_id IS NOT NULL AND EXISTS(SELECT 1 FROM invoices i WHERE i.id=p.invoice_id AND i.customer_id=p.customer_id AND i.company_id=p.company_id AND i.balance=0 AND i.deleted_at IS NULL))
      OR (p.invoice_id IS NULL AND NOT EXISTS(SELECT 1 FROM invoices i WHERE i.company_id=p.company_id AND i.customer_id=p.customer_id AND i.deleted_at IS NULL AND i.balance>0))) FOR UPDATE`, [scope.companyId, customerId]);
  for (const row of rows) { await db.query("UPDATE payment_promises SET status='fulfilled',fulfilled_at=UTC_TIMESTAMP() WHERE id=?", [row.id]); await audit(db, scope, row.id, 'fulfilled', { customer_id: customerId, status: 'fulfilled' }, 'payment_promise',{system:true,correlationId}); }
}
async function stopSettledAutomations(db,scope,customerId,context,correlationId) {
  if (moneyCents(context.total_balance)!==0n) return;
  const [messages]=await db.query("SELECT CAST(id AS CHAR) AS id FROM messages WHERE company_id=? AND customer_id=? AND direction='outbound' AND message_mode='AUTOMATICO' AND UPPER(status) IN ('PENDING','FAILED') FOR UPDATE",[scope.companyId,customerId]);
  for(const message of messages){
    await db.query("UPDATE messages SET status='CANCELLED',next_attempt_at=NULL WHERE id=?",[message.id]);
    await audit(db,scope,message.id,'cancelled',{customer_id:customerId,status:'CANCELLED',reason:'Saldo financiero pendiente igual a cero'},'whatsapp_message',{system:true,correlationId});
  }
}
async function auditFinancialSequence(db,scope,customerId,{result,claims,before,after,correlationId,reportId=null}){
  const paymentId=String(result.payment.id);
  const common={customer_id:customerId,payment_id:paymentId,...(reportId?{report_id:reportId}:{})};
  for(const allocation of result.allocations){
    const invoiceId=String(allocation.invoice_id),allocationId=String(allocation.id);
    const [[invoice]]=await db.query('SELECT CAST(balance AS CHAR) AS balance FROM invoices WHERE id=? AND company_id=? AND customer_id=?',[invoiceId,scope.companyId,customerId]);
    const amounts={...common,invoice_id:invoiceId,allocation_id:allocationId,amount:allocation.amount,old_balance:claims.balances[invoiceId],new_balance:invoice.balance};
    await audit(db,scope,allocation.id,'allocation_created',{...amounts,description:`Pago ${paymentId} asignado a factura: ${allocation.amount} COP.`},'payment_allocation',{correlationId});
    await audit(db,scope,invoiceId,'balance_updated',{...amounts,description:`Saldo anterior: ${amounts.old_balance} COP. Saldo nuevo: ${amounts.new_balance} COP.`},'invoice',{system:true,correlationId});
    if(moneyCents(invoice.balance)===0n)await audit(db,scope,invoiceId,'invoice_settled',{...amounts,description:'Factura saldada con un pago y una asignación confirmados.'},'invoice',{system:true,correlationId});
  }
  const context={...common,total_balance_before:before.total_balance,total_balance_after:after.total_balance,
    stage_before:before.collection_item?.stage||null,stage_after:after.collection_item?.stage||null,
    collection_eligible_before:before.collection_eligible,collection_eligible_after:after.collection_eligible};
  await audit(db,scope,customerId,'pipeline_recalculated',{...context,description:`Cobranza reevaluada por el motor. Saldo pendiente: ${after.total_balance} COP. ${after.collection_item?.stage_label||'Sin etapa elegible'}.`},'collection_pipeline',{system:true,correlationId});
  if(moneyCents(after.total_balance)===0n){
    await audit(db,scope,customerId,'pipeline_exited',{...context,description:'Cliente sin saldo pendiente; no permanece en el pipeline de cobranza.'},'collection_pipeline',{system:true,correlationId});
    await audit(db,scope,customerId,'automatic_collection_blocked',{...context,reason:'NO_PENDING_BALANCE',description:'El estado financiero impide generar nueva cobranza automática para este cliente.'},'collection_pipeline',{system:true,correlationId});
  }
}
export async function registerCollectionPayment({ scope, customerId, body }, dbPool = pool) {
  customerId = operationId(customerId, 'customer_id'); const payment = parseCollectionPayment(body);
  const key = operationKey(body.idempotency_key, scope, customerId); const hash = payloadHash(payment);
  const claims = verifyPaymentPreview(body.confirmation_token, { scope, customerId, hash, key });
  const referenceDate = resultDate(body.reference_date || bogotaDate());
  return transact(scope, async db => {
    await customerFor(db,scope,customerId,true);
    const beforeContext=await snapshot(db,scope,customerId,referenceDate);
    const result = await addPaymentWithAllocations({ payment: { ...payment, customer_id: customerId }, allocations: payment.allocations,
      operationKey: key, payloadHash: hash, expectedBalances: claims.balances, scope, transactionDb: db });
    if (!result.duplicate) {
      const correlationId=`payment:${result.payment.id}`;
      await audit(db,scope,result.payment.id,'confirmation_accepted',{customer_id:customerId,payment_id:String(result.payment.id),amount:payment.amount},'payment',{correlationId});
      const id = await resultAction(db, scope, customerId, { invoiceId: payment.allocations[0].invoice_id, type: payment.payment_kind === 'PARTIAL' ? 'PARTIAL_PAYMENT' : 'PAYMENT_REGISTERED',
        description: `Pago registrado: ${payment.amount} COP. ${payment.notes || ''}`, paymentId: result.payment.id, amount: payment.amount });
      await audit(db, scope, id, 'payment_registered', { customer_id: customerId, payment_id: String(result.payment.id), amount: payment.amount, allocations: payment.allocations },'collection_result',{correlationId});
      await settlePromises(db, scope, customerId,correlationId);
    }
    const context=await snapshot(db,scope,customerId,referenceDate);
    const correlationId=`payment:${result.payment.id}`;
    if(!result.duplicate)await auditFinancialSequence(db,scope,customerId,{result,claims,before:beforeContext,after:context,correlationId});
    await stopSettledAutomations(db,scope,customerId,context,correlationId);
    return { ...result, ...context };
  }, { dbPool });
}
export async function recordManagementResult({ scope, customerId, body }, dbPool = pool) {
  customerId = operationId(customerId, 'customer_id');
  fields(body, ['result', 'invoice_id', 'description', 'reported_amount', 'reported_payment_date', 'promised_date', 'promised_amount', 'idempotency_key', 'reference_date']);
  if (!RESULT_CATALOG.some(result => result.key === body.result) || ['PAID','PARTIAL_PAYMENT'].includes(body.result)) throw operationError(400, 'Utiliza el formulario financiero para registrar un pago.');
  const invoiceId = body.invoice_id ? operationId(body.invoice_id, 'invoice_id') : null;
  const data = { result: body.result, invoice_id: invoiceId, description: resultText(body.description, 'Observación', 4000, true),
    ...(body.result === 'PAYMENT_REPORTED' ? { reported_amount: positiveMoney(body.reported_amount), reported_payment_date: resultDate(body.reported_payment_date) } : {}),
    ...(body.result === 'PROMISE' ? { promised_date: resultDate(body.promised_date), promised_amount: positiveMoney(body.promised_amount) } : {}) };
  if (body.result === 'PAYMENT_REPORTED' && !invoiceId) throw operationError(400, 'Selecciona la factura del reporte.');
  const key = operationKey(body.idempotency_key, scope, customerId, 'result'); const hash = payloadHash(data);
  return transact(scope, async db => {
    await customerFor(db, scope, customerId, true);
    const [[prior]] = await db.query('SELECT CAST(id AS CHAR) AS id,operation_payload_hash FROM collection_actions WHERE company_id=? AND operation_key=? FOR UPDATE', [scope.companyId, key]);
    if (prior) { if (prior.operation_payload_hash !== hash) throw operationError(409, 'La clave ya se usó con otros datos.'); return { id: prior.id, duplicate: true }; }
    if (data.result === 'PROMISE') await collectionOperation({ scope, customerId, kind: 'promise', transactionDb: db,
      body: { invoice_id: invoiceId, promised_date: data.promised_date, promised_amount: data.promised_amount, notes: data.description } });
    const id = await resultAction(db, scope, customerId, { invoiceId, type: data.result, description: data.description, key, hash });
    if (data.result === 'PAYMENT_REPORTED') {
      const invoice = (await invoicesFor(db, scope, customerId)).find(row => row.id === invoiceId);
      if (!invoice || moneyCents(invoice.balance) <= 0n) throw operationError(409, 'La factura no tiene saldo pendiente para reportar.');
      await db.query("UPDATE collection_actions SET status='PENDING_REVIEW',reported_amount=?,reported_payment_date=?,description=? WHERE id=?", [data.reported_amount, data.reported_payment_date, `Pago reportado: ${data.reported_amount} COP · ${data.reported_payment_date}. Pendiente de conciliación. ${data.description}`, id]);
    }
    await audit(db, scope, id, 'result_registered', { customer_id: customerId, ...data,...(data.result==='PAYMENT_REPORTED'?{report_id:id}:{}) },'collection_result',{correlationId:data.result==='PAYMENT_REPORTED'?`report:${id}`:null});
    return { id, duplicate: false, ...await snapshot(db, scope, customerId, resultDate(body.reference_date || bogotaDate())) };
  }, { dbPool });
}
export async function listReportedPayments({ scope, filters = {}, customerId }, dbPool = pool) {
  const statuses = ['PENDING_REVIEW','CONFIRMED','REJECTED'];
  if (filters.status && !statuses.includes(filters.status)) throw operationError(400, 'Estado de reporte inválido.');
  const page = Number(filters.page || 1); if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw operationError(400, 'Página inválida.');
  if (customerId) operationId(customerId, 'customer_id');
  return transact(scope, async db => { const rows = await reportsFor(db, scope, { customerId, status: filters.status, page }); return { reports: rows.slice(0,50), page, has_next: rows.length > 50 }; }, { readOnly: true, dbPool });
}
export async function previewReportedPayment({ scope, reportId, body }, dbPool = pool) {
  reportId = operationId(reportId, 'report_id');
  const report = await transact(scope, async db => (await reportsFor(db, scope, { reportId }))[0], { readOnly: true, dbPool });
  if (!report) throw operationError(404, 'Reporte no encontrado.');
  if (report.status !== 'PENDING_REVIEW') throw operationError(409, 'El reporte ya fue revisado.');
  return previewCollectionPayment({ scope, customerId: report.customer_id, body }, dbPool);
}
export async function reviewReportedPayment({ scope, reportId, body }, dbPool = pool) {
  reportId = operationId(reportId, 'report_id'); fields(body, ['decision', 'reason', 'payment']);
  if (!['CONFIRMED','REJECTED'].includes(body.decision)) throw operationError(400, 'Decisión inválida.');
  const reason = resultText(body.reason, 'Motivo', 4000, body.decision === 'REJECTED');
  return transact(scope, async db => {
    const report = (await reportsFor(db, scope, { reportId, lock: true }))[0];
    if (!report) throw operationError(404, 'Reporte no encontrado.');
    if (report.status !== 'PENDING_REVIEW') {
      if (report.status === body.decision && (body.decision === 'CONFIRMED' || report.review_reason === reason)) return { report, duplicate: true, ...await snapshot(db,scope,report.customer_id,bogotaDate()) };
      throw operationError(409, 'El reporte ya fue revisado.');
    }
    let paymentResult = null;
    let beforeContext=null,confirmationClaims=null;
    const correlationId=`report:${reportId}`;
    if (body.decision === 'CONFIRMED') {
      const payment = parseCollectionPayment(body.payment);
      if (payment.allocations.length !== 1 || payment.allocations[0].invoice_id !== report.invoice_id || payment.amount !== report.reported_amount || payment.payment_date !== report.reported_payment_date || payment.allocations[0].amount !== payment.amount) throw operationError(409, 'El pago debe corresponder a la factura, monto y fecha del reporte. Rechaza el reporte si requiere corrección.');
      const key = operationKey(body.payment.idempotency_key, scope, report.customer_id); const hash = payloadHash(payment);
      const claims = verifyPaymentPreview(body.payment.confirmation_token, { scope, customerId: report.customer_id, hash, key });
      confirmationClaims=claims;
      await customerFor(db,scope,report.customer_id,true);
      beforeContext=await snapshot(db,scope,report.customer_id,bogotaDate());
      await audit(db,scope,reportId,'confirmation_accepted',{report_id:reportId,customer_id:report.customer_id,amount:payment.amount,payment_date:payment.payment_date},'collection_result',{correlationId});
      // A report has a stable operation key, independently of retries/client UUIDs.
      paymentResult = await addPaymentWithAllocations({ payment: { ...payment, customer_id: report.customer_id }, allocations: payment.allocations,
        operationKey: payloadHash([String(scope.companyId), 'report', reportId]), payloadHash: hash, expectedBalances: claims.balances, scope, transactionDb: db });
      const actionId = await resultAction(db,scope,report.customer_id,{ invoiceId: report.invoice_id,type:'PAYMENT_REGISTERED',description:`Pago registrado desde reporte ${reportId}: ${payment.amount} COP.`,paymentId: paymentResult.payment.id,amount: payment.amount });
      await audit(db,scope,actionId,'payment_registered',{ customer_id:report.customer_id,report_id:reportId,payment_id:String(paymentResult.payment.id),amount:payment.amount },'collection_result',{correlationId});
      await settlePromises(db,scope,report.customer_id,correlationId);
    }
    await db.query('UPDATE collection_actions SET status=?,reviewed_by=?,reviewed_at=UTC_TIMESTAMP(),review_reason=?,confirmed_payment_id=? WHERE id=?', [body.decision,scope.actorId,reason,paymentResult?.payment.id ?? null,reportId]);
    const actionId = await resultAction(db,scope,report.customer_id,{ invoiceId:report.invoice_id,type:body.decision === 'CONFIRMED' ? 'PAYMENT_CONFIRMED' : 'PAYMENT_REJECTED',description: `${body.decision === 'CONFIRMED' ? 'Pago reportado confirmado' : 'Pago reportado rechazado'}: ${report.reported_amount} COP. ${reason || ''}`,paymentId:paymentResult?.payment.id ?? null,amount:report.reported_amount });
    await audit(db,scope,actionId,'report_reviewed',{ report_id:reportId,customer_id:report.customer_id,status:body.decision,reason,payment_id:paymentResult ? String(paymentResult.payment.id) : null },'collection_result',{correlationId});
    const context=await snapshot(db,scope,report.customer_id,bogotaDate());
    if(paymentResult){
      await auditFinancialSequence(db,scope,report.customer_id,{result:paymentResult,claims:confirmationClaims,before:beforeContext,after:context,correlationId,reportId});
      await stopSettledAutomations(db,scope,report.customer_id,context,correlationId);
    }
    return { report: (await reportsFor(db,scope,{reportId}))[0], payment:paymentResult?.payment ?? null,duplicate:false,...context };
  }, { dbPool });
}
