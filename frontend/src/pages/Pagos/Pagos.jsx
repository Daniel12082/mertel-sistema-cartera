import { useCallback, useEffect, useMemo, useState } from "react";
import { CreditCard, Eye, FileText, LoaderCircle, Pencil, Plus, RotateCcw, Search, X } from "lucide-react";
import { getCustomers } from "../../services/customer.service";
import { getInvoiceById } from "../../services/invoice.service";
import {
  createPayment,
  createPaymentAllocation,
  getPaymentAllocations,
  getPaymentById,
  getPayments,
  reversePaymentAllocation,
  updatePayment,
} from "../../services/payment.service";
import { formatCurrency, formatDate } from "../../utils/format";
import api from "../../services/api";
import "./Pagos.css";

const blankPayment = { customer_id: "", payment_date: new Date().toLocaleDateString("en-CA"), amount: "", payment_method: "", reference: "", status: "confirmed", notes: "" };
const unwrap = (response) => response?.data ?? response;
const moneyPattern = /^\d{1,13}(?:\.\d{1,2})?$/;

function positiveMoney(value) {
  if (!moneyPattern.test(String(value))) return false;
  const [whole, fraction = ""] = String(value).split(".");
  return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2)) > 0n;
}

function moneyToCents(value) {
  const [whole, fraction = ""] = String(value ?? "0").split(".");
  return BigInt(whole || "0") * 100n + BigInt((fraction + "00").slice(0, 2));
}

function centsToMoney(value) {
  return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
}

function validDate(value) {
  const match = typeof value === "string" ? value.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return year >= 1000 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function getErrorMessage(error, context = "payment") {
  if (!error?.response) return "No fue posible conectar con el servidor. Verifica que la API esté disponible.";
  const status = error.response.status;
  const message = error.response.data?.message;
  if (status === 400 && message?.includes("disponible del pago")) return "El monto supera el disponible del pago.";
  if (status === 400 && message?.includes("saldo disponible de la factura")) return "El monto supera el saldo disponible de la factura.";
  if (status === 400 && message?.includes("clientes diferentes")) return "La factura seleccionada pertenece a otro cliente.";
  if (status === 400) return message || "Revisa los datos ingresados.";
  if (status === 404) return message || "No se encontró el registro solicitado.";
  if (status === 409 && (message?.includes("valor de un pago") || message?.includes("cliente de un pago"))) return "El monto o cliente no se puede cambiar porque este pago tiene asignaciones o historial.";
  if (status === 409) return message || (context === "allocation" ? "No fue posible aplicar el pago. Actualiza la información e inténtalo de nuevo." : "No fue posible guardar los cambios.");
  return context === "allocation" ? "No fue posible aplicar el pago." : "Ocurrió un error al procesar la solicitud.";
}

function Detail({ label, value, emphasis = false }) {
  return <div className={`pago-detail${emphasis ? " pago-detail-emphasis" : ""}`}><span>{label}</span><strong>{value || "—"}</strong></div>;
}

function FormField({ label, name, value, onChange, type = "text", required = false, disabled = false, children, hint }) {
  return <div className="pago-field"><label htmlFor={name}>{label}{required && <span className="pago-required"> *</span>}</label>{children || <input id={name} name={name} type={type} value={value ?? ""} onChange={onChange} required={required} disabled={disabled} />}{hint && <small>{hint}</small>}</div>;
}

function errorText(error, context) {
  console.error("Error en módulo de pagos:", error);
  return getErrorMessage(error, context);
}

export default function Pagos() {
  const [payments, setPayments] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState(null);
  const [paymentForm, setPaymentForm] = useState(blankPayment);
  const [saving, setSaving] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [allocationForm, setAllocationForm] = useState({ invoice_id: "", amount: "" });
  const [invoices, setInvoices] = useState([]);
  const [allocationError, setAllocationError] = useState("");
  const [allocationsLoading, setAllocationsLoading] = useState(false);
  const [pendingReversal, setPendingReversal] = useState(null);
  const [invoiceBalances, setInvoiceBalances] = useState({});

  const loadPayments = useCallback(async () => {
    setLoading(true);
    setListError("");
    try {
      const response = unwrap(await getPayments());
      setPayments(Array.isArray(response) ? response : []);
    } catch (error) {
      setListError(errorText(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    getPayments().then((response) => {
      const result = unwrap(response);
      if (active) setPayments(Array.isArray(result) ? result : []);
    }).catch((error) => {
      if (active) setListError(errorText(error));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const visiblePayments = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("es");
    if (!term) return payments;
    return payments.filter((payment) => [payment.customer_name, payment.customer_nit, payment.reference, payment.payment_method, payment.status]
      .some((value) => String(value ?? "").toLocaleLowerCase("es").includes(term)));
  }, [payments, query]);

  const activeCustomers = useMemo(() => customers.filter((customer) => customer.deleted_at == null && customer.status !== "inactive"), [customers]);
  const detailPayment = modal?.type === "detail" || modal?.type === "allocation" ? modal.payment : null;
  const selectedInvoice = invoices.find((invoice) => String(invoice.invoice_id) === allocationForm.invoice_id);

  async function openPaymentForm(payment = null) {
    setListError("");
    setSaving(Boolean(payment));
    try {
      const customerResult = unwrap(await getCustomers());
      setCustomers(Array.isArray(customerResult) ? customerResult : []);
      if (payment) {
        const [paymentResult, allocationResult] = await Promise.all([getPaymentById(payment.id), getPaymentAllocations(payment.id)]);
        const current = unwrap(paymentResult);
        const activeAllocations = unwrap(allocationResult);
        setModal({ type: "form", editing: true, payment: current, hasActiveAllocations: Array.isArray(activeAllocations) && activeAllocations.length > 0 });
        setPaymentForm({
          customer_id: String(current.customer_id ?? ""),
          payment_date: String(current.payment_date ?? "").slice(0, 10),
          amount: current.amount ?? "",
          payment_method: current.payment_method ?? "",
          reference: current.reference ?? "",
          status: current.status ?? "confirmed",
          notes: current.notes ?? "",
        });
      } else {
        setPaymentForm({ ...blankPayment, payment_date: new Date().toLocaleDateString("en-CA") });
        setModal({ type: "form", editing: false });
      }
    } catch (error) {
      setListError(errorText(error));
    } finally {
      setSaving(false);
    }
  }

  async function refreshPayment(paymentId, keepDetail = true) {
    setAllocationsLoading(true);
    try {
      const [paymentResult, allocationsResult] = await Promise.all([getPaymentById(paymentId), getPaymentAllocations(paymentId)]);
      const payment = unwrap(paymentResult);
      const allocations = unwrap(allocationsResult);
      const allocationRows = Array.isArray(allocations) ? allocations : [];
      const balanceEntries = await Promise.all(allocationRows.map(async (allocation) => {
        try {
          const result = unwrap(await getInvoiceById(allocation.invoice_id));
          return [allocation.invoice_id, result.balance];
        } catch { return [allocation.invoice_id, null]; }
      }));
      setInvoiceBalances(Object.fromEntries(balanceEntries));
      setPayments((current) => current.map((item) => item.id === payment.id ? payment : item));
      if (keepDetail) setModal({ type: "detail", payment, allocations: allocationRows });
      return { payment, allocations: allocationRows };
    } catch (error) {
      setListError(errorText(error));
      throw error;
    } finally {
      setAllocationsLoading(false);
    }
  }

  async function openDetail(payment) {
    setDetailLoading(true);
    setListError("");
    setModal({ type: "detail-loading", payment });
    try {
      const [paymentResult, allocationResult] = await Promise.all([getPaymentById(payment.id), getPaymentAllocations(payment.id)]);
      const allocationRows = Array.isArray(unwrap(allocationResult)) ? unwrap(allocationResult) : [];
      const balanceEntries = await Promise.all(allocationRows.map(async (allocation) => {
        try {
          const result = unwrap(await getInvoiceById(allocation.invoice_id));
          return [allocation.invoice_id, result.balance];
        } catch { return [allocation.invoice_id, null]; }
      }));
      setInvoiceBalances(Object.fromEntries(balanceEntries));
      setModal({ type: "detail", payment: unwrap(paymentResult), allocations: allocationRows });
    } catch (error) {
      setModal(null);
      setListError(errorText(error));
    } finally {
      setDetailLoading(false);
    }
  }

  function changePayment(event) {
    setPaymentForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function submitPayment(event) {
    event.preventDefault();
    setAllocationError("");
    if (!paymentForm.customer_id) { setAllocationError("Selecciona un cliente para continuar."); return; }
    if (!validDate(paymentForm.payment_date)) { setAllocationError("Ingresa una fecha de pago válida."); return; }
    if (!positiveMoney(paymentForm.amount)) { setAllocationError("El monto debe ser mayor que cero y tener máximo dos decimales."); return; }
    const payload = {
      company_id: modal.editing ? modal.payment.company_id ?? null : null,
      customer_id: Number(paymentForm.customer_id),
      payment_date: paymentForm.payment_date,
      amount: String(paymentForm.amount),
      payment_method: paymentForm.payment_method || null,
      reference: paymentForm.reference || null,
      status: paymentForm.status || "confirmed",
      notes: paymentForm.notes || null,
      created_by: modal.editing ? modal.payment.created_by ?? null : null,
    };
    setSaving(true);
    try {
      const response = unwrap(modal.editing ? await updatePayment(modal.payment.id, payload) : await createPayment(payload));
      const payment = response?.data ?? response;
      setModal(null);
      setNotice(modal.editing ? "Pago actualizado correctamente." : "Pago registrado correctamente.");
      await loadPayments();
      if (!modal.editing && payment?.id) await openDetail(payment);
    } catch (error) {
      setAllocationError(errorText(error));
    } finally {
      setSaving(false);
    }
  }

  async function openAllocationForm() {
    setAllocationError("");
    setSaving(true);
    try {
      const date = new Date().toLocaleDateString("en-CA");
      const response = await api.get("/portfolio", { params: { reference_date: date, customer_id: detailPayment.customer_id } });
      const availableInvoices = response.data?.data;
      setInvoices(Array.isArray(availableInvoices) ? availableInvoices : []);
      setAllocationForm({ invoice_id: "", amount: "" });
      setModal((current) => ({ ...current, type: "allocation" }));
    } catch (error) {
      setAllocationError(errorText(error, "allocation"));
    } finally {
      setSaving(false);
    }
  }

  function changeAllocation(event) {
    const { name, value } = event.target;
    setAllocationForm((current) => ({ ...current, [name]: value, ...(name === "invoice_id" ? { amount: "" } : {}) }));
  }

  function suggestAmount() {
    if (!detailPayment || !selectedInvoice) return;
    const availableCents = moneyToCents(detailPayment.available_amount);
    const invoiceCents = moneyToCents(selectedInvoice.balance);
    const suggestedCents = availableCents < invoiceCents ? availableCents : invoiceCents;
    setAllocationForm((current) => ({ ...current, amount: centsToMoney(suggestedCents) }));
  }

  async function submitAllocation(event) {
    event.preventDefault();
    setAllocationError("");
    if (!selectedInvoice) { setAllocationError("Selecciona una factura con saldo disponible."); return; }
    if (!positiveMoney(allocationForm.amount)) { setAllocationError("El monto debe ser mayor que cero y tener máximo dos decimales."); return; }
    setSaving(true);
    try {
      await createPaymentAllocation(detailPayment.id, { invoice_id: Number(allocationForm.invoice_id), amount: String(allocationForm.amount) });
      setNotice("Pago aplicado correctamente.");
      await refreshPayment(detailPayment.id);
    } catch (error) {
      setAllocationError(errorText(error, "allocation"));
    } finally {
      setSaving(false);
    }
  }

  async function reverseAllocation(allocation) {
    setPendingReversal(allocation);
  }

  async function confirmReversal() {
    if (!pendingReversal || !detailPayment) return;
    setSaving(true);
    setAllocationError("");
    try {
      await reversePaymentAllocation(detailPayment.id, pendingReversal.id);
      setPendingReversal(null);
      setNotice("Aplicación de pago revertida correctamente.");
      await refreshPayment(detailPayment.id);
    } catch (error) {
      setAllocationError(errorText(error, "allocation"));
    } finally {
      setSaving(false);
    }
  }

  function closeModal() {
    if (saving || allocationsLoading) return;
    setModal(null);
    setAllocationError("");
  }

  const editing = modal?.type === "form";
  const allocationMode = modal?.type === "allocation";
  const detailMode = modal?.type === "detail";
  const activeCustomerOptions = activeCustomers;

  return <main className="pagos-page">
    <header className="pagos-header"><div><h1>Pagos</h1><p>Registro y aplicación de pagos de clientes.</p></div><button className="pagos-primary" onClick={() => openPaymentForm()}><Plus size={17} /> Nuevo pago</button></header>
    {notice && <div className="pagos-alert pagos-alert-success" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Cerrar"><X size={16} /></button></div>}
    {listError && <div className="pagos-alert pagos-alert-error" role="alert">{listError}<button onClick={() => setListError("")} aria-label="Cerrar"><X size={16} /></button></div>}
    <section className="pagos-card">
      <div className="pagos-toolbar"><div className="pagos-card-title"><CreditCard size={18} /> Pagos registrados <span>({visiblePayments.length})</span></div><label className="pagos-search"><Search size={16} /><input aria-label="Buscar pago" placeholder="Buscar cliente, referencia o método" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>
      {loading ? <div className="pagos-empty"><LoaderCircle className="pagos-spin" size={25} /><p>Cargando pagos…</p></div> : listError && payments.length === 0 ? <div className="pagos-empty"><p>No se pudo cargar el listado.</p><button className="pagos-secondary" onClick={loadPayments}>Reintentar</button></div> : visiblePayments.length === 0 ? <div className="pagos-empty"><CreditCard size={30} /><h3>{payments.length ? "No hay resultados" : "No hay pagos registrados."}</h3><p>{payments.length ? "Prueba con otra búsqueda." : "Cuando registres un pago, aparecerá en este listado."}</p></div> : <div className="pagos-table-wrap"><table className="pagos-table"><thead><tr><th>Fecha</th><th>Cliente</th><th>Monto</th><th>Método</th><th>Referencia</th><th>Estado</th><th>Total aplicado</th><th>Disponible</th><th>Acciones</th></tr></thead><tbody>{visiblePayments.map((payment) => <tr key={payment.id}><td>{formatDate(payment.payment_date)}</td><td><strong>{payment.customer_name || "—"}</strong><small>{payment.customer_nit || ""}</small></td><td>{formatCurrency(payment.amount)}</td><td>{payment.payment_method || "—"}</td><td>{payment.reference || "—"}</td><td><span className="pagos-status">{payment.status || "—"}</span></td><td>{formatCurrency(payment.total_allocated)}</td><td><strong>{formatCurrency(payment.available_amount)}</strong></td><td><div className="pagos-actions"><button title="Ver detalle" aria-label={`Ver pago ${payment.reference || payment.id}`} onClick={() => openDetail(payment)}><Eye size={16} /></button><button title="Editar pago" aria-label={`Editar pago ${payment.reference || payment.id}`} onClick={() => openPaymentForm(payment)}><Pencil size={16} /></button></div></td></tr>)}</tbody></table></div>}
    </section>

    {modal && <div className="pagos-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal(); }}><section className={`pagos-modal${modal.type === "detail" || modal.type === "allocation" ? " pagos-modal-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="pagos-modal-title">
      <header className="pagos-modal-header"><div><h2 id="pagos-modal-title">{editing ? (modal.editing ? "Editar pago" : "Nuevo pago") : detailMode || allocationMode ? `Pago ${detailPayment?.reference || `#${detailPayment?.id}`}` : "Cargando detalle…"}</h2><p>{editing ? "Completa la información del pago." : allocationMode ? "Selecciona una factura pendiente del cliente y confirma el valor a aplicar." : "Información financiera y facturas asociadas."}</p></div><button className="pagos-close" onClick={closeModal} aria-label="Cerrar"><X size={19} /></button></header>
      {editing ? <form onSubmit={submitPayment} noValidate><div className="pagos-modal-body"><div className="pagos-form-grid">
        <FormField label="Cliente" name="customer_id" value={paymentForm.customer_id} onChange={changePayment} required disabled={Boolean(modal.editing && modal.hasActiveAllocations)}><select id="customer_id" name="customer_id" value={paymentForm.customer_id} onChange={changePayment} required disabled={Boolean(modal.editing && modal.hasActiveAllocations)}><option value="">Selecciona un cliente</option>{activeCustomerOptions.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.nit ? ` — ${customer.nit}` : ""}</option>)}</select></FormField>
        <FormField label="Fecha de pago" name="payment_date" value={paymentForm.payment_date} onChange={changePayment} type="date" required />
        <FormField label="Monto" name="amount" value={paymentForm.amount} onChange={changePayment} type="number" required disabled={Boolean(modal.editing && modal.hasActiveAllocations)} hint={modal.editing && modal.hasActiveAllocations ? "No se puede cambiar porque el pago tiene asignaciones activas." : "Usa hasta dos decimales."} />
        <FormField label="Método de pago" name="payment_method" value={paymentForm.payment_method} onChange={changePayment} />
        <FormField label="Referencia" name="reference" value={paymentForm.reference} onChange={changePayment} />
        <FormField label="Estado" name="status" value={paymentForm.status} onChange={changePayment} />
        <FormField label="Notas" name="notes" value={paymentForm.notes} onChange={changePayment}><textarea id="notes" name="notes" value={paymentForm.notes} onChange={changePayment} /></FormField>
      </div>{modal.editing && !modal.hasActiveAllocations && <p className="pagos-hint">Si este pago tuvo asignaciones revertidas, el backend puede bloquear cambios de monto o cliente para proteger el historial.</p>}{!activeCustomerOptions.length && <p className="pagos-hint pagos-hint-error">No hay clientes activos disponibles para seleccionar.</p>}{allocationError && <div className="pagos-form-error" role="alert">{allocationError}</div>}</div><footer className="pagos-modal-footer"><button type="button" className="pagos-secondary" onClick={closeModal} disabled={saving}>Cancelar</button><button type="submit" className="pagos-primary" disabled={saving || !activeCustomerOptions.length}>{saving && <LoaderCircle className="pagos-spin" size={16} />}{modal.editing ? "Guardar cambios" : "Registrar pago"}</button></footer></form> : detailLoading && modal.type === "detail-loading" ? <div className="pagos-empty"><LoaderCircle className="pagos-spin" size={25} /><p>Cargando detalle y asignaciones…</p></div> : detailPayment && <>
        <div className="pagos-modal-body"><div className="pagos-summary-grid"><Detail label="Cliente" value={`${detailPayment.customer_name || "—"}${detailPayment.customer_nit ? ` · ${detailPayment.customer_nit}` : ""}`} /><Detail label="Fecha de pago" value={formatDate(detailPayment.payment_date)} /><Detail label="Método" value={detailPayment.payment_method} /><Detail label="Referencia" value={detailPayment.reference} /><Detail label="Estado" value={detailPayment.status} /><Detail label="Notas" value={detailPayment.notes} /><Detail label="Valor del pago" value={formatCurrency(detailPayment.amount)} emphasis /><Detail label="Total aplicado" value={formatCurrency(detailPayment.total_allocated)} emphasis /><Detail label="Disponible" value={formatCurrency(detailPayment.available_amount)} emphasis /></div>
          {allocationError && <div className="pagos-form-error" role="alert">{allocationError}</div>}
          {allocationMode ? <form className="pagos-allocation-form" onSubmit={submitAllocation}><h3>Aplicar a factura</h3><div className="pagos-form-grid"><FormField label="Factura" name="invoice_id" value={allocationForm.invoice_id} onChange={changeAllocation} required><select id="invoice_id" name="invoice_id" value={allocationForm.invoice_id} onChange={changeAllocation} required><option value="">Selecciona una factura</option>{invoices.map((invoice) => <option key={invoice.invoice_id} value={invoice.invoice_id}>{invoice.invoice_number} · Saldo {formatCurrency(invoice.balance)} · Vence {formatDate(invoice.due_date)}</option>)}</select></FormField><FormField label="Monto a aplicar" name="amount" value={allocationForm.amount} onChange={changeAllocation} type="number" required hint="El backend valida el disponible y el saldo final." /></div>{selectedInvoice ? <div className="pagos-selected-invoice"><div><span>Saldo de factura</span><strong>{formatCurrency(selectedInvoice.balance)}</strong></div><div><span>Disponible del pago</span><strong>{formatCurrency(detailPayment.available_amount)}</strong></div><button type="button" className="pagos-secondary" onClick={suggestAmount}>Sugerir monto máximo</button></div> : invoices.length === 0 ? <div className="pagos-inline-empty"><FileText size={18} />El cliente no tiene facturas con saldo disponible.</div> : null}<div className="pagos-inline-actions"><button type="button" className="pagos-secondary" onClick={() => setModal((current) => ({ ...current, type: "detail" }))} disabled={saving}>Cancelar</button><button type="submit" className="pagos-primary" disabled={saving || !selectedInvoice || !allocationForm.amount}>{saving && <LoaderCircle className="pagos-spin" size={16} />}Confirmar aplicación</button></div></form> : <section className="pagos-allocations"><div className="pagos-allocation-heading"><div><h3>Facturas aplicadas</h3><p>Las asignaciones listadas están activas.</p></div><button className="pagos-primary" onClick={openAllocationForm} disabled={saving || allocationsLoading || Number(detailPayment.available_amount) <= 0}><Plus size={16} /> Aplicar a factura</button></div>{allocationsLoading ? <div className="pagos-inline-empty"><LoaderCircle className="pagos-spin" size={18} />Actualizando asignaciones…</div> : modal.allocations?.length ? <div className="pagos-table-wrap"><table className="pagos-table pagos-allocation-table"><thead><tr><th>Factura</th><th>Valor asignado</th><th>Saldo factura</th><th>Fecha</th><th>Estado</th><th>Acción</th></tr></thead><tbody>{modal.allocations.map((allocation) => <tr key={allocation.id}><td><strong>{allocation.invoice_number || `#${allocation.invoice_id}`}</strong></td><td>{formatCurrency(allocation.amount)}</td><td>{invoiceBalances[allocation.invoice_id] === null ? "Factura no disponible" : formatCurrency(invoiceBalances[allocation.invoice_id])}</td><td>{formatDate(allocation.created_at)}</td><td><span className="pagos-status pagos-status-active">Activa</span></td><td><button className="pagos-reverse" onClick={() => reverseAllocation(allocation)} disabled={saving || allocationsLoading}><RotateCcw size={15} /> Revertir</button></td></tr>)}</tbody></table></div> : <div className="pagos-inline-empty"><FileText size={18} />Este pago todavía no tiene facturas aplicadas.</div>}</section>}
          {!allocationMode && <div className="pagos-edit-row"><button className="pagos-secondary" onClick={() => openPaymentForm(detailPayment)} disabled={saving || allocationsLoading}><Pencil size={15} /> Editar datos del pago</button><span>Los cambios financieros están sujetos a las validaciones del backend.</span></div>}
        </div><footer className="pagos-modal-footer"><button className="pagos-secondary" onClick={closeModal} disabled={saving || allocationsLoading}>Cerrar</button></footer>
      </>}
    </section></div>}
    {pendingReversal && <div className="pagos-backdrop pagos-confirm-backdrop"><section className="pagos-modal pagos-confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="pagos-confirm-title" aria-describedby="pagos-confirm-description"><header className="pagos-modal-header"><div><h2 id="pagos-confirm-title">Revertir aplicación</h2><p id="pagos-confirm-description">¿Deseas revertir esta aplicación de pago? El valor volverá al saldo pendiente de {pendingReversal.invoice_number || `la factura ${pendingReversal.invoice_id}`}.</p></div></header><footer className="pagos-modal-footer"><button className="pagos-secondary" onClick={() => setPendingReversal(null)} disabled={saving}>Cancelar</button><button className="pagos-primary" onClick={confirmReversal} disabled={saving}>{saving && <LoaderCircle className="pagos-spin" size={16} />}Confirmar reversión</button></footer></section></div>}
  </main>;
}
