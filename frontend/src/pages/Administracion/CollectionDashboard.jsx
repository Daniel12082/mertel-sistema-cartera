import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { getCollectionDashboard } from "../../services/collectionDashboard.service";
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
    {data && <>
      <p className="dashboard-reference">Fecha de referencia: <strong>{displayDate(data.reference_date)}</strong> · Actividad: {displayDate(data.activity.activity_from)}–{displayDate(data.activity.activity_to)}</p>
      <div className="dashboard-cards"><article><span>Saldo pendiente total</span><strong>{cop.format(Number(data.portfolio.total_balance))}</strong></article><article><span>Clientes en cobranza</span><strong>{data.portfolio.customers_in_collection}</strong></article><article><span>Promesas pendientes</span><strong>{data.promises.pending_count}</strong><small>{cop.format(Number(data.promises.pending_amount))} prometidos</small></article><article><span>Gestiones en el período</span><strong>{data.activity.actions_period}</strong></article></div>
      <section className="dashboard-panel"><h3>Distribución por etapa</h3>{!data.stages.some(stage => stage.customers) && <p>MERTEL Importaciones no tiene datos de cartera para la fecha seleccionada.</p>}<div className="dashboard-stages">{data.stages.map(stage => <article key={stage.key}><h4>{stage.label}</h4><strong>{stage.customers} {stage.customers === 1 ? "cliente" : "clientes"}</strong><span>{cop.format(Number(stage.balance))}</span></article>)}</div></section>
      <section className="dashboard-panel"><h3>Actividad de cobranza</h3><p><strong>{data.activity.actions_period}</strong> gestiones registradas entre {displayDate(data.activity.activity_from)} y {displayDate(data.activity.activity_to)}.</p></section>
      {data.warnings?.length > 0 && <section className="dashboard-panel dashboard-warnings"><h3>Advertencias de configuración</h3><ul>{data.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></section>}
      {data.collection_status === "no_rules_configured" && <div className="dashboard-notice">{data.message} El saldo pendiente y las gestiones disponibles continúan visibles.</div>}
    </>}
  </section>;
}
