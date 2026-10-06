import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CalendarDays, FileText, LoaderCircle, RefreshCw, Users, X } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { getCollection } from "../../services/collection.service";
import { formatCurrency, formatDate } from "../../utils/format";
import { getStageCatalog, localDateValue, matchesSearch, stageLabel } from "./collection.presentation";
import "../Cartera/Cartera.css";
import "./Cobranza.css";
import CollectionOperations from "./CollectionOperations";
import CollectionBenefits from "./CollectionBenefits";
import CollectionMessages from "./CollectionMessages";
import CustomerHistory from "./CustomerHistory";

function StageBadge({ stage, catalog = [], label }) {
  const category = catalog.find(item => item.key === stage)?.category;
  const tone = category === "prompt_payment" ? "current" : category === "overdue" ? "overdue" : category ? "nodue" : "total";
  return <span className={`cartera-status cartera-status-${tone === "current" ? "current" : tone === "overdue" ? "overdue" : tone === "nodue" ? "due_today" : "unknown"}`}>{stageLabel(stage, catalog, label)}</span>;
}

function State({ title, loading = false, children }) {
  return <div className="cartera-state" role="status">{loading ? <LoaderCircle className="cartera-spin" size={23} /> : <FileText size={27} />}<strong>{title}</strong>{children}</div>;
}

function DetailValue({ label, children }) {
  return <div className="cobranza-detail-value"><span>{label}</span><strong>{typeof children === "string" && !children.trim() ? "—" : children ?? "—"}</strong></div>;
}
const displayMoney = value => value == null || value === "" ? "—" : formatCurrency(value);

function StageCandidates({ candidates }) {
  if (!Array.isArray(candidates)) return "—";
  if (!candidates.length) return "Sin candidatos";
  return <ul className="cobranza-candidates">{candidates.map((candidate, index) => <li key={index}><strong>{candidate.stage ?? "—"}</strong><span>Prioridad: {candidate.priority ?? "—"}</span>{candidate.reason && <span>{candidate.reason}</span>}</li>)}</ul>;
}

function CustomerCard({ item, catalog, onDetail, onMessage, canManage, pending = false }) {
  const daysUntilDue = item.main_invoice?.days_until_due;
  const dueTiming = daysUntilDue == null ? "Días para vencimiento no disponibles" : daysUntilDue < 0 ? `${Math.abs(daysUntilDue)} días de mora` : daysUntilDue === 0 ? "Vence hoy" : `${daysUntilDue} días para vencimiento`;
  return <article className="cobranza-client-card" aria-label={`Cliente ${item.customer.name || "No registrado"}`}>
    <div className="cobranza-card-heading"><div><h3>{item.customer.name || "No registrado"}</h3><span>{item.customer.nit || "Identificación no registrada"}</span></div><StageBadge stage={item.stage} catalog={catalog} label={item.stage_label} /></div>
    <p className="cobranza-card-balance"><span>Saldo total pendiente</span><strong>{item.total_balance == null ? "—" : displayMoney(item.total_balance)}</strong></p>
    <dl><div><dt>Factura principal</dt><dd>{item.main_invoice?.invoice?.invoice_number || "—"}</dd></div><div><dt>Vencimiento</dt><dd>{formatDate(item.main_invoice?.invoice?.due_date)}</dd></div><div><dt>Situación de vencimiento</dt><dd>{dueTiming}</dd></div><div><dt>Prioridad</dt><dd>{item.priority ?? "—"}</dd></div><div><dt>Facturas</dt><dd>{item.invoices.length}</dd></div></dl>
    {item.current_promise && <p className="cobranza-promise-indicator" role="status">Promesa pendiente · {formatDate(item.current_promise.promised_date)} · {displayMoney(item.current_promise.promised_amount)}</p>}
    {pending && <p className="cobranza-note">{item.invoices.map(row => row.invoice?.invoice_number).filter(Boolean).join(" · ") || "—"}</p>}
    <p className="cobranza-note">{item.reason || "Motivo no registrado"}</p>
    <div className="cobranza-card-actions"><button className="cartera-link-button" aria-label={pending ? `Ver factura no vencida ${item.invoices[0]?.invoice?.invoice_number || "cliente"}` : `Ver detalle de ${item.customer.name || "cliente"}`} onClick={onDetail}>Ver cliente</button>
      <button className="cartera-reset cobranza-whatsapp-button" disabled={!canManage} onClick={onMessage}>Enviar mensaje a WhatsApp</button>
    </div>{!canManage && <span className="cobranza-note">No tienes permiso para preparar mensajes.</span>}
  </article>;
}

function CustomerDetail({ item, catalog, referenceDate, onClose, messageFirst, canViewHistory }) {
  const dialog = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const node = dialog.current;
    node.querySelector(messageFirst ? "[data-message-start]" : "button")?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function keydown(event) {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const controls = [...node.querySelectorAll("button, a[href], input, select, textarea, summary, [tabindex='0']")].filter(control => !control.disabled && control.getClientRects().length);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    node.addEventListener("keydown", keydown);
    return () => { node.removeEventListener("keydown", keydown); document.body.style.overflow = overflow; previous?.focus(); };
  }, [onClose, messageFirst]);
  const primary = item.main_invoice?.invoice;
  return <div className="cartera-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} className="cartera-modal cobranza-modal" role="dialog" aria-modal="true" aria-labelledby="cobranza-detail-title">
      <header className="cartera-modal-header"><div><h2 id="cobranza-detail-title">Cobranza de {item.customer.name || "Cliente"}</h2><p>Referencia {formatDate(referenceDate)}</p></div><button className="cartera-close" aria-label="Cerrar detalle" onClick={onClose}><X size={19} /></button></header>
      <div className="cartera-modal-body">
        <nav className="cobranza-detail-navigation" aria-label="Secciones del cliente"><a href="#cobranza-resumen">Resumen</a><a href="#cobranza-facturas">Facturas</a><a href="#cobranza-gestiones">Gestiones</a><a href="#cobranza-promesas">Promesas</a>{canViewHistory && <a href="#cobranza-historial">Historial</a>}<a href="#cobranza-whatsapp">WhatsApp</a></nav>
        <div id="cobranza-resumen" className="cobranza-detail-grid">
          <DetailValue label="Cliente">{item.customer.name || "No registrado"}</DetailValue>
          <DetailValue label="NIT">{item.customer.nit}</DetailValue><DetailValue label="Teléfono">{item.customer.phone}</DetailValue>
          <DetailValue label="Saldo total pendiente">{displayMoney(item.total_balance)}</DetailValue>
          <DetailValue label="Saldo de facturas elegibles para cobranza">{displayMoney(item.eligible_balance)}</DetailValue>
          <DetailValue label="Etapa principal"><StageBadge stage={item.stage} catalog={catalog} label={item.stage_label} /></DetailValue>
          <DetailValue label="Prioridad">{item.priority}</DetailValue><DetailValue label="Motivo">{item.reason}</DetailValue>
          <DetailValue label="Promesa pendiente">{item.current_promise ? `${formatDate(item.current_promise.promised_date)} · ${displayMoney(item.current_promise.promised_amount)}` : "Sin promesa pendiente"}</DetailValue>
        </div>
        <h3>Factura principal</h3>
        {primary ? <div className="cobranza-detail-grid"><DetailValue label="Número">{primary.invoice_number}</DetailValue><DetailValue label="Saldo">{displayMoney(primary.balance)}</DetailValue><DetailValue label="Vencimiento">{formatDate(primary.due_date)}</DetailValue><DetailValue label="Etapa"><StageBadge stage={item.main_invoice.stage} catalog={catalog} label={item.main_invoice.stage_label} /></DetailValue></div> : <p>El motor no indicó una factura principal.</p>}
        <h3 id="cobranza-facturas">Facturas</h3>
        <p className="cobranza-note">Las etapas y motivos corresponden a la fecha de referencia. «—» indica un dato no informado.</p>
        <div className="cartera-table-wrap"><table className="cartera-table cobranza-table"><thead><tr><th>Número</th><th>Emisión</th><th>Vencimiento</th><th>Valor</th><th>Saldo</th><th>Días desde emisión</th><th>Días para vencimiento</th><th>Etapa</th><th>Motivo</th><th>Prioridad</th><th>Elegible para cobranza</th><th>Candidatos de etapa</th><th>Beneficios</th></tr></thead>
          <tbody>{item.invoices.map((row, index) => <tr key={row.invoice?.invoice_id ?? row.invoice?.id ?? index}><td data-label="Número"><strong>{row.invoice?.invoice_number || "—"}</strong></td><td data-label="Emisión">{formatDate(row.invoice?.issue_date)}</td><td data-label="Vencimiento">{formatDate(row.invoice?.due_date)}</td><td data-label="Valor">{displayMoney(row.invoice?.document_value)}</td><td data-label="Saldo">{displayMoney(row.invoice?.balance)}</td><td data-label="Días desde emisión">{row.days_since_issue ?? "—"}</td><td data-label="Días para vencimiento">{row.days_until_due ?? "—"}</td><td data-label="Etapa"><StageBadge stage={row.stage} catalog={catalog} label={row.stage_label} /></td><td data-label="Motivo">{row.reason || "—"}</td><td data-label="Prioridad">{row.priority ?? "—"}</td><td data-label="Elegible para cobranza">{row.eligible === true ? "Sí" : row.eligible === false ? "No" : "—"}</td><td data-label="Candidatos de etapa"><StageCandidates candidates={row.stage_candidates} /></td><td data-label="Beneficios"><CollectionBenefits row={row} /></td></tr>)}</tbody>
        </table></div>
        <CollectionOperations key={item.customer.id} customerId={item.customer.id} invoices={item.invoices} />
        {canViewHistory && <CustomerHistory key={`history-${item.customer.id}-`} customerId={item.customer.id} />}
        <CollectionMessages key={`${item.customer.id}-${referenceDate}-`} customer={item.customer} referenceDate={referenceDate} autoOpen={messageFirst} />
      </div><footer className="cartera-modal-footer"><button className="cartera-button-secondary" onClick={onClose}>Cerrar</button></footer>
    </section>
  </div>;
}

function CollectionView() {
  const { permissions = [] } = useAuth();
  const canManage = permissions.includes("collection.manage");
  const canViewHistory = permissions.includes("history.view");
  const [referenceDate, setReferenceDate] = useState(localDateValue);
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("");
  const [reload, setReload] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [messageFirst, setMessageFirst] = useState(false);
  const [request, setRequest] = useState({ loading: true, data: null, error: "" });
  useEffect(() => {
    if (!referenceDate) return;
    const controller = new AbortController();
    getCollection(referenceDate, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setRequest({ loading: false, data, error: "" });
    }).catch(error => {
      if (!controller.signal.aborted) setRequest({ loading: false, data: null, error: error.message, status: error.status });
    });
    return () => controller.abort();
  }, [referenceDate, reload]);

  const data = request.data;
  const customers = data?.customers || [];

  const catalog = getStageCatalog(data);
  const stages = catalog;
  const filtered = customers.filter(item => (!stage || item.stage === stage) && matchesSearch(item, query));
  const pendingCustomers = data?.non_overdue_pending?.customers || [];
  const pendingVisible = pendingCustomers.filter(item => !stage && matchesSearch(item, query));
  const selected = [...customers, ...pendingCustomers].find(item => String(item.customer.id) === selectedId);
  const showCollection = Boolean(referenceDate) && !request.loading && !request.error && data && data.rules_configured !== false && data.status !== "no_rules_configured";
  const showMissingRules = Boolean(referenceDate) && !request.loading && !request.error && data && (data.rules_configured === false || data.status === "no_rules_configured");
  // Stable handler keeps the dialog's focus lifecycle independent of filtering.
  const closeDetail = useCallback(() => setSelectedId(null), []);
  function openDetail(item, whatsapp = false) { setMessageFirst(whatsapp); setSelectedId(String(item.customer.id)); }
  function refresh() { setRequest({ loading: true, data: null, error: "" }); setReload(value => value + 1); }
  return <section className="cartera-page cobranza-page">
    <header className="cartera-header"><div><h1>Cobranza</h1><p>Panel operativo de MERTEL: clientes, facturas, gestiones y preparación de mensajes.</p></div><div className="cobranza-header-controls"><label className="cartera-reference"><CalendarDays size={17} /><span>Fecha de referencia</span><input aria-label="Fecha de referencia" type="date" required value={referenceDate} onChange={event => { setReferenceDate(event.target.value); setRequest({ loading: true, data: null, error: "" }); }} /></label></div></header>
    {!referenceDate && <State title="Selecciona una fecha de referencia válida." />}
    {referenceDate && request.loading && <State title="Cargando cobranza…" loading />}
    {referenceDate && !request.loading && request.error && <div className="cartera-panel"><div className="cartera-alert" role="alert"><AlertCircle size={18} />{request.error}</div>{request.status !== 403 && <div className="cartera-state"><button className="cartera-reset" onClick={refresh}><RefreshCw size={16} />Reintentar</button></div>}</div>}
    {showMissingRules && <div className="cartera-state" role="status"><FileText size={27} /><strong>MERTEL no tiene reglas de cobranza configuradas.</strong><span>La clasificación requiere reglas configuradas en el servidor.</span><button className="cartera-reset" onClick={refresh}>Volver a consultar</button></div>}
    {showCollection && <div className="cobranza-results">
      {data?.configuration_warnings?.map((warning, index) => <div className="cartera-alert" role="status" key={index}>{warning}</div>)}
      <section className="cartera-summary-grid" aria-label="Resumen de cobranza">{stages.map(item => <article key={item.key} className={`cartera-summary-card cartera-summary-${item.category === "overdue" ? "overdue" : item.category === "prompt_payment" ? "current" : "nodue"}`}><div className="cartera-summary-icon"><Users size={19} /></div><div><span>{stageLabel(item.key, catalog)}</span><strong>{data?.summary?.stages[item.key]?.customers ?? 0} clientes</strong></div></article>)}</section>
      <section className="cartera-panel"><div className="cartera-panel-heading"><div><h2>Clientes en cobranza</h2><p>Los contadores incluyen todos los clientes de la fecha, antes de búsqueda y filtros.</p></div><span className="cartera-count">{filtered.length} de {customers.length} clientes</span></div>
        <div className="cartera-filters"><label><span>Buscar cliente / NIT / factura</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nombre, NIT o número de factura" /></label><label><span>Etapa</span><select value={stage} onChange={event => setStage(event.target.value)}><option value="">Todas</option>{stages.map(item => <option key={item.key} value={item.key}>{stageLabel(item.key, catalog)}</option>)}</select></label><button className="cartera-reset" onClick={() => { setQuery(""); setStage(""); }}>Limpiar filtros</button><button className="cartera-reset" onClick={refresh}><RefreshCw size={15} />Actualizar</button></div>
        {!customers.length ? <State title="No hay clientes en cobranza para la fecha seleccionada." /> : !filtered.length ? <State title="No hay clientes que coincidan con la búsqueda o los filtros." /> : <div className="cobranza-client-grid">{filtered.map(item => <CustomerCard key={item.customer.id} item={item} catalog={catalog} canManage={canManage} onDetail={() => openDetail(item)} onMessage={() => openDetail(item, true)} />)}</div>}
      </section>
      {data?.non_overdue_pending && !stage && <section className="cartera-panel" aria-label="Facturas no vencidas">
        <div className="cartera-panel-heading"><div><h2>{data.non_overdue_pending.label}</h2><p>Facturas con saldo pendiente fuera de las etapas activas. Los beneficios se evalúan en el servidor.</p></div><span className="cartera-count">{data.non_overdue_pending.total_invoices} facturas · {formatCurrency(data.non_overdue_pending.total_balance)}</span></div>
        <p className="cobranza-note cobranza-panel-note">Las facturas no vencidas de clientes ya clasificados se consultan en su tarjeta principal.</p>
        {!pendingVisible.length ? <State title="No hay clientes con facturas no vencidas fuera de las etapas activas." /> : <div className="cobranza-client-grid">{pendingVisible.map(item => <CustomerCard key={item.customer.id} item={item} catalog={catalog} canManage={canManage} pending onDetail={() => openDetail(item)} onMessage={() => openDetail(item, true)} />)}</div>}
      </section>}
      {selected && <CustomerDetail item={selected} catalog={catalog} referenceDate={data.reference_date} onClose={closeDetail} messageFirst={messageFirst} canViewHistory={canViewHistory} />}
    </div>}
  </section>;
}

export default function Cobranza() {
  const { user, permissions = [] } = useAuth();
  if (!user || !permissions.includes("collection.view")) return <section className="cartera-page"><h1>Cobranza</h1><div className="cartera-alert" role="alert">No tienes permiso para consultar cobranza.</div></section>;
  return <CollectionView />;
}
