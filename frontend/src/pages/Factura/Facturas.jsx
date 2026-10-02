import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, FileText, LoaderCircle, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { getCustomers } from "../../services/customer.service";
import { createInvoice, deleteInvoice, getInvoiceById, getInvoices, updateInvoice } from "../../services/invoice.service";
import "./Facturas.css";

const blankInvoice = { customer_id: "", invoice_number: "", issue_date: "", due_date: "", document_value: "", base_value: "", iva_value: "", balance: "0", credit_days: "", status: "pending", promo_18: "", discount: "", email: "", notes: "" };
const unwrap = (result) => result?.data ?? result;
const currency = (value) => value === null || value === undefined || value === "" ? "—" : Number.isFinite(Number(value)) ? new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 2 }).format(Number(value)) : "—";
function formatDate(value) {
  if (!value) return "—";
  const text = String(value).slice(0, 10);
  const parsed = new Date(`${text}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? text : new Intl.DateTimeFormat("es-CO").format(parsed);
}
function errorMessage(error) {
  const status = error?.response?.status;
  if (!error?.response) return "No fue posible conectar con el servidor. Verifica que la API esté disponible.";
  if (status === 400) return error.response.data?.message || "Revisa los datos ingresados.";
  if (status === 404) return error.response.data?.message || "No se encontró la factura o el cliente seleccionado.";
  return error.response.data?.message || "Ocurrió un error al procesar la solicitud.";
}
function Field({ label, name, value, onChange, type = "text", required = false, min, step, full = false, children }) {
  return <div className={`factura-field${full ? " factura-field-full" : ""}`}><label htmlFor={name}>{label}{required && <span className="factura-required"> *</span>}</label>{children || <input id={name} name={name} type={type} value={value ?? ""} onChange={onChange} required={required} min={min} step={step} />}</div>;
}
function Detail({ label, value, full = false }) {
  return <div className={`factura-detail${full ? " factura-detail-full" : ""}`}><span>{label}</span><strong>{value || "—"}</strong></div>;
}

export default function Facturas() {
  const [invoices, setInvoices] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(blankInvoice);
  const [saving, setSaving] = useState(false);
  const [customersError, setCustomersError] = useState("");

  const loadInvoices = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const result = unwrap(await getInvoices());
      setInvoices(Array.isArray(result) ? result : []);
    } catch (requestError) { setError(errorMessage(requestError)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    let active = true;
    getInvoices().then((result) => {
      if (active) setInvoices(Array.isArray(unwrap(result)) ? unwrap(result) : []);
    }).catch((requestError) => {
      if (active) setError(errorMessage(requestError));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const statuses = useMemo(() => [...new Set(invoices.map((invoice) => invoice.status).filter(Boolean))].sort(), [invoices]);
  const filteredInvoices = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("es");
    return invoices.filter((invoice) => {
      const matches = !term || [invoice.invoice_number, invoice.customer_name, invoice.customer_nit].some((value) => String(value ?? "").toLocaleLowerCase("es").includes(term));
      return matches && (!statusFilter || invoice.status === statusFilter);
    });
  }, [invoices, query, statusFilter]);
  const activeCustomers = customers.filter((customer) => customer.deleted_at == null && customer.status !== "inactive");

  async function openCreate() {
    setError(""); setCustomersError(""); setForm(blankInvoice); setModal({ type: "form", editing: false });
    try {
      const result = unwrap(await getCustomers());
      setCustomers(Array.isArray(result) ? result : []);
    } catch (requestError) { setCustomersError(errorMessage(requestError)); }
  }
  async function openEdit(invoice) {
    setError(""); setCustomersError(""); setSaving(true);
    try {
      const [result, customerResult] = await Promise.all([getInvoiceById(invoice.id), getCustomers()]);
      const current = unwrap(result);
      const list = unwrap(customerResult);
      setCustomers(Array.isArray(list) ? list : []);
      setForm({ ...blankInvoice, ...current, customer_id: String(current.customer_id ?? ""), issue_date: String(current.issue_date ?? "").slice(0, 10), due_date: String(current.due_date ?? "").slice(0, 10), document_value: current.document_value ?? "", base_value: current.base_value ?? "", iva_value: current.iva_value ?? "", balance: current.balance ?? "0", credit_days: current.credit_days ?? "", promo_18: current.promo_18 ?? "", discount: current.discount ?? "" });
      setModal({ type: "form", editing: true, id: invoice.id });
    } catch (requestError) { setError(errorMessage(requestError)); }
    finally { setSaving(false); }
  }
  async function openDetail(invoice) {
    setSaving(true); setError("");
    try { setModal({ type: "detail", invoice: unwrap(await getInvoiceById(invoice.id)) }); }
    catch (requestError) { setError(errorMessage(requestError)); }
    finally { setSaving(false); }
  }
  function change(event) { setForm((current) => ({ ...current, [event.target.name]: event.target.value })); }
  async function submit(event) {
    event.preventDefault(); setError(""); setNotice("");
    if (!form.customer_id) { setError("Selecciona un cliente para continuar."); return; }
    for (const field of ["document_value", "base_value", "iva_value", "balance", "promo_18", "discount"]) {
      if (form[field] !== "" && (!/^\d{1,13}(\.\d{1,2})?$/.test(String(form[field])) || !Number.isFinite(Number(form[field])))) { setError("Ingresa valores monetarios válidos, con máximo dos decimales."); return; }
    }
    if (form.credit_days !== "" && (!/^\d+$/.test(String(form.credit_days)) || !Number.isSafeInteger(Number(form.credit_days)))) { setError("Los días de crédito deben ser un número entero igual o mayor que cero."); return; }
    const payload = { ...form, customer_id: Number(form.customer_id), document_value: Number(form.document_value), base_value: Number(form.base_value), iva_value: Number(form.iva_value), balance: form.balance === "" ? 0 : Number(form.balance), credit_days: form.credit_days === "" ? null : Number(form.credit_days), promo_18: form.promo_18 === "" ? null : Number(form.promo_18), discount: form.discount === "" ? null : Number(form.discount), issue_date: form.issue_date || null, due_date: form.due_date || null, email: form.email || null, notes: form.notes || null };
    setSaving(true);
    try {
      if (modal.editing) await updateInvoice(modal.id, payload); else await createInvoice(payload);
      setModal(null); setNotice(modal.editing ? "Factura actualizada correctamente." : "Factura creada correctamente."); await loadInvoices();
    } catch (requestError) { setError(errorMessage(requestError)); }
    finally { setSaving(false); }
  }
  async function remove(invoice) {
    if (!window.confirm(`¿Eliminar la factura ${invoice.invoice_number}?`)) return;
    setError(""); setNotice("");
    try { await deleteInvoice(invoice.id); setInvoices((current) => current.filter((item) => item.id !== invoice.id)); setNotice("Factura eliminada correctamente."); }
    catch (requestError) { setError(errorMessage(requestError)); }
  }

  const detail = modal?.type === "detail" ? modal.invoice : null;
  return <main className="facturas-page">
    <header className="facturas-header"><div><h1>Facturas</h1><p>Consulta y administra las facturas registradas.</p></div><button className="factura-primary" onClick={openCreate}><Plus size={17} /> Nueva factura</button></header>
    {notice && <div className="factura-alert factura-alert-success" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Cerrar"><X size={16} /></button></div>}
    {error && <div className="factura-alert factura-alert-error" role="alert">{error}<button onClick={() => setError("")} aria-label="Cerrar"><X size={16} /></button></div>}
    <section className="factura-card">
      <div className="factura-toolbar"><div className="factura-card-title"><FileText size={17} /> Facturas registradas <span>({filteredInvoices.length})</span></div><div className="factura-controls"><label className="factura-search"><Search size={16} /><input aria-label="Buscar factura" placeholder="Buscar número, cliente o NIT" value={query} onChange={(event) => setQuery(event.target.value)} /></label><select aria-label="Filtrar por estado" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">Todos los estados</option>{statuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></div></div>
      {loading ? <div className="factura-empty"><LoaderCircle className="factura-spin" size={25} /><p>Cargando facturas…</p></div> : error && invoices.length === 0 ? <div className="factura-empty"><p>No se pudo cargar el listado.</p><button className="factura-secondary" onClick={loadInvoices}>Reintentar</button></div> : filteredInvoices.length === 0 ? <div className="factura-empty"><FileText size={28} /><h3>{invoices.length ? "No hay resultados" : "No hay facturas registradas."}</h3><p>{invoices.length ? "Prueba con otra búsqueda o filtro." : "Cuando registres una factura, aparecerá en este listado."}</p></div> : <div className="factura-table-wrap"><table className="factura-table"><thead><tr><th>Número</th><th>Cliente</th><th>NIT</th><th>Emisión</th><th>Vencimiento</th><th>Valor</th><th>Saldo</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{filteredInvoices.map((invoice) => <tr key={invoice.id}><td><strong>{invoice.invoice_number}</strong></td><td>{invoice.customer_name || "—"}</td><td>{invoice.customer_nit || "—"}</td><td>{formatDate(invoice.issue_date)}</td><td>{formatDate(invoice.due_date)}</td><td>{currency(invoice.document_value)}</td><td>{currency(invoice.balance)}</td><td><span className="factura-status">{invoice.status || "—"}</span></td><td><div className="factura-actions"><button title="Ver detalle" aria-label={`Ver factura ${invoice.invoice_number}`} onClick={() => openDetail(invoice)}><Eye size={16} /></button><button title="Editar" aria-label={`Editar factura ${invoice.invoice_number}`} onClick={() => openEdit(invoice)}><Pencil size={16} /></button><button title="Eliminar" aria-label={`Eliminar factura ${invoice.invoice_number}`} onClick={() => remove(invoice)}><Trash2 size={16} /></button></div></td></tr>)}</tbody></table></div>}
    </section>
    {modal && <div className="factura-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setModal(null); }}><section className="factura-modal" role="dialog" aria-modal="true" aria-labelledby="factura-modal-title">
      <header className="factura-modal-header"><div><h2 id="factura-modal-title">{detail ? `Factura ${detail.invoice_number}` : modal.editing ? "Editar factura" : "Nueva factura"}</h2><p>{detail ? "Detalle de la factura." : "Completa la información de la factura."}</p></div><button className="factura-close" onClick={() => setModal(null)} aria-label="Cerrar"><X size={19} /></button></header>
      {detail ? <><div className="factura-modal-body"><div className="factura-detail-grid"><Detail label="Cliente" value={detail.customer_name} /><Detail label="NIT" value={detail.customer_nit} /><Detail label="Fecha de emisión" value={formatDate(detail.issue_date)} /><Detail label="Fecha de vencimiento" value={formatDate(detail.due_date)} /><Detail label="Valor del documento" value={currency(detail.document_value)} /><Detail label="Valor base" value={currency(detail.base_value)} /><Detail label="IVA" value={currency(detail.iva_value)} /><Detail label="Saldo" value={currency(detail.balance)} /><Detail label="Días de crédito" value={detail.credit_days} /><Detail label="Estado" value={detail.status} /><Detail label="Descuento" value={currency(detail.discount)} /><Detail label="PROMO 18" value={currency(detail.promo_18)} /><Detail label="Correo" value={detail.email} /><Detail label="Notas" value={detail.notes} full /></div></div><footer className="factura-modal-footer"><button className="factura-secondary" onClick={() => setModal(null)}>Cerrar</button></footer></> : <form onSubmit={submit}><div className="factura-modal-body"><div className="factura-form-grid">
        <Field label="Cliente" name="customer_id" value={form.customer_id} onChange={change} required><select id="customer_id" name="customer_id" value={form.customer_id} onChange={change} required><option value="">Selecciona un cliente</option>{activeCustomers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.nit ? ` — ${customer.nit}` : ""}</option>)}</select></Field>
        <Field label="Número de factura" name="invoice_number" value={form.invoice_number} onChange={change} required />
        <Field label="Fecha de emisión" name="issue_date" value={form.issue_date} onChange={change} type="date" />
        <Field label="Fecha de vencimiento" name="due_date" value={form.due_date} onChange={change} type="date" />
        <Field label="Valor del documento" name="document_value" value={form.document_value} onChange={change} type="number" min="0" step="0.01" required />
        <Field label="Valor base" name="base_value" value={form.base_value} onChange={change} type="number" min="0" step="0.01" required />
        <Field label="Valor IVA" name="iva_value" value={form.iva_value} onChange={change} type="number" min="0" step="0.01" required />
        <Field label="Saldo" name="balance" value={form.balance} onChange={change} type="number" min="0" step="0.01" />
        <Field label="Días de crédito" name="credit_days" value={form.credit_days} onChange={change} type="number" min="0" step="1" />
        <Field label="Estado" name="status" value={form.status} onChange={change}><input id="status" name="status" value={form.status} onChange={change} required /></Field>
        <Field label="PROMO 18" name="promo_18" value={form.promo_18} onChange={change} type="number" min="0" step="0.01" />
        <Field label="Descuento" name="discount" value={form.discount} onChange={change} type="number" min="0" step="0.01" />
        <Field label="Correo" name="email" value={form.email} onChange={change} type="email" />
        <Field label="Notas" name="notes" value={form.notes} onChange={change} full><textarea id="notes" name="notes" value={form.notes ?? ""} onChange={change} /></Field>
      </div>{customersError && <div className="factura-alert factura-alert-error">{customersError}</div>}{!customersError && !activeCustomers.length && <div className="factura-form-hint">No hay clientes disponibles para seleccionar.</div>}{error && <div className="factura-form-error" role="alert">{error}</div>}</div><footer className="factura-modal-footer"><button type="button" className="factura-secondary" onClick={() => setModal(null)} disabled={saving}>Cancelar</button><button type="submit" className="factura-primary" disabled={saving || !!customersError || !activeCustomers.length}>{saving && <LoaderCircle className="factura-spin" size={16} />}{modal.editing ? "Guardar cambios" : "Crear factura"}</button></footer></form>}
    </section></div>}
  </main>;
}
