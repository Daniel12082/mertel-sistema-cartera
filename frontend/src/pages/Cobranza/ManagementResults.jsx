import {useEffect,useRef,useState} from 'react';
import {useAuth} from '../../auth/useAuth';
import {collectionResultsRequest} from '../../services/collectionResults.service';
import CollectionPaymentForm from './CollectionPaymentForm';
import {formatCurrency,formatDate} from '../../utils/format';
import './ManagementResults.css';

export default function ManagementResults({customerId,referenceDate,contextToken,startOpen=false,onChanged}){
  const {permissions=[],user}=useAuth();const canManage=permissions.includes('collection.manage');
  const canPay=canManage&&permissions.includes('payments.create')&&permissions.includes('payment_allocations.create');
  const [opened,setOpened]=useState(startOpen);const [context,setContext]=useState(null);const [error,setError]=useState('');
  const [result,setResult]=useState('');const [notice,setNotice]=useState('');const [reload,setReload]=useState(0);const [saving,setSaving]=useState(false);
  const [form,setForm]=useState({invoice_id:'',description:'',reported_amount:'',reported_payment_date:'',promised_date:'',promised_amount:''});
  const key=useRef(crypto.randomUUID());const pending=useRef(false);
  const persistent=/^[1-9]\d*$/.test(String(customerId));
  useEffect(()=>{
    if(!opened||!persistent||!canManage)return;
    const controller=new AbortController();
    collectionResultsRequest(`/customers/${customerId}/context`,{params:{reference_date:referenceDate,...(contextToken?{context_token:contextToken}:{})},signal:controller.signal})
      .then(data=>{if(!controller.signal.aborted){setContext(data);setError('');}}).catch(failure=>{if(!controller.signal.aborted)setError(failure.message);});
    return()=>controller.abort();
  },[opened,persistent,canManage,customerId,referenceDate,contextToken,reload]);
  async function complete(data){
    setNotice(data.payment?'Pago registrado correctamente. El motor recalculará la cobranza con los saldos reales.':'Gestión guardada. Un pago reportado sigue pendiente de conciliación.');
    setResult('');setForm({invoice_id:'',description:'',reported_amount:'',reported_payment_date:'',promised_date:'',promised_amount:''});key.current=crypto.randomUUID();setReload(value=>value+1);
    if(onChanged)await onChanged(data);
  }
  async function save(event){
    event.preventDefault();if(pending.current)return;pending.current=true;setSaving(true);setError('');
    const body={result,invoice_id:form.invoice_id||null,description:form.description,idempotency_key:key.current,reference_date:referenceDate,
      ...(result==='PAYMENT_REPORTED'?{reported_amount:form.reported_amount,reported_payment_date:form.reported_payment_date}:{}),
      ...(result==='PROMISE'?{promised_date:form.promised_date,promised_amount:form.promised_amount}:{})};
    try{await complete(await collectionResultsRequest(`/customers/${customerId}/result`,{method:'post',body}));}catch(failure){setError(failure.message);}finally{pending.current=false;setSaving(false);}
  }
  function choose(value){setResult(value);setError('');setNotice('');key.current=crypto.randomUUID();}
  return <section className="management-results" aria-label="Resultados de gestión del cliente">
    {canManage&&<button className="cartera-reset" disabled={saving} onClick={()=>setOpened(value=>!value)}>{opened?'Cerrar gestión':'Gestionar cliente'}</button>}
    {opened&&<><h3>Gestionar cliente</h3>{!persistent?<p role="alert">Resuelve este cliente y sus facturas financieras antes de registrar pagos. Los documentos temporales no se pueden pagar.</p>:<>
      {error&&<p role="alert" className="cartera-alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
      {!context&&!error&&<p role="status">Consultando saldos y resultados de gestión…</p>}
      {context&&<><p><strong>{context.customer.name}</strong> · Etapa: {context.collection_item?.stage_label||'Sin etapa elegible'} · Saldo total: {formatCurrency(context.total_balance)}</p>
        {context.notice&&<p role="status" className="cartera-alert">{context.notice}</p>}
        {context.reports?.filter(report=>report.status==='PENDING_REVIEW').map(report=><article className="management-report" key={report.id}><strong>⚠️ Pago reportado · Pendiente de conciliación</strong><p>{report.invoice_number} · Monto informado {formatCurrency(report.reported_amount)} · Fecha {formatDate(report.reported_payment_date)} · Reportado por {report.reported_by}</p><p>Saldo financiero actual: {formatCurrency(report.current_balance)}. Este reporte no marca la factura como pagada.</p></article>)}
        <h4>Resultado de la gestión</h4><div className="management-choices">{context.result_catalog.map(item=><button type="button" className="cartera-reset" key={item.key} aria-pressed={result===item.key} disabled={saving||(['PAID','PARTIAL_PAYMENT'].includes(item.key)&&!canPay)} onClick={()=>choose(item.key)}>{item.label}</button>)}</div>
        {['PAID','PARTIAL_PAYMENT'].includes(result)?<CollectionPaymentForm key={result} customerId={customerId} invoices={context.open_invoices} kind={result==='PAID'?'TOTAL':'PARTIAL'} referenceDate={referenceDate} onComplete={complete} onCancel={()=>setResult('')}/>:result&&<form className="management-operation" onSubmit={save}><h4>{context.result_catalog.find(item=>item.key===result)?.label}</h4>
          <label>Factura relacionada<select aria-label="Factura relacionada" required={result==='PAYMENT_REPORTED'} value={form.invoice_id} disabled={saving} onChange={event=>setForm({...form,invoice_id:event.target.value})}><option value="">Sin factura específica</option>{context.open_invoices.map(invoice=><option key={invoice.id} value={invoice.id}>{invoice.invoice_number} · Saldo {formatCurrency(invoice.balance)}</option>)}</select></label>
          {result==='PAYMENT_REPORTED'&&<><p className="cartera-alert">Pago reportado · Pendiente de conciliación. No se modificarán saldos ni se registrará un pago confirmado.</p><p>Reportado por: {user?.name||'Usuario actual'}</p><div className="management-grid"><label>Monto informado<input type="number" required min="0.01" step="0.01" value={form.reported_amount} disabled={saving} onChange={event=>setForm({...form,reported_amount:event.target.value})}/></label><label>Fecha informada<input type="date" required value={form.reported_payment_date} disabled={saving} onChange={event=>setForm({...form,reported_payment_date:event.target.value})}/></label></div></>}
          {result==='PROMISE'&&<div className="management-grid"><label>Fecha prometida de gestión<input type="date" required value={form.promised_date} disabled={saving} onChange={event=>setForm({...form,promised_date:event.target.value})}/></label><label>Monto prometido de gestión<input type="number" required min="0.01" step="0.01" value={form.promised_amount} disabled={saving} onChange={event=>setForm({...form,promised_amount:event.target.value})}/></label></div>}
          {result==='WHATSAPP'&&<p>Este resultado registra lo informado por el cobrador. El estado real de entrega se consulta en el Centro de WhatsApp; no se realiza un envío desde este formulario.</p>}
          <label>Observación del resultado<textarea required maxLength={4000} value={form.description} disabled={saving} onChange={event=>setForm({...form,description:event.target.value})}/></label><button className="cartera-reset" disabled={saving}>{saving?'Guardando…':result==='PAYMENT_REPORTED'?'Guardar reporte':'Guardar resultado'}</button>
        </form>}
      </>}
    </>}</>}
  </section>;
}
