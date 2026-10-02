import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CalendarDays, ChevronRight, CircleDollarSign, Clock3, FileText, LoaderCircle, RefreshCw, SearchCheck, Users, WalletCards, X } from "lucide-react";
import { getCustomers } from "../../services/customer.service";
import {
  getPortfolio,
  getPortfolioCustomer,
  getPortfolioCustomers,
  getPortfolioReconciliation,
  getPortfolioSummary,
} from "../../services/portfolio.service";
import { formatCurrency, formatDate } from "../../utils/format";
import "./Cartera.css";

function localDateValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function unwrap(result) { return result?.data ?? result; }

function safeError(error, fallback) {
  console.error("Error consultando cartera:", error);
  const status = error?.response?.status;
  if (!error?.response) return "No fue posible conectar con el servidor. Verifica que la API esté disponible.";
  if (status === 400) return error.response.data?.message || "Revisa la fecha o los filtros seleccionados.";
  if (status === 404) return "No se encontró el cliente seleccionado.";
  return fallback;
}

function StatusBadge({ status }) {
  const labels = { current: "Corriente", due_today: "Vence hoy", overdue: "Vencida", no_due_date: "Sin vencimiento" };
  return <span className={`cartera-status cartera-status-${status || "unknown"}`}>{labels[status] || status || "—"}</span>;
}

function SummaryCard({ label, value, icon: Icon, tone }) {
  return <article className={`cartera-summary-card cartera-summary-${tone}`}><div className="cartera-summary-icon"><Icon size={19} /></div><div><span>{label}</span><strong>{formatCurrency(value)}</strong></div></article>;
}

function LoadingState({ label }) {
  return <div className="cartera-state"><LoaderCircle className="cartera-spin" size={23} /><span>{label}</span></div>;
}

function EmptyState({ title, detail }) {
  return <div className="cartera-state cartera-empty"><FileText size={27} /><strong>{title}</strong>{detail && <span>{detail}</span>}</div>;
}

function InvoiceTable({ invoices, emptyTitle = "No hay facturas pendientes de cartera." }) {
  if (!invoices.length) return <EmptyState title={emptyTitle} />;
  return <div className="cartera-table-wrap"><table className="cartera-table"><thead><tr><th>Cliente</th><th>NIT</th><th>Factura</th><th>Emisión</th><th>Vencimiento</th><th>Valor factura</th><th>Saldo</th><th>Días vencidos</th><th>Estado cartera</th><th>Estado factura</th></tr></thead><tbody>{invoices.map((invoice) => <tr key={invoice.invoice_id}><td>{invoice.customer_name || "—"}</td><td>{invoice.customer_nit || "—"}</td><td><strong>{invoice.invoice_number || "—"}</strong></td><td>{formatDate(invoice.issue_date)}</td><td>{formatDate(invoice.due_date)}</td><td>{formatCurrency(invoice.document_value)}</td><td><strong>{formatCurrency(invoice.balance)}</strong></td><td>{invoice.days_overdue ?? "—"}</td><td><StatusBadge status={invoice.portfolio_status} /></td><td><span className="cartera-invoice-status">{invoice.invoice_status || "—"}</span></td></tr>)}</tbody></table></div>;
}

export default function Cartera() {
  const [referenceDate, setReferenceDate] = useState(() => localDateValue());
  const [summary, setSummary] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [customerOptions, setCustomerOptions] = useState([]);
  const [reconciliation, setReconciliation] = useState([]);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [invoicesLoading, setInvoicesLoading] = useState(true);
  const [customersLoading, setCustomersLoading] = useState(true);
  const [reconciliationLoading, setReconciliationLoading] = useState(false);
  const [reconciliationReload, setReconciliationReload] = useState(0);
  const [customerOptionsLoading, setCustomerOptionsLoading] = useState(true);
  const [errors, setErrors] = useState({});
  const [section, setSection] = useState("invoices");
  const [customerFilter, setCustomerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");
  const [customerSelection, setCustomerSelection] = useState(null);
  const [customerDetail, setCustomerDetail] = useState(null);
  const [customerDetailLoading, setCustomerDetailLoading] = useState(false);
  const [customerDetailError, setCustomerDetailError] = useState("");
  const requestSequence = useRef(0);

  const queryParams = useMemo(() => ({
    reference_date: referenceDate,
    ...(customerFilter ? { customer_id: customerFilter } : {}),
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(overdueOnly ? { overdue: true } : {}),
    ...(dueFrom ? { due_from: dueFrom } : {}),
    ...(dueTo ? { due_to: dueTo } : {}),
  }), [referenceDate, customerFilter, statusFilter, overdueOnly, dueFrom, dueTo]);

  useEffect(() => {
    let active = true;
    getCustomers().then((result) => {
      const data = unwrap(result);
      if (active) setCustomerOptions(Array.isArray(data) ? data.filter((customer) => customer.deleted_at == null && customer.status !== "inactive") : []);
    }).catch((error) => {
      if (active) setErrors((current) => ({ ...current, customerOptions: safeError(error, "No fue posible cargar la lista de clientes.") }));
    }).finally(() => { if (active) setCustomerOptionsLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const sequence = ++requestSequence.current;
    const params = { reference_date: referenceDate };
    getPortfolioSummary(params).then((result) => {
      if (sequence === requestSequence.current) { setSummary(unwrap(result)); setErrors((current) => ({ ...current, summary: "" })); }
    }).catch((error) => {
      if (sequence === requestSequence.current) setErrors((current) => ({ ...current, summary: safeError(error, "No fue posible cargar el resumen de cartera.") }));
    }).finally(() => { if (sequence === requestSequence.current) setSummaryLoading(false); });

    getPortfolio(queryParams).then((result) => {
      const data = unwrap(result);
      if (sequence === requestSequence.current) { setInvoices(Array.isArray(data) ? data : []); setErrors((current) => ({ ...current, invoices: "" })); }
    }).catch((error) => {
      if (sequence === requestSequence.current) setErrors((current) => ({ ...current, invoices: safeError(error, "No fue posible cargar la cartera.") }));
    }).finally(() => { if (sequence === requestSequence.current) setInvoicesLoading(false); });

    getPortfolioCustomers(params).then((result) => {
      const data = unwrap(result);
      if (sequence === requestSequence.current) { setCustomers(Array.isArray(data) ? data : []); setErrors((current) => ({ ...current, customers: "" })); }
    }).catch((error) => {
      if (sequence === requestSequence.current) setErrors((current) => ({ ...current, customers: safeError(error, "No fue posible cargar la cartera por cliente.") }));
    }).finally(() => { if (sequence === requestSequence.current) setCustomersLoading(false); });
  }, [referenceDate, queryParams]);

  useEffect(() => {
    if (section !== "reconciliation" || reconciliation.length || errors.reconciliation) return;
    let active = true;
    getPortfolioReconciliation().then((result) => {
      const data = unwrap(result);
      if (active) setReconciliation(Array.isArray(data) ? data : []);
    }).catch((error) => {
      if (active) setErrors((current) => ({ ...current, reconciliation: safeError(error, "No fue posible consultar la conciliación.") }));
    }).finally(() => { if (active) setReconciliationLoading(false); });
    return () => { active = false; };
  }, [section, reconciliation.length, errors.reconciliation, reconciliationReload]);

  async function openCustomerDetail(customer) {
    setCustomerSelection(customer);
    setCustomerDetail(null);
    setCustomerDetailError("");
    setCustomerDetailLoading(true);
    try {
      const result = unwrap(await getPortfolioCustomer(customer.customer_id, { reference_date: referenceDate }));
      setCustomerDetail(result);
    } catch (error) {
      setCustomerDetailError(safeError(error, "No fue posible cargar el detalle del cliente."));
    } finally {
      setCustomerDetailLoading(false);
    }
  }

  function markPortfolioLoading() {
    setInvoicesLoading(true);
  }

  function changeReferenceDate(event) {
    setSummaryLoading(true);
    setInvoicesLoading(true);
    setCustomersLoading(true);
    setReferenceDate(event.target.value);
  }

  const selectedCustomerName = customerSelection?.customer_name || customerSelection?.name || "Cliente";

  return <main className="cartera-page">
    <header className="cartera-header"><div><h1>Cartera</h1><p>Consulta y seguimiento de saldos pendientes de clientes.</p></div><label className="cartera-reference"><CalendarDays size={17} /><span>Fecha de referencia</span><input aria-label="Fecha de referencia" type="date" value={referenceDate} onChange={changeReferenceDate} /></label></header>

    {summaryLoading ? <div className="cartera-summary-grid"><div className="cartera-summary-loading"><LoaderCircle className="cartera-spin" size={20} />Cargando resumen…</div></div> : errors.summary ? <div className="cartera-alert" role="alert"><AlertCircle size={17} />{errors.summary}</div> : <section className="cartera-summary-grid" aria-label="Resumen de cartera"><SummaryCard label="Cartera total" value={summary?.total_balance} icon={WalletCards} tone="total" /><SummaryCard label="Cartera corriente" value={summary?.total_current_balance} icon={CircleDollarSign} tone="current" /><SummaryCard label="Cartera vencida" value={summary?.total_overdue_balance} icon={Clock3} tone="overdue" /><SummaryCard label="Sin vencimiento" value={summary?.total_no_due_date_balance} icon={CalendarDays} tone="nodue" /></section>}

    <nav className="cartera-tabs" aria-label="Secciones de cartera"><button className={section === "invoices" ? "active" : ""} onClick={() => setSection("invoices")}><FileText size={16} />Facturas pendientes</button><button className={section === "customers" ? "active" : ""} onClick={() => setSection("customers")}><Users size={16} />Cartera por cliente</button><button className={section === "reconciliation" ? "active" : ""} onClick={() => { if (section !== "reconciliation") setReconciliationLoading(true); setSection("reconciliation"); }}><SearchCheck size={16} />Conciliación</button></nav>

    {section === "invoices" && <section className="cartera-panel"><div className="cartera-panel-heading"><div><h2>Facturas pendientes</h2><p>Los saldos y estados se consultan desde el motor de cartera.</p></div><span className="cartera-count">{invoices.length} facturas</span></div>
      <div className="cartera-filters"><label><span>Cliente</span><select value={customerFilter} onChange={(event) => { markPortfolioLoading(); setCustomerFilter(event.target.value); }} disabled={customerOptionsLoading}><option value="">Todos los clientes</option>{customerOptions.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.nit ? ` — ${customer.nit}` : ""}</option>)}</select></label><label><span>Estado de cartera</span><select value={statusFilter} onChange={(event) => { markPortfolioLoading(); setStatusFilter(event.target.value); }}><option value="">Todos los estados</option><option value="current">Corriente</option><option value="due_today">Vence hoy</option><option value="overdue">Vencida</option><option value="no_due_date">Sin vencimiento</option></select></label><label><span>Vencimiento desde</span><input type="date" value={dueFrom} onChange={(event) => { markPortfolioLoading(); setDueFrom(event.target.value); }} /></label><label><span>Vencimiento hasta</span><input type="date" value={dueTo} onChange={(event) => { markPortfolioLoading(); setDueTo(event.target.value); }} /></label><label className="cartera-overdue-filter"><input type="checkbox" checked={overdueOnly} onChange={(event) => { markPortfolioLoading(); setOverdueOnly(event.target.checked); }} /><span>Solo vencidas</span></label><button className="cartera-reset" onClick={() => { markPortfolioLoading(); setCustomerFilter(""); setStatusFilter(""); setOverdueOnly(false); setDueFrom(""); setDueTo(""); }}><RefreshCw size={15} /> Limpiar filtros</button></div>
      {errors.customerOptions && <div className="cartera-alert" role="alert"><AlertCircle size={17} />{errors.customerOptions}</div>}
      {errors.invoices && <div className="cartera-alert" role="alert"><AlertCircle size={17} />{errors.invoices}</div>}
      {invoicesLoading ? <LoadingState label="Cargando facturas de cartera…" /> : errors.invoices ? null : <InvoiceTable invoices={invoices} />}
    </section>}

    {section === "customers" && <section className="cartera-panel"><div className="cartera-panel-heading"><div><h2>Cartera por cliente</h2><p>Resumen de saldos pendientes agrupados por cliente.</p></div>{customersLoading ? <span className="cartera-count">Cargando…</span> : <span className="cartera-count">{customers.length} clientes</span>}</div>{errors.customers && <div className="cartera-alert" role="alert"><AlertCircle size={17} />{errors.customers}</div>}{customersLoading ? <LoadingState label="Cargando cartera por cliente…" /> : errors.customers ? null : customers.length === 0 ? <EmptyState title="No hay clientes con cartera pendiente." /> : <div className="cartera-table-wrap"><table className="cartera-table"><thead><tr><th>Cliente</th><th>NIT</th><th>Cartera total</th><th>Cartera vencida</th><th>Cartera corriente</th><th>Sin vencimiento</th><th>Facturas</th><th>Detalle</th></tr></thead><tbody>{customers.map((customer) => <tr key={customer.customer_id}><td><strong>{customer.customer_name}</strong></td><td>{customer.customer_nit || "—"}</td><td><strong>{formatCurrency(customer.total_balance)}</strong></td><td>{formatCurrency(customer.total_overdue_balance)}</td><td>{formatCurrency(customer.total_current_balance)}</td><td>{formatCurrency(customer.total_no_due_date_balance)}</td><td>{customer.open_invoice_count ?? "—"}</td><td><button className="cartera-link-button" onClick={() => openCustomerDetail(customer)}>Ver facturas <ChevronRight size={15} /></button></td></tr>)}</tbody></table></div>}</section>}

    {section === "reconciliation" && <section className="cartera-panel"><div className="cartera-panel-heading"><div><h2>Conciliación de saldos</h2><p>Consulta diferencias entre el saldo almacenado y el esperado según asignaciones activas. Esta vista no corrige datos.</p></div><button className="cartera-reset" onClick={() => { setReconciliationLoading(true); setErrors((current) => ({ ...current, reconciliation: "" })); setReconciliation([]); setReconciliationReload((current) => current + 1); }}><RefreshCw size={15} /> Actualizar</button></div>{errors.reconciliation && <div className="cartera-alert" role="alert"><AlertCircle size={17} />{errors.reconciliation}</div>}{reconciliationLoading ? <LoadingState label="Consultando conciliación…" /> : errors.reconciliation ? null : reconciliation.length === 0 ? <EmptyState title="No se encontraron diferencias." /> : <div className="cartera-table-wrap"><table className="cartera-table"><thead><tr><th>Cliente</th><th>Factura</th><th>Valor documento</th><th>Saldo almacenado</th><th>Asignado activo</th><th>Saldo esperado</th><th>Diferencia</th></tr></thead><tbody>{reconciliation.map((row) => <tr key={row.invoice_id}><td>{row.customer_name || "—"}</td><td><strong>{row.invoice_number}</strong></td><td>{formatCurrency(row.document_value)}</td><td>{formatCurrency(row.stored_balance)}</td><td>{formatCurrency(row.active_allocated)}</td><td>{formatCurrency(row.expected_balance)}</td><td className="cartera-difference">{formatCurrency(row.difference)}</td></tr>)}</tbody></table></div>}</section>}

    {customerSelection && <div className="cartera-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !customerDetailLoading) { setCustomerSelection(null); setCustomerDetail(null); } }}><section className="cartera-modal" role="dialog" aria-modal="true" aria-labelledby="cartera-detail-title"><header className="cartera-modal-header"><div><h2 id="cartera-detail-title">Cartera de {selectedCustomerName}</h2><p>{customerSelection.customer_nit || customerSelection.nit || ""} · Referencia {formatDate(referenceDate)}</p></div><button className="cartera-close" aria-label="Cerrar detalle" onClick={() => { setCustomerSelection(null); setCustomerDetail(null); }}><X size={19} /></button></header><div className="cartera-modal-body">{customerDetailLoading ? <LoadingState label="Cargando detalle del cliente…" /> : customerDetailError ? <div className="cartera-alert" role="alert"><AlertCircle size={17} />{customerDetailError}</div> : customerDetail && <><div className="cartera-customer-summary"><SummaryCard label="Saldo pendiente" value={customerDetail.totals?.total_balance} icon={WalletCards} tone="total" /><SummaryCard label="Saldo vencido" value={customerDetail.totals?.total_overdue_balance} icon={Clock3} tone="overdue" /></div><div className="cartera-panel-heading cartera-detail-heading"><div><h3>Facturas pendientes</h3></div></div><InvoiceTable invoices={customerDetail.invoices || []} emptyTitle="Este cliente no tiene facturas pendientes." /> </>}</div><footer className="cartera-modal-footer"><button className="cartera-button-secondary" onClick={() => { setCustomerSelection(null); setCustomerDetail(null); }}>Cerrar</button></footer></section></div>}
  </main>;
}
