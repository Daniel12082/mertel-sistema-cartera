import {useEffect,useState} from 'react';
import {useAuth} from '../../auth/useAuth';
import {collectionResultsRequest} from '../../services/collectionResults.service';
import CollectionPaymentForm from '../Cobranza/CollectionPaymentForm';
import {formatCurrency,formatDate} from '../../utils/format';
import '../Cobranza/ManagementResults.css';
const labels={PENDING_REVIEW:'Pendiente de conciliación',CONFIRMED:'Confirmado',REJECTED:'Rechazado'};

export default function ReportedPayments(){
  const {permissions=[]}=useAuth();const allowed=permissions.includes('settings.manage');const canConfirm=permissions.includes('payments.create')&&permissions.includes('payment_allocations.create');
  const [status,setStatus]=useState('PENDING_REVIEW');const [page,setPage]=useState(1);const [data,setData]=useState(null);
  const [error,setError]=useState('');const [notice,setNotice]=useState('');const [revision,setRevision]=useState(0);
  const [selected,setSelected]=useState(null);const [context,setContext]=useState(null);const [rejecting,setRejecting]=useState(null);const [reason,setReason]=useState('');const [busy,setBusy]=useState(false);
  useEffect(()=>{
    if(!allowed)return;const controller=new AbortController();
    collectionResultsRequest('/reports',{params:{status,page},signal:controller.signal}).then(result=>{if(!controller.signal.aborted){setData(result);setError('');}}).catch(failure=>{if(!controller.signal.aborted)setError(failure.message);});
    return()=>controller.abort();
  },[allowed,status,page,revision]);
  async function open(report){setError('');setBusy(true);try{const result=await collectionResultsRequest(`/customers/${report.customer_id}/context`);setSelected(report);setContext(result);setRejecting(null);}catch(failure){setError(failure.message);}finally{setBusy(false);}}
  async function reject(event){event.preventDefault();if(busy)return;setBusy(true);setError('');try{await collectionResultsRequest(`/reports/${rejecting.id}/review`,{method:'post',body:{decision:'REJECTED',reason}});setRejecting(null);setNotice('Reporte rechazado con motivo. El saldo no cambió.');setRevision(value=>value+1);}catch(failure){setError(failure.message);}finally{setBusy(false);}}
  if(!allowed)return <section><h1>Pagos reportados</h1><p role="alert">No tienes permiso para revisar pagos reportados.</p></section>;
  return <section className="cartera-page reported-payments"><header className="cartera-header"><div><h1>Pagos reportados</h1><p>Revisa lo informado por cobranza antes de confirmarlo en el registro financiero.</p></div></header>{error&&<p role="alert" className="cartera-alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    <section className="cartera-panel"><label>Estado del reporte<select aria-label="Estado del reporte" value={status} onChange={event=>{setStatus(event.target.value);setPage(1);}}><option value="">Todos</option>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      {!data?<p role="status">Cargando reportes…</p>:!data.reports.length?<p>No hay pagos reportados para este estado.</p>:<div className="cartera-table-wrap"><table className="cartera-table"><thead><tr><th>Cliente / NIT</th><th>Factura</th><th>Monto / fecha informados</th><th>Usuario / reporte</th><th>Estado</th><th>Revisión</th></tr></thead><tbody>{data.reports.map(report=><tr key={report.id}><td>{report.customer_name}<br/>{report.nit}</td><td>{report.invoice_number}<p>Saldo actual {formatCurrency(report.current_balance)}</p></td><td>{formatCurrency(report.reported_amount)}<p>{formatDate(report.reported_payment_date)}</p></td><td>{report.reported_by}<p>{formatDate(report.reported_at)}</p></td><td>{labels[report.status]}{report.confirmed_payment_id&&<p>Pago #{report.confirmed_payment_id}</p>}{report.review_reason&&<p>Motivo: {report.review_reason}</p>}</td><td>{report.status==='PENDING_REVIEW'&&<><button className="cartera-reset" disabled={busy||!canConfirm} onClick={()=>open(report)}>Revisar pago {report.id}</button><button className="cartera-reset" disabled={busy} onClick={()=>{setRejecting(report);setReason('');setSelected(null);}}>Rechazar {report.id}</button></>}</td></tr>)}</tbody></table></div>}
      <button className="cartera-reset" disabled={page===1} onClick={()=>setPage(value=>value-1)}>Anterior</button><span>Página {page}</span><button className="cartera-reset" disabled={!data?.has_next} onClick={()=>setPage(value=>value+1)}>Siguiente</button><button className="cartera-reset" onClick={()=>setRevision(value=>value+1)}>Actualizar reportes</button>
    </section>
    {selected&&context&&<section className="cartera-panel"><h2>Revisión de {selected.customer_name}</h2><p>Confirma que el soporte financiero corresponde al monto, fecha y factura reportados. El registro requiere el resumen de saldos del servidor.</p><CollectionPaymentForm key={selected.id} customerId={selected.customer_id} invoices={context.open_invoices} kind={selected.reported_amount===context.open_invoices.find(invoice=>invoice.id===selected.invoice_id)?.balance?'TOTAL':'PARTIAL'} report={selected} referenceDate={context.reference_date} onComplete={()=>{setSelected(null);setContext(null);setNotice('Pago reportado confirmado y registrado. Los saldos fueron recalculados por el servidor.');setRevision(value=>value+1);}} onCancel={()=>setSelected(null)}/></section>}
    {rejecting&&<form className="cartera-panel" onSubmit={reject}><h2>Rechazar reporte de {rejecting.customer_name}</h2><label>Motivo del rechazo<textarea required maxLength={4000} value={reason} onChange={event=>setReason(event.target.value)}/></label><button className="cartera-reset" disabled={busy}>Guardar rechazo</button><button className="cartera-reset" type="button" onClick={()=>setRejecting(null)}>Cancelar rechazo</button></form>}
  </section>;
}
