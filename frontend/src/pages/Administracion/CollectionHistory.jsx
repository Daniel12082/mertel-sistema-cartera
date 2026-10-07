import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { formatCurrency } from "../../utils/format";
import { getAdministrativeHistory, getAdministrativeHistoryActors } from "../../services/collectionHistory.service";
import "./CollectionHistory.css";

function dayValue(date = new Date()) { return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-"); }
function shownDate(value) { return new Intl.DateTimeFormat("es-CO", { dateStyle: "short", timeStyle: "short", timeZone: "America/Bogota" }).format(new Date(value)); }
const kinds = { action: "Gestión", promise: "Promesa", configuration: "Configuración", import: "Importación" };

export default function CollectionHistory({navigationState}) {
  const { permissions = [] } = useAuth(); const authorized = permissions.includes("history.view") && permissions.includes("settings.manage");
  const today = useMemo(() => dayValue(), []);
  const [actors, setActors] = useState({ key: null, rows: [] });
  const [filters, setFilters] = useState(()=>({ date_from: "", date_to: "", type: navigationState?.type==='promise'?'promise':'all', actor_id: "", q: typeof navigationState?.q==='string'?navigationState.q.slice(0,120):"" }));
  const [page, setPage] = useState(1); const [result, setResult] = useState({ key: null, error: "", data: null });
  const ready = authorized;
  useEffect(() => {
    if (!ready) return undefined;
    const controller = new AbortController();
    getAdministrativeHistoryActors({ signal: controller.signal })
      .then(rows => { if (!controller.signal.aborted) setActors({ key: "mertel", rows }); })
      .catch(() => { if (!controller.signal.aborted) setActors({ key: "mertel", rows: [] }); });
    return () => controller.abort();
  }, [ready]);
  const params = useMemo(() => ({ ...filters, page, limit: 20 }), [filters, page]);
  const key = ready ? JSON.stringify(params) : null;
  useEffect(() => {
    if (!ready) return undefined;
    const controller = new AbortController();
    getAdministrativeHistory(params, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setResult({ key, error: "", data }); })
      .catch(error => { if (!controller.signal.aborted) setResult({ key, error: error.message, data: null }); });
    return () => controller.abort();
  }, [ready, key, params]);
  function update(name, value) { setPage(1); setFilters(current => ({ ...current, [name]: value })); }
  if (!authorized) return <section className="collection-history-page"><div className="history-notice error" role="alert">No tienes permiso para consultar el historial administrativo.</div></section>;
  const current = ready && result.key === key; const loading = ready && !current; const data = current ? result.data : null;
  const actorRows = actors.key === "mertel" ? actors.rows : [];
  return <section className="collection-history-page">
    <header><div><h2>Historial de cobranza</h2><p>Consulta cronológica de eventos operativos y administrativos.</p></div></header>
    <div className="history-filters">
      <label>Desde<input type="date" max={filters.date_to || today} value={filters.date_from} onChange={event => update("date_from", event.target.value)} /></label>
      <label>Hasta<input type="date" min={filters.date_from || undefined} value={filters.date_to} onChange={event => update("date_to", event.target.value)} /></label>
      <label>Tipo<select aria-label="Tipo de evento" value={filters.type} onChange={event => update("type", event.target.value)}><option value="all">Todos</option><option value="action">Gestiones</option><option value="promise">Promesas</option><option value="configuration">Configuración</option><option value="import">Importaciones</option></select></label>
      <label>Usuario<select aria-label="Usuario" value={filters.actor_id} onChange={event => update("actor_id", event.target.value)}><option value="">Todos</option>{actorRows.map(actor => <option key={actor.id} value={actor.id}>{actor.name}</option>)}</select></label>
      <label>Cliente, identificación, factura o archivo<input type="search" maxLength="120" value={filters.q} onChange={event => update("q", event.target.value)} placeholder="Buscar" /></label>
    </div>
    {loading && <p role="status">Cargando historial…</p>}
    {current && result.error && <div role="alert" className="history-notice error">{result.error}</div>}
    {data && <>
      {!data.events.length ? <p>Sin eventos para los filtros seleccionados.</p> : <ol className="history-timeline">{data.events.map(event => <li key={event.id}>
        <time dateTime={event.occurred_at}>{shownDate(event.occurred_at)}</time><div className="history-event"><strong>{event.title || kinds[event.type]}</strong><span>{kinds[event.type]} · {event.actor || "Usuario no disponible"}</span>
          {event.customer && <span>Cliente: {event.customer.name}{event.customer.identification ? " · " + event.customer.identification : ""}</span>}{event.invoice && <span>Factura: {event.invoice}</span>}
          {event.description && <p>{event.description}</p>}{event.metadata?.promised_date && <span>Fecha prometida: {event.metadata.promised_date}</span>}
          {event.metadata?.amount && <span>Monto prometido: {formatCurrency(event.metadata.amount)}</span>}{event.status && <span>Estado: {event.status}</span>}
          {event.metadata?.file_name && <span>Archivo: {event.metadata.file_name} · Filas: {event.metadata.total_rows} · Errores: {event.metadata.failed_rows}</span>}
          {(event.metadata?.before || event.metadata?.after) && <span>Etapas: {JSON.stringify(event.metadata.before || [])} → {JSON.stringify(event.metadata.after || [])}</span>}
        </div>
      </li>)}</ol>}
      <nav className="history-pagination" aria-label="Paginación de historial"><span>Página {data.pagination.page} de {Math.max(1, data.pagination.pages)} · {data.pagination.total} eventos</span><div><button type="button" disabled={!data.pagination.has_previous || loading} onClick={() => setPage(value => value - 1)}>Anterior</button><button type="button" disabled={!data.pagination.has_next || loading} onClick={() => setPage(value => value + 1)}>Siguiente</button></div></nav>
    </>}
  </section>;
}
