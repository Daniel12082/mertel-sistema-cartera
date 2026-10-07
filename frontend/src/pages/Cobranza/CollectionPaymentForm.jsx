import {useRef,useState} from 'react';
import {collectionResultsRequest} from '../../services/collectionResults.service';
import {formatCurrency,formatDate} from '../../utils/format';

export default function CollectionPaymentForm({customerId,invoices,kind='TOTAL',referenceDate,onComplete,report=null,onCancel}) {
  const [paymentKind,setPaymentKind]=useState(kind);
  const [selected,setSelected]=useState(report?{[report.invoice_id]:report.reported_amount}:{});
  const [form,setForm]=useState({amount:report?.reported_amount || '',payment_date:report?.reported_payment_date || '',payment_method:'',reference:'',notes:''});
  const [preview,setPreview]=useState(null); const [error,setError]=useState(''); const [saving,setSaving]=useState(false);
  const key=useRef(crypto.randomUUID()); const pending=useRef(false); const revision=useRef(0);
  function changeForm(name,value){revision.current++;setForm(current=>({...current,[name]:value}));setPreview(null);setError('');}
  function chooseKind(value){revision.current++;setPaymentKind(value);setSelected({});setForm(current=>({...current,amount:''}));setPreview(null);}
  function chooseInvoice(invoice,checked){
    revision.current++;setPreview(null);setError('');
    if(paymentKind==='MULTIPLE') setSelected(current=>checked?{...current,[invoice.id]:''}:Object.fromEntries(Object.entries(current).filter(([id])=>id!==invoice.id)));
    else {const amount=paymentKind==='TOTAL'?invoice.balance:'';setSelected(checked?{[invoice.id]:amount}:{});setForm(current=>({...current,amount}));}
  }
  const payload=()=>({...form,payment_kind:paymentKind,idempotency_key:key.current,reference_date:referenceDate,
    allocations:Object.entries(selected).map(([invoice_id,amount])=>({invoice_id,amount:paymentKind==='MULTIPLE'?amount:form.amount}))});
  async function generate(event){
    event.preventDefault();if(pending.current)return;pending.current=true;setSaving(true);setError('');const requestRevision=revision.current;
    try{
      const body=payload();
      if(!body.allocations.length)throw new Error('Selecciona una factura.');
      const path=report?`/reports/${report.id}/payment-preview`:`/customers/${customerId}/payment-preview`;
      const result=await collectionResultsRequest(path,{method:'post',body});
      if(requestRevision===revision.current)setPreview(result);
    }catch(failure){setError(failure.message);}finally{pending.current=false;setSaving(false);}
  }
  async function confirm(){
    if(!preview||pending.current)return;pending.current=true;setSaving(true);setError('');
    try{
      const payment={...payload(),confirmation_token:preview.confirmation_token};
      const result=await collectionResultsRequest(report?`/reports/${report.id}/review`:`/customers/${customerId}/payments`,
        {method:'post',body:report?{decision:'CONFIRMED',payment}:payment});
      await onComplete(result);
    }catch(failure){setError(failure.message);}finally{pending.current=false;setSaving(false);}
  }
  return <section className="management-payment" aria-label="Registro financiero de pago"><h4>{report?'Confirmar pago reportado':paymentKind==='TOTAL'?'Pago total':paymentKind==='PARTIAL'?'Pago parcial':'Pago para varias facturas'}</h4>
    {error&&<p role="alert" className="cartera-alert">{error}</p>}
    {!preview?<form onSubmit={generate}>
      {!report&&<label>Distribución del pago<select aria-label="Distribución del pago" value={paymentKind} disabled={saving} onChange={event=>chooseKind(event.target.value)}><option value="TOTAL">Pago total de una factura</option><option value="PARTIAL">Pago parcial de una factura</option><option value="MULTIPLE">Asignar a varias facturas</option></select></label>}
      <fieldset disabled={saving}><legend>Facturas pendientes del cliente</legend>{!invoices.length&&<p>No hay facturas pendientes en el registro financiero.</p>}{invoices.map(invoice=><div className="management-invoice" key={invoice.id}>
        <label><input type={paymentKind==='MULTIPLE'?'checkbox':'radio'} name="payment-invoice" aria-label={`Seleccionar factura ${invoice.invoice_number}`} checked={Object.hasOwn(selected,invoice.id)} disabled={Boolean(report)} onChange={event=>chooseInvoice(invoice,event.target.checked)}/><strong>{invoice.invoice_number}</strong></label><span>Vencimiento: {formatDate(invoice.due_date)}</span><span>Saldo actual: {formatCurrency(invoice.balance)}</span><span>Estado: {invoice.status} · Pendiente: {formatCurrency(invoice.balance)}</span>
        {paymentKind==='MULTIPLE'&&Object.hasOwn(selected,invoice.id)&&<label>Asignar a {invoice.invoice_number}<input aria-label={`Asignar a ${invoice.invoice_number}`} type="number" min="0.01" step="0.01" required value={selected[invoice.id]} onChange={event=>{revision.current++;setSelected({...selected,[invoice.id]:event.target.value});setPreview(null);}}/></label>}
      </div>)}</fieldset>
      <div className="management-grid"><label>Monto recibido<input type="number" min="0.01" step="0.01" required value={form.amount} disabled={saving||paymentKind==='TOTAL'||Boolean(report)} onChange={event=>changeForm('amount',event.target.value)}/></label><label>Fecha de pago<input type="date" required value={form.payment_date} disabled={saving||Boolean(report)} onChange={event=>changeForm('payment_date',event.target.value)}/></label><label>Método de pago<input maxLength={50} value={form.payment_method} disabled={saving} onChange={event=>changeForm('payment_method',event.target.value)}/></label><label>Referencia de pago<input maxLength={150} value={form.reference} disabled={saving} onChange={event=>changeForm('reference',event.target.value)}/></label></div><label>Observación del pago<textarea maxLength={4000} value={form.notes} disabled={saving} onChange={event=>changeForm('notes',event.target.value)}/></label>
      <button className="cartera-reset" disabled={saving||!invoices.length}>{saving?'Calculando…':'Revisar pago'}</button>
      {onCancel&&<button className="cartera-reset" type="button" disabled={saving} onClick={onCancel}>Cancelar pago</button>}
    </form>:<article className="management-confirmation" aria-label="Resumen de confirmación del pago"><h4>Confirmación de pago financiero</h4><p>Cliente: {preview.customer.name}</p>{preview.invoices.map(invoice=><dl key={invoice.id}><dt>Factura</dt><dd>{invoice.invoice_number}</dd><dt>Saldo actual</dt><dd>{formatCurrency(invoice.balance)}</dd><dt>Pago asignado</dt><dd>{formatCurrency(invoice.allocation_amount)}</dd><dt>Saldo resultante calculado por el servidor</dt><dd>{formatCurrency(invoice.resulting_balance)}</dd></dl>)}<p>Monto recibido: {formatCurrency(preview.payment.amount)}</p><p>Disponible sin asignar: {formatCurrency(preview.unallocated_amount)}</p><p className="cartera-alert">Esta acción modificará el registro financiero y el saldo de la factura.</p><button className="cartera-reset" disabled={saving} onClick={confirm}>{saving?'Registrando…':'Confirmar pago'}</button><button className="cartera-reset" disabled={saving} onClick={()=>{setPreview(null);setError('');}}>Cancelar confirmación</button></article>}
  </section>;
}
