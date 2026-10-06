import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { createCollectionAction, createPaymentPromise, getCollectionActions, getPaymentPromises } from "../../services/collectionOperations.service";
import { formatCurrency, formatDate } from "../../utils/format";

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("es-CO", { dateStyle: "short", timeStyle: "short", timeZone: "America/Bogota" }).format(date);
}

export default function CollectionOperations({ customerId, invoices }) {
  const { permissions = [] } = useAuth();
  const canManage = permissions.includes("collection.manage");
  const [history, setHistory] = useState({ loading: true, error: "", actions: [], promises: [] });
  const [reload, setReload] = useState(0);
  const [invoiceId, setInvoiceId] = useState("");
  const [mode, setMode] = useState("");
  const [form, setForm] = useState({ invoice_id: "", action_type: "", description: "", promised_date: "", promised_amount: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const firstField = useRef(null);
  const alive = useRef(false);
  const pending = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([getCollectionActions(customerId, { invoiceId, signal: controller.signal }), getPaymentPromises(customerId, { invoiceId, signal: controller.signal })])
      .then(([actions, promises]) => { if (!controller.signal.aborted) setHistory({ loading: false, error: "", actions, promises }); })
      .catch(failure => { if (!controller.signal.aborted) setHistory({ loading: false, error: failure.message, actions: [], promises: [] }); });
    return () => controller.abort();
  }, [customerId, invoiceId, reload]);
  useEffect(() => { if (mode) firstField.current?.focus(); }, [mode]);
  function change(event) { setForm(current => ({ ...current, [event.target.name]: event.target.value })); }
  function loadAgain() { setHistory({ loading: true, error: "", actions: [], promises: [] }); setReload(value => value + 1); }
  function open(next) { setMode(next); setError(""); setNotice(""); }
  async function submit(event) {
    event.preventDefault(); if (pending.current || !canManage) return;
    pending.current = true; setSaving(true); setError(""); setNotice("");
    const body = mode === "action" ? { invoice_id: form.invoice_id || null, action_type: form.action_type, description: form.description } :
      { invoice_id: form.invoice_id || null, promised_date: form.promised_date, promised_amount: form.promised_amount, notes: form.notes || null };
    try {
      await (mode === "action" ? createCollectionAction(customerId, body) : createPaymentPromise(customerId, body));
      if (alive.current) {
        setNotice(mode === "action" ? "Gestión registrada." : "Promesa registrada como pendiente.");
        setMode(""); setForm({ invoice_id: "", action_type: "", description: "", promised_date: "", promised_amount: "", notes: "" }); loadAgain();
      }
    } catch (failure) { if (alive.current) setError(failure.message); }
    finally { pending.current = false; if (alive.current) setSaving(false); }
  }
  return <section className="cobranza-operations" aria-label="Gestión operativa del cliente">
    <h3>Gestiones, promesas e historial</h3>
    <div className="cobranza-operation-buttons">{canManage && <><button className="cartera-reset" disabled={saving} onClick={() => open("action")}>Registrar gestión</button><button className="cartera-reset" disabled={saving} onClick={() => open("promise")}>Registrar promesa</button></>}<button className="cartera-reset" disabled={saving} onClick={loadAgain}>Ver historial / Actualizar</button></div>
    {notice && <p role="status">{notice}</p>}{error && <p className="cartera-alert" role="alert">{error}</p>}
    {canManage && (mode === "action" || mode === "promise") && <form className="cobranza-operation-form" onSubmit={submit} aria-label={mode === "action" ? "Registro de gestión" : "Registro de promesa"}>
      <h4>{mode === "action" ? "Registrar gestión manual" : "Registrar promesa de pago"}</h4>
      <label>Factura de la operación<select ref={firstField} name="invoice_id" value={form.invoice_id} onChange={change} disabled={saving}><option value="">Sin factura específica</option>{invoices.map(row => <option key={row.invoice?.invoice_id ?? row.invoice?.id} value={row.invoice?.invoice_id ?? row.invoice?.id}>{row.invoice?.invoice_number}</option>)}</select></label>
      {mode === "action" ? <><label>Tipo de gestión (texto libre)<input name="action_type" required maxLength={50} value={form.action_type} onChange={change} disabled={saving} /></label><p className="cobranza-note">El catálogo oficial de tipos de gestión está pendiente.</p><label>Observación de gestión<textarea name="description" required maxLength={4000} value={form.description} onChange={change} disabled={saving} /></label></> : <><label>Fecha prometida<input type="date" name="promised_date" required value={form.promised_date} onChange={change} disabled={saving} /></label><label>Valor prometido<input type="number" name="promised_amount" required min="0.01" step="0.01" value={form.promised_amount} onChange={change} disabled={saving} /></label><label>Observación de promesa<textarea name="notes" maxLength={4000} value={form.notes} onChange={change} disabled={saving} /></label><p className="cobranza-note">Se registra como pendiente. No modifica saldos, etapas ni envío de mensajes.</p></>}
      <div className="cobranza-operation-buttons"><button className="cartera-reset" type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar registro"}</button><button className="cartera-reset" type="button" disabled={saving} onClick={() => setMode("")}>Cancelar registro</button></div>
    </form>}

    <label className="cobranza-history-filter">Filtrar historial por factura<select value={invoiceId} onChange={event => { setHistory({ loading: true, error: "", actions: [], promises: [] }); setInvoiceId(event.target.value); }}><option value="">Todas las facturas y registros del cliente</option>{invoices.map(row => <option key={row.invoice?.invoice_id ?? row.invoice?.id} value={row.invoice?.invoice_id ?? row.invoice?.id}>{row.invoice?.invoice_number}</option>)}</select></label>
    {history.loading ? <p role="status">Cargando historial…</p> : history.error ? <div className="cartera-alert" role="alert">{history.error}<button className="cartera-reset" onClick={loadAgain}>Reintentar historial</button></div> : <>
      <h4 id="cobranza-gestiones">Historial de gestiones</h4>{!history.actions.length ? <p>No hay gestiones registradas.</p> : <ul className="cobranza-history">{history.actions.map(action => <li key={action.id}><strong>{action.action_type}</strong><span>{formatTime(action.action_date)} · {action.user_name || `Usuario ${action.user_id || "—"}`} · {action.invoice_number || "Cliente"}</span><p>{action.description}</p></li>)}</ul>}
      <h4 id="cobranza-promesas">Promesas registradas</h4>{!history.promises.length ? <p>No hay promesas registradas.</p> : <ul className="cobranza-history">{history.promises.map(promise => <li key={promise.id}><strong>{formatDate(promise.promised_date)} · {formatCurrency(promise.promised_amount)}</strong><span>Estado: {promise.status === "pending" ? "Pendiente" : promise.status} · {promise.user_name || `Usuario ${promise.user_id || "—"}`} · {promise.invoice_number || "Cliente"}</span><span>Registro: {formatTime(promise.created_at)}</span>{promise.notes && <p>{promise.notes}</p>}</li>)}</ul>}
    </>}
  </section>;
}
