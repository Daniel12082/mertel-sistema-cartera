import { useEffect, useState } from "react";
import { formatCurrency } from "../../utils/format";
import { getCustomerHistory } from "../../services/collectionHistory.service";

function dateTime(value) { return new Intl.DateTimeFormat("es-CO", { dateStyle: "short", timeStyle: "short", timeZone: "America/Bogota" }).format(new Date(value)); }
const labels = { action: "Gestión de cobranza", promise: "Promesa de pago", message: "Mensaje WhatsApp", financial: "Movimiento financiero" };
const managementActions = new Set(['CONTACTED','WHATSAPP','PROMISE','NO_RESPONSE','INCONSISTENCY','WRONG_NUMBER','OTHER','PAYMENT_REPORTED','PAYMENT_REGISTERED','PARTIAL_PAYMENT','PAYMENT_CONFIRMED','PAYMENT_REJECTED']);

export default function CustomerHistory({ customerId }) {
  const [type, setType] = useState("all"); const [page, setPage] = useState(1);
  const [state, setState] = useState({ key: null, error: "", data: null });
  const key = `${customerId}|${type}|${page}`;
  useEffect(() => {
    const controller = new AbortController();
    getCustomerHistory(customerId, { type, page, limit: 20 }, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setState({ key, error: "", data }); })
      .catch(error => { if (!controller.signal.aborted) setState({ key, error: error.message, data: null }); });
    return () => controller.abort();
  }, [customerId, type, page, key]);
  const current = state.key === key; const data = current ? state.data : null;
  return <section id="cobranza-historial" className="cobranza-operations" aria-label="Historial cronológico del cliente">
    <h3>Historial del cliente</h3>
    <label className="cobranza-history-filter">Tipo de evento<select aria-label="Tipo de evento" value={type} onChange={event => { setType(event.target.value); setPage(1); }}><option value="all">Todos</option><option value="action">Gestiones</option><option value="promise">Promesas</option><option value="message">Mensajes WhatsApp</option><option value="financial">Movimientos financieros</option></select></label>
    {!current && <p role="status">Cargando historial…</p>}
    {current && state.error && <div className="cartera-alert" role="alert">{state.error}</div>}
    {data && <>
      {!data.events.length ? <p>Este cliente aún no tiene actividad registrada.</p> : <ol className="cobranza-history">{data.events.map(event => <li key={event.id}>
        <strong>{event.type === 'message' || event.type === 'financial' || managementActions.has(event.metadata?.action_type) ? event.title || labels[event.type] : labels[event.type]}</strong><span>{dateTime(event.occurred_at)} · {event.actor === 'SYSTEM' ? 'Sistema' : event.actor || "Usuario no disponible"}</span>
        {event.invoice && <span>Factura: {event.invoice}</span>}{event.metadata?.action_type && <span>Tipo: {event.metadata.action_type}</span>}
        {event.description && <p>{event.description}</p>}{event.metadata?.promised_date && <span>Fecha prometida: {event.metadata.promised_date}</span>}
        {event.metadata?.payment_id && <span>Pago #{event.metadata.payment_id}{event.metadata.allocation_id ? ` · Asignación #${event.metadata.allocation_id}` : ''}</span>}
        {event.metadata?.amount && <span>Monto: {formatCurrency(event.metadata.amount)}</span>}{event.status && <span>Estado: {event.status}</span>}
      </li>)}</ol>}
      <nav className="history-pagination" aria-label="Paginación del historial del cliente"><span>Página {data.pagination.page} de {Math.max(1, data.pagination.pages)} · {data.pagination.total} eventos</span><div>
        <button type="button" disabled={!data.pagination.has_previous} onClick={() => setPage(value => value - 1)}>Anterior</button><button type="button" disabled={!data.pagination.has_next} onClick={() => setPage(value => value + 1)}>Siguiente</button>
      </div></nav>
    </>}
  </section>;
}
