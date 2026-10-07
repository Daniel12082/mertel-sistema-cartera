import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { getCollectionDashboard } from "../../services/collectionDashboard.service";
import { getCustomerResolutionDashboard } from "../../services/portfolioImport.service";
import "./CollectionDashboard.css";

function localDate(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function shiftDate(value, days) {
  const [year, month, day] = value.split("-").map(Number); const date = new Date(0); date.setUTCFullYear(year, month - 1, day + days);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}
function displayDate(value) { return value ? value.split("-").reverse().join("/") : "—"; }
const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 2 });

export default function CollectionDashboard() {
  const { permissions = [] } = useAuth();
  const authorized = permissions.includes("collection.view") && permissions.includes("settings.manage");
  const today = useMemo(() => localDate(), []);
  const [referenceDate, setReferenceDate] = useState(today); const [period, setPeriod] = useState("7");
  const [state, setState] = useState({ key: null, error: "", data: null });
  const [resolution,setResolution]=useState(null); const [resolutionError,setResolutionError]=useState("");
  const activityFrom = period === "today" ? today : shiftDate(today, -(Number(period) - 1));
  const params = useMemo(() => ({ reference_date: referenceDate, activity_from: activityFrom, activity_to: today }), [referenceDate, activityFrom, today]);
  const ready = authorized;
  const requestKey = ready ? JSON.stringify(params) : null;

  useEffect(() => {
    if (!ready) return undefined;
    const controller = new AbortController();
    getCollectionDashboard(params, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setState({ key: requestKey, error: "", data });
    }).catch(error => { if (!controller.signal.aborted) setState({ key: requestKey, error: error.message, data: null }); });
    return () => controller.abort();
  }, [ready, requestKey, params]);
  useEffect(()=>{if(!permissions.includes("portfolio.import"))return undefined;const controller=new AbortController();getCustomerResolutionDashboard({signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setResolution(value);}).catch(error=>{if(!controller.signal.aborted)setResolutionError(error.message);});return()=>controller.abort();},[permissions]);

  if (!authorized) return <section className="collection-dashboard"><div className="dashboard-notice error" role="alert">No tienes permiso para consultar el dashboard administrativo de cobranza.</div></section>;
  const current = ready && state.key === requestKey;
  const loading = ready && !current;
  const data = current ? state.data : null;
  return <section className="collection-dashboard">
    <header className="dashboard-header"><div><h2>Dashboard de cobranza</h2><p>Resumen operativo de cartera, promesas y actividad.</p></div></header>
    <div className="dashboard-filters">
      <label>Fecha de referencia de cartera<input type="date" value={referenceDate} onChange={event => setReferenceDate(event.target.value)} /></label>
      <label>Período de actividad<select aria-label="Período de actividad" value={period} onChange={event => setPeriod(event.target.value)}><option value="today">Hoy</option><option value="7">Últimos 7 días</option><option value="30">Últimos 30 días</option></select></label>
    </div>
    {loading && <div className="dashboard-notice" role="status">Cargando dashboard…</div>}
    {current && state.error && <div className="dashboard-notice error" role="alert">{state.error}</div>}
    {!data&&permissions.includes("portfolio.import")&&<section className="dashboard-panel customer-resolution-dashboard"><h3>🔎 Clientes por resolver</h3>{resolutionError&&<p role="alert">{resolutionError}</p>}{resolution&&<><p>{resolution.pending?`Hay ${resolution.pending} clientes pendientes de resolución.`:"No hay clientes pendientes de resolución."}</p>{resolution.batches.map(batch=><p key={batch.id}><Link to={`/administracion/resolucion-clientes?batch_id=${encodeURIComponent(batch.id)}`}>Revisar {batch.file_name}</Link></p>)}{!resolution.batches.length&&<Link to="/administracion/importar-cartera">Analizar una nueva cartera</Link>}</>}</section>}
    {data && <>
      <p className="dashboard-reference">Fecha de referencia: <strong>{displayDate(data.reference_date)}</strong> · Actividad: {displayDate(data.activity.activity_from)}–{displayDate(data.activity.activity_to)}</p>
      <div className="dashboard-cards"><article><span>Saldo pendiente total</span><strong>{cop.format(Number(data.portfolio.total_balance))}</strong></article><article><span>Clientes en cobranza</span><strong>{data.portfolio.customers_in_collection}</strong></article><article><span>Promesas pendientes</span><strong>{data.promises.pending_count}</strong><small>{cop.format(Number(data.promises.pending_amount))} prometidos</small></article><article><span>Gestiones en el período</span><strong>{data.activity.actions_period}</strong></article></div>
      {permissions.includes("portfolio.import")&&<section className="dashboard-panel customer-resolution-dashboard"><h3>🔎 Clientes por resolver</h3>{resolutionError&&<p role="alert">{resolutionError}</p>}{resolution&&<><div className="dashboard-cards"><article><span>Pendientes de búsqueda</span><strong>{resolution.counts.SEARCHING}</strong></article><article><span>Encontrados</span><strong>{resolution.counts.PERSISTENT}</strong></article><article><span>Nuevos</span><strong>{resolution.counts.NEW}</strong></article><article><span>Ambiguos</span><strong>{resolution.counts.AMBIGUOUS}</strong></article><article><span>Inválidos</span><strong>{resolution.counts.INVALID}</strong></article><article><span>Resueltos</span><strong>{resolution.counts.RESOLVED}</strong></article></div>{resolution.pending>0&&<p className="dashboard-notice error">Hay {resolution.pending} clientes pendientes de resolución.</p>}{resolution.batches.length>0&&resolution.batches.map(batch=><p key={batch.id}><Link to={`/administracion/resolucion-clientes?batch_id=${encodeURIComponent(batch.id)}`}>Revisar {batch.file_name}</Link></p>)}{!resolution.batches.length&&<Link to="/administracion/importar-cartera">Analizar una nueva cartera</Link>}</>}</section>}
      <section className="dashboard-panel"><h3>Distribución por etapa</h3>{!data.stages.some(stage => stage.customers) && <p>MERTEL Importaciones no tiene datos de cartera para la fecha seleccionada.</p>}<div className="dashboard-stages">{data.stages.map(stage => <article key={stage.key}><h4>{stage.label}</h4><strong>{stage.customers} {stage.customers === 1 ? "cliente" : "clientes"}</strong><span>{cop.format(Number(stage.balance))}</span></article>)}</div></section>
      <section className="dashboard-panel"><h3>Actividad de cobranza</h3><p><strong>{data.activity.actions_period}</strong> gestiones registradas entre {displayDate(data.activity.activity_from)} y {displayDate(data.activity.activity_to)}.</p></section>
      {data.warnings?.length > 0 && <section className="dashboard-panel dashboard-warnings"><h3>Advertencias de configuración</h3><ul>{data.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></section>}
      {data.collection_status === "no_rules_configured" && <div className="dashboard-notice">{data.message} El saldo pendiente y las gestiones disponibles continúan visibles.</div>}
    </>}
  </section>;
}
