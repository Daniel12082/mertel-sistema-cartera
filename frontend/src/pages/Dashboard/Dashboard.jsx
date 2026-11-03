import {lazy,Suspense,useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {Users,FileText,AlertCircle,Wallet,Receipt,MessageSquare,RefreshCw,ArrowUpRight,CalendarDays,CheckCircle2} from 'lucide-react';
import {useAuth} from '../../auth/useAuth';
import {getAdminDashboard} from '../../services/adminDashboard.service';
import {formatCurrency} from '../../utils/format';
import {Panel,StatCard,EmptyState,Badge,DashboardSkeleton} from '../../components/ui/dashboard-ui';
import './Dashboard.css';
import {useAppDataMode} from '../../simulation/useAppDataMode';

const DistributionChart=lazy(()=>import('./DashboardCharts').then(module=>({default:module.DistributionChart})));
const StageBars=lazy(()=>import('./DashboardCharts').then(module=>({default:module.StageBars})));
const ActivityChart=lazy(()=>import('./DashboardCharts').then(module=>({default:module.ActivityChart})));
const tones={prompt_payment:{color:'#27836d',tone:'positive'},days_before_due:{color:'#5573b9',tone:'attention'},due_today:{color:'#b8883d',tone:'urgent'},overdue:{color:'#be2840',tone:'critical'}};
const eventTitles={result_registered:'Gestión registrada',create:'Registro creado',payment_registered:'Pago registrado',confirmation_accepted:'Pago confirmado',report_reviewed:'Reporte revisado',allocation_created:'Pago asignado',balance_updated:'Saldo actualizado',invoice_settled:'Factura saldada',pipeline_recalculated:'Cobranza recalculada',pipeline_exited:'Salida de cobranza',automatic_collection_blocked:'Cobranza detenida',CLIENT_CREATED:'Cliente creado',CLIENT_UPDATED:'Cliente actualizado',CLIENT_MANUAL_RESOLUTION:'Cliente resuelto',CLIENT_MARKED_AMBIGUOUS:'Cliente por revisar',sent:'Mensaje enviado',delivered:'Mensaje entregado'};
const dateTime=value=>new Intl.DateTimeFormat('es-CO',{timeZone:'America/Bogota',dateStyle:'short',timeStyle:'short'}).format(new Date(value));
const money=value=>value==null?'No disponible':formatCurrency(value);
function Metric({label,value,money:monetary=false,context,icon,tone}) { return <StatCard label={label} value={monetary?money(value):value} context={context} icon={icon} tone={tone}/>; }
function ChartBoundary({children}) {return <Suspense fallback={<div className="bi-chart-loading" role="status">Cargando gráfica…</div>}>{children}</Suspense>;}
function CustomerName({customer,canView,referenceDate}) {return <div className="bi-customer-name">{canView?<Link to="/cobranza" state={{customerId:customer.id,referenceDate}}>{customer.name}<ArrowUpRight size={12} aria-hidden="true"/></Link>:<strong>{customer.name}</strong>}<small>{customer.nit||'NIT no disponible'}</small></div>;}

export default function Dashboard() {
  const simulated=useAppDataMode().mode==='SIMULATION';
  const {permissions=[]}=useAuth(),authorized=permissions.includes('settings.manage'),canView=permissions.includes('collection.view');
  const [revision,setRevision]=useState(0),[result,setResult]=useState({revision:null,data:null,error:''});
  useEffect(()=>{
    if(!authorized)return;
    const controller=new AbortController();
    getAdminDashboard({period:'month'},{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setResult({revision,data,error:''});})
      .catch(error=>{if(!controller.signal.aborted)setResult({revision,data:null,error:error.message});});
    return ()=>controller.abort();
  },[authorized,revision]);
  const current=result.revision===revision,data=current?result.data:null,loading=authorized&&!current;
  const value=key=>data?.[key]?.status==='ok'?data[key].data:null;
  const failed=(...keys)=>keys.some(key=>data?.[key]?.status==='error'),refresh=()=>setRevision(value=>value+1);
  const overview=value('overview'),summary=value('summary'),collection=value('collection'),recovery=value('recovery'),reports=value('reported_payments'),promises=value('promises'),resolution=value('resolution');
  const stages=[...(summary?.stages||[])].reverse().map(stage=>({...stage,...(tones[stage.category]||{color:'#7b899e',tone:'neutral'}),amount:Number(stage.balance),shortLabel:stage.label.replace('Faltan ','')}));
  const total=Number(summary?.total_balance||0),unclassified=Number(summary?.unclassified_balance||0);
  const priorities=value('priority_customers'),top=value('top_customers'),activity=value('recent_activity'),trend=value('activity_trend');
  const badgeTone=label=>stages.find(stage=>stage.label===label)?.tone||'neutral';
  const panelProps=(...keys)=>({error:failed(...keys),onRetry:refresh});
  return <section className="mertel-bi" aria-busy={loading}>
    <header className="bi-page-heading"><div><h2>Dashboard</h2><p>Resumen general de cartera, cobranza y comportamiento de clientes.</p></div><div className="bi-heading-actions">{data&&<span className="bi-reference"><CalendarDays size={14} aria-hidden="true"/>{data.period.reference_date}<small>Bogotá</small></span>}{authorized&&<button className="bi-refresh" disabled={loading} onClick={refresh}><RefreshCw size={15} aria-hidden="true"/>Actualizar</button>}</div></header>
    {!authorized&&<EmptyState title="No tienes permiso para consultar el resumen global de MERTEL." description="Accede a los módulos autorizados desde el menú."/>}
    {loading&&<DashboardSkeleton/>}
    {current&&result.error&&<div className="ui-error" role="alert"><AlertCircle size={18}/><span>No pudimos cargar el Dashboard. Intenta actualizar.</span><button onClick={refresh}>Reintentar</button></div>}
    {data&&<>
      <section className="bi-kpis" aria-label="Resumen general">
        <Metric label="Clientes con cartera" value={overview?.customers_with_balance} context="Con saldo pendiente" icon={Users}/>
        <Metric label="Facturas pendientes" value={overview?.pending_invoices} context={simulated?'Documentos temporales en memoria':'Documentos persistentes'} icon={FileText}/>
        <Metric label="Facturas en mora" value={overview?.overdue_invoices} context="Vencimiento anterior a hoy" icon={AlertCircle} tone="critical"/>
        <Metric label="Saldo total por cobrar" value={summary?.total_balance} money context="Cartera actual · COP" icon={Wallet} tone="featured"/>
        <Metric label="Valor facturado disponible" value={overview?.invoiced_value} money context="Clientes activos · incluye saldadas" icon={Receipt}/>
        <Metric label="Mensajes enviados este mes" value={overview?.sent_messages} context="Salientes · incluye MOCK" icon={MessageSquare}/>
      </section>
      {failed('overview','summary')&&<div className="ui-error" role="alert">Parte del resumen no está disponible.<button onClick={refresh}>Reintentar</button></div>}
      {overview&&Number(overview.pending_invoices)===0&&<div className="bi-empty-banner"><CheckCircle2 size={17} aria-hidden="true"/><span>{simulated?'Sin facturas temporales con saldo pendiente.':'Sin facturas persistentes con saldo pendiente.'}</span><small>{simulated?'Los datos de esta simulación solo existen en memoria.':'No se utilizan valores del Excel temporal.'}</small></div>}
      <div className="bi-grid bi-grid-60">
        <Panel title="Estado de cartera" description="Etapas del motor de cobranza · estado actual" action={canView&&<Link className="bi-panel-link" to="/cobranza">Ver cartera<ArrowUpRight size={13}/></Link>} {...panelProps('summary')}>
          {summary?<div className="bi-stage-list">{stages.map(stage=><div className="bi-stage-row" key={stage.key}><div className="bi-stage-title"><Badge tone={stage.tone}>{stage.label}</Badge><strong>{money(stage.balance)}</strong></div><div className="bi-stage-meta"><span>{stage.customers} clientes</span><span>{stage.documents} documentos</span><span>{total>0?(stage.amount/total*100).toFixed(1)+'%':'—'}</span></div><div className="bi-stage-track" aria-hidden="true"><span style={{width:(total>0?Math.min(100,stage.amount/total*100):0)+'%',background:stage.color}}/></div></div>)}</div>:<EmptyState title="No disponible" description="Actualiza para consultar la clasificación vigente."/>}
          {summary?.warnings?.length>0&&<details className="bi-policy-notes"><summary>Consideraciones de las reglas de cobranza</summary><ul>{summary.warnings.map(warning=><li key={warning}>{warning}</li>)}</ul></details>}
        </Panel>
        <Panel title="Distribución de cartera" description={simulated?'Participación sobre el saldo temporal de la simulación':'Participación sobre el saldo pendiente real'} {...panelProps('summary')}>{summary?<ChartBoundary><DistributionChart rows={stages} total={total} unclassified={unclassified}/></ChartBoundary>:<EmptyState title="No disponible"/>}</Panel>
      </div>
      <div className="bi-grid bi-grid-50">
        <Panel title="Saldo por etapa" description="¿Dónde se concentra la cartera? · COP" {...panelProps('summary')}>{summary?<ChartBoundary><StageBars rows={stages}/></ChartBoundary>:<EmptyState title="No disponible"/>}</Panel>
        <Panel title="Análisis de clientes" description="Clientes actuales y distribución por etapa" {...panelProps('overview','resolution','summary')}>
          <div className="bi-client-metrics"><Metric label="Total de clientes" value={overview?.total_customers}/><Metric label="Clientes con saldo pendiente" value={overview?.customers_with_balance}/><Metric label="Clientes por resolver" value={resolution?.pending}/></div>
          <h4 className="bi-subheading">Clientes por etapa</h4>{summary?<ChartBoundary><StageBars rows={stages} kind="clients"/></ChartBoundary>:<EmptyState title="No disponible"/>}<small className="bi-footnote">Un cliente puede tener documentos en más de una etapa.</small>
        </Panel>
      </div>
      <div className="bi-grid bi-grid-60">
        <Panel title="Clientes con mayor saldo pendiente" description="Hasta 10 clientes · saldo descendente" {...panelProps('top_customers')}>
          {top?.length?<div className="bi-table-wrap"><table className="bi-table"><thead><tr><th>Cliente / NIT</th><th className="numeric">Saldo</th><th className="numeric">Facturas</th><th>Etapa</th><th className="numeric">Prioridad</th></tr></thead><tbody>{top.map(customer=><tr key={customer.id}><td data-label="Cliente"><CustomerName customer={customer} canView={canView} referenceDate={data.period.reference_date}/></td><td className="numeric" data-label="Saldo">{money(customer.balance)}</td><td className="numeric" data-label="Facturas">{customer.invoices_count??'—'}</td><td data-label="Etapa"><Badge tone={badgeTone(customer.stage)}>{customer.stage}</Badge></td><td className="numeric" data-label="Prioridad">{customer.priority??'—'}</td></tr>)}</tbody></table></div>:<EmptyState title={top?'No hay clientes con cartera':'No disponible'} description="El ranking utiliza únicamente saldos financieros persistentes."/>}
        </Panel>
        <Panel title="Clientes prioritarios" description="Orden original del motor de cobranza" {...panelProps('priority_customers')}>
          {priorities?.length?<ol className="bi-priority-list">{priorities.slice(0,10).map((customer,index)=><li key={customer.id}><span className="bi-rank">{index+1}</span><div><CustomerName customer={customer} canView={canView} referenceDate={data.period.reference_date}/><div className="bi-priority-meta"><Badge tone={badgeTone(customer.stage)}>{customer.stage}</Badge><span>{customer.invoice||'Sin documento principal'}</span></div><small>Vencimiento: {customer.due_date||'No disponible'}</small></div><strong>{money(customer.balance)}</strong></li>)}</ol>:<EmptyState title={priorities?'Sin clientes prioritarios en cobranza.':'No disponible'} description="Las prioridades aparecen cuando el motor identifica documentos elegibles."/>}
        </Panel>
      </div>
      <div className="bi-period-label"><span>Actividad del mes</span><small>{data.period.from} — {data.period.to} · Pendientes: estado actual</small></div>
      <div className="bi-grid bi-grid-60">
        <Panel title="Actividad de cobranza" description="Gestiones, promesas y recuperación registrada" {...panelProps('collection','promises','recovery')}>
          <div className="bi-collection-metrics"><Metric label="Clientes gestionados este mes" value={collection?.managed_customers}/><Metric label="Gestiones realizadas este mes" value={collection?.actions_count}/><Metric label="Promesas pendientes" value={promises?.pending_count}/><Metric label="Promesas cumplidas este mes" value={promises?.fulfilled_period}/><Metric label="Pagos confirmados este mes" value={recovery?.payments_count}/><Metric label="Valor recuperado registrado este mes" value={recovery?.payments_amount} money/></div><small className="bi-footnote">Pagos confirmados registrados; sin atribución a gestiones ni cobradores.</small>
        </Panel>
        <Panel title="Pagos" description="Confirmados del mes y reportes pendientes actuales" action={permissions.includes('payments.view')&&<Link className="bi-panel-link" to="/pagos">Ver pagos<ArrowUpRight size={13}/></Link>} {...panelProps('recovery','reported_payments')}>
          <div className="bi-payment-total"><span>Valor de pagos confirmados</span><strong>{money(recovery?.payments_amount)}</strong><Badge>{recovery?.payments_count??'—'} confirmados</Badge></div>
          <div className="bi-report-metrics"><Metric label="Pagos reportados pendientes de revisión" value={reports?.count}/><Metric label="Valor reportado pendiente de revisión" value={reports?.amount} money/></div>
          {recovery&&Number(recovery.payments_count)===0&&<p className="bi-footnote">No existen pagos confirmados en el período.</p>}<small className="bi-footnote">Reportar un pago no modifica el saldo financiero.</small>
        </Panel>
      </div>
      <div className="bi-grid bi-grid-50">
        <Panel title="Tendencia de actividad" description="Registros por fecha en Bogotá · gestiones, pagos y promesas" {...panelProps('activity_trend')}>{trend?<ChartBoundary><ActivityChart rows={trend}/></ChartBoundary>:<EmptyState title="No disponible" description="Actualiza para consultar el histórico del período."/>}</Panel>
        <Panel title="Actividad reciente" description="Últimos eventos operativos del mes" {...panelProps('recent_activity')}>
          {activity?.length?<ol className="bi-activity">{activity.slice(0,20).map(event=><li key={event.id}><span className="bi-activity-dot" aria-hidden="true"/><div><strong>{eventTitles[event.action]||(event.action==='create'&&event.entity_type==='payment_promise'?'Promesa registrada':'Actividad registrada')}</strong>{event.customer_name&&<p>{event.customer_name}{event.invoice_number?' · '+event.invoice_number:''}</p>}<small>{event.actor} · {dateTime(event.occurred_at)}</small></div><Badge>{event.status||'Registrado'}</Badge></li>)}</ol>:<EmptyState title={activity?'Sin actividad operativa registrada este mes.':'No disponible'} description="No se agregan eventos de demostración."/>}
        </Panel>
      </div>
    </>}
  </section>;
}
