import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CalendarDays, FileText, LoaderCircle, RefreshCw, Users, X } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { getCollection } from "../../services/collection.service";
import { formatCurrency, formatDate } from "../../utils/format";
import { getStageCatalog, localDateValue, matchesSearch, stageLabel } from "./collection.presentation";
import "../Cartera/Cartera.css";
import "./Cobranza.css";
import CollectionOperations from "./CollectionOperations";

function StageBadge({ stage, catalog = [], label }) {
  const category = catalog.find(item => item.key === stage)?.category;
  const tone = category === "prompt_payment" ? "current" : category === "overdue" ? "overdue" : category ? "nodue" : "total";
  return <span className={`cartera-status cartera-status-${tone === "current" ? "current" : tone === "overdue" ? "overdue" : tone === "nodue" ? "due_today" : "unknown"}`}>{stageLabel(stage, catalog, label)}</span>;
}

function State({ title, loading = false, children }) {
  return <div className="cartera-state" role="status">{loading ? <LoaderCircle className="cartera-spin" size={23} /> : <FileText size={27} />}<strong>{title}</strong>{children}</div>;
}

function DetailValue({ label, children }) {
  return <div className="cobranza-detail-value"><span>{label}</span><strong>{children ?? "—"}</strong></div>;
}

function StageCandidates({ candidates }) {
  if (!Array.isArray(candidates)) return "—";
  if (!candidates.length) return "Sin candidatos";
  return <ul className="cobranza-candidates">{candidates.map((candidate, index) => <li key={index}><strong>{candidate.stage ?? "—"}</strong><span>Prioridad: {candidate.priority ?? "—"}</span>{candidate.reason && <span>{candidate.reason}</span>}</li>)}</ul>;
}

function CustomerDetail({ item, catalog, referenceDate, onClose }) {
  const dialog = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const node = dialog.current;
    node.querySelector("button")?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function keydown(event) {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const controls = node.querySelectorAll("button, a[href], input, select, textarea, summary, [tabindex='0']");
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    node.addEventListener("keydown", keydown);
    return () => { node.removeEventListener("keydown", keydown); document.body.style.overflow = overflow; previous?.focus(); };
  }, [onClose]);
  const primary = item.main_invoice?.invoice;
  return <div className="cartera-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} className="cartera-modal cobranza-modal" role="dialog" aria-modal="true" aria-labelledby="cobranza-detail-title">
      <header className="cartera-modal-header"><div><h2 id="cobranza-detail-title">Cobranza de {item.customer.name || "Cliente"}</h2><p>Referencia {formatDate(referenceDate)}</p></div><button className="cartera-close" aria-label="Cerrar detalle" onClick={onClose}><X size={19} /></button></header>
      <div className="cartera-modal-body">
        <div className="cobranza-detail-grid">
          <DetailValue label="NIT">{item.customer.nit}</DetailValue><DetailValue label="Teléfono">{item.customer.phone}</DetailValue>
          <DetailValue label="Saldo total pendiente">{formatCurrency(item.total_balance)}</DetailValue>
          <DetailValue label="Saldo de facturas elegibles para cobranza">{formatCurrency(item.eligible_balance)}</DetailValue>
          <DetailValue label="Etapa principal"><StageBadge stage={item.stage} catalog={catalog} label={item.stage_label} /></DetailValue>
          <DetailValue label="Prioridad">{item.priority}</DetailValue><DetailValue label="Motivo">{item.reason}</DetailValue>
        </div>
        <h3>Factura principal</h3>
        {primary ? <div className="cobranza-detail-grid"><DetailValue label="Número">{primary.invoice_number}</DetailValue><DetailValue label="Saldo">{formatCurrency(primary.balance)}</DetailValue><DetailValue label="Vencimiento">{formatDate(primary.due_date)}</DetailValue><DetailValue label="Etapa"><StageBadge stage={item.main_invoice.stage} catalog={catalog} label={item.main_invoice.stage_label} /></DetailValue></div> : <p>El motor no indicó una factura principal.</p>}
        <h3>Facturas</h3>
        <p className="cobranza-note">Las etapas y motivos corresponden a la fecha de referencia. «—» indica un dato no informado.</p>
        <div className="cartera-table-wrap"><table className="cartera-table cobranza-table"><thead><tr><th>Número</th><th>Emisión</th><th>Vencimiento</th><th>Valor</th><th>Saldo</th><th>Etapa</th><th>Motivo</th><th>Prioridad</th><th>Elegible para cobranza</th><th>Candidatos de etapa</th><th>Pronto Pago</th></tr></thead>
          <tbody>{item.invoices.map((row, index) => <tr key={row.invoice?.invoice_id ?? row.invoice?.id ?? index}><td data-label="Número"><strong>{row.invoice?.invoice_number || "—"}</strong></td><td data-label="Emisión">{formatDate(row.invoice?.issue_date)}</td><td data-label="Vencimiento">{formatDate(row.invoice?.due_date)}</td><td data-label="Valor">{formatCurrency(row.invoice?.document_value)}</td><td data-label="Saldo">{formatCurrency(row.invoice?.balance)}</td><td data-label="Etapa"><StageBadge stage={row.stage} catalog={catalog} label={row.stage_label} /></td><td data-label="Motivo">{row.reason || "—"}</td><td data-label="Prioridad">{row.priority ?? "—"}</td><td data-label="Elegible para cobranza">{row.eligible === true ? "Sí" : row.eligible === false ? "No" : "—"}</td><td data-label="Candidatos de etapa"><StageCandidates candidates={row.stage_candidates} /></td><td data-label="Pronto Pago">{row.prompt_payment ? <details><summary>Ver evaluación</summary><p>{row.prompt_payment.window.reason}</p><p>{row.prompt_payment.eligibility.reason}</p><p>{row.prompt_payment.percentage}% sobre base antes de IVA.</p><p>{row.prompt_payment.discount.reason}</p></details> : "—"}</td></tr>)}</tbody>
        </table></div>
        <CollectionOperations key={item.customer.id} customerId={item.customer.id} invoices={item.invoices} />
      </div><footer className="cartera-modal-footer"><button className="cartera-button-secondary" onClick={onClose}>Cerrar</button></footer>
    </section>
  </div>;
}

function CollectionView() {
  const [referenceDate, setReferenceDate] = useState(localDateValue);
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("");
  const [reload, setReload] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
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
  const selected = customers.find(item => String(item.customer.id) === selectedId);
  // Stable handler keeps the dialog's focus lifecycle independent of filtering.
  const closeDetail = useCallback(() => setSelectedId(null), []);
  function refresh() { setRequest({ loading: true, data: null, error: "" }); setReload(value => value + 1); }
  return <section className="cartera-page cobranza-page">
    <header className="cartera-header"><div><h1>Cobranza</h1><p>Consulta de clientes y facturas de MERTEL por etapa de cobranza.</p></div><label className="cartera-reference"><CalendarDays size={17} /><span>Fecha de referencia</span><input aria-label="Fecha de referencia" type="date" required value={referenceDate} onChange={event => { setReferenceDate(event.target.value); setRequest({ loading: true, data: null, error: "" }); }} /></label></header>
    {!referenceDate ? <State title="Selecciona una fecha de referencia válida." /> : request.loading ? <State title="Cargando cobranza…" loading /> : request.error ? <div className="cartera-panel"><div className="cartera-alert" role="alert"><AlertCircle size={18} />{request.error}</div>{request.status !== 403 && <div className="cartera-state"><button className="cartera-reset" onClick={refresh}><RefreshCw size={16} />Reintentar</button></div>}</div> : (data?.rules_configured === false || data?.status === "no_rules_configured") ? <State title="MERTEL no tiene reglas de cobranza configuradas."><span>La clasificación requiere reglas configuradas en el servidor.</span><button className="cartera-reset" onClick={refresh}>Volver a consultar</button></State> : <>
      {data?.configuration_warnings?.map((warning, index) => <div className="cartera-alert" role="status" key={index}>{warning}</div>)}
      <section className="cartera-summary-grid" aria-label="Resumen de cobranza">{stages.map(item => <article key={item.key} className={`cartera-summary-card cartera-summary-${item.category === "overdue" ? "overdue" : item.category === "prompt_payment" ? "current" : "nodue"}`}><div className="cartera-summary-icon"><Users size={19} /></div><div><span>{stageLabel(item.key, catalog)}</span><strong>{data?.summary?.stages[item.key]?.customers ?? 0} clientes</strong></div></article>)}</section>
      <section className="cartera-panel"><div className="cartera-panel-heading"><div><h2>Clientes en cobranza</h2><p>Los contadores incluyen todos los clientes de la fecha, antes de búsqueda y filtros.</p></div><span className="cartera-count">{filtered.length} de {customers.length} clientes</span></div>
        <div className="cartera-filters"><label><span>Buscar cliente / NIT / factura</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nombre, NIT o número de factura" /></label><label><span>Etapa</span><select value={stage} onChange={event => setStage(event.target.value)}><option value="">Todas</option>{stages.map(item => <option key={item.key} value={item.key}>{stageLabel(item.key, catalog)}</option>)}</select></label><button className="cartera-reset" onClick={() => { setQuery(""); setStage(""); }}>Limpiar filtros</button><button className="cartera-reset" onClick={refresh}><RefreshCw size={15} />Actualizar</button></div>
        {!customers.length ? <State title="No hay clientes en cobranza para la fecha seleccionada." /> : !filtered.length ? <State title="No hay clientes que coincidan con la búsqueda o los filtros." /> : <div className="cartera-table-wrap"><table className="cartera-table cobranza-table"><thead><tr><th>Cliente</th><th>NIT</th><th>Etapa</th><th>Saldo total pendiente</th><th>Factura principal</th><th>Vencimiento</th><th>Facturas</th><th>Acciones</th></tr></thead><tbody>{filtered.map(item => <tr key={item.customer.id}><td data-label="Cliente"><strong>{item.customer.name || "—"}</strong></td><td data-label="NIT">{item.customer.nit || "—"}</td><td data-label="Etapa"><StageBadge stage={item.stage} catalog={catalog} label={item.stage_label} /></td><td data-label="Saldo total pendiente">{formatCurrency(item.total_balance)}</td><td data-label="Factura principal">{item.main_invoice?.invoice?.invoice_number || "—"}</td><td data-label="Vencimiento">{formatDate(item.main_invoice?.invoice?.due_date)}</td><td data-label="Facturas">{item.invoices.length}</td><td data-label="Acciones"><button className="cartera-link-button" aria-label={`Ver detalle de ${item.customer.name || "cliente"}`} onClick={() => setSelectedId(String(item.customer.id))}>Ver detalle</button></td></tr>)}</tbody></table></div>}
      </section>
      {selected && <CustomerDetail item={selected} catalog={catalog} referenceDate={data.reference_date} onClose={closeDetail} />}
    </>}
  </section>;
}

export default function Cobranza() {
  const { user, permissions = [] } = useAuth();
  if (!user || !permissions.includes("collection.view")) return <section className="cartera-page"><h1>Cobranza</h1><div className="cartera-alert" role="alert">No tienes permiso para consultar cobranza.</div></section>;
  return <CollectionView />;
}
