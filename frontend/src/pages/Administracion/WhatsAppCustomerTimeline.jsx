import { useEffect, useState } from 'react';
import { getCustomers } from '../../services/customer.service';
import { whatsappRequest } from '../../services/whatsappCenter.service';
import { useAppDataMode } from '../../simulation/useAppDataMode';
import { browserDay } from '../../simulation/dataset';

const labels = { SENT: 'ENVIADO', DELIVERED: 'ENTREGADO', READ: 'LEÍDO', PENDING: 'PENDIENTE', FAILED: 'FALLIDO', CANCELLED: 'CANCELADO', PROCESSING: 'PENDIENTE' };
const money = value => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(value));
const date = value => !value ? 'Sin fecha' : /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
export default function WhatsAppCustomerTimeline() {
  const { mode } = useAppDataMode();
  const simulation = mode === 'SIMULATION';
  const [customers, setCustomers] = useState([]), [customerId, setCustomerId] = useState('');
  const [day, setDay] = useState(browserDay()), [data, setData] = useState(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  const [consentSource, setConsentSource] = useState('');
  useEffect(() => {
    let active = true;
    getCustomers().then(response => {
      if (!response.success || !Array.isArray(response.data)) throw new Error('No se pudieron cargar los clientes.');
      if (active) setCustomers(response.data.filter(row => row.status === 'active'));
    }).catch(() => { if (active) setError('No se pudieron cargar los clientes. Intenta nuevamente.'); });
    return () => { active = false; };
  }, [revision]);
  useEffect(() => {
    if (!customerId) return;
    const controller = new AbortController();
    whatsappRequest(`/customers/${encodeURIComponent(customerId)}/sequence`, { params: simulation ? { reference_date: day } : {}, signal: controller.signal })
      .then(value => {
        if (!value || !value.customer || String(value.customer.id) !== customerId || !Array.isArray(value.steps)) throw new Error('No se pudo interpretar la secuencia del cliente.');
        if (!controller.signal.aborted) setData(value);
      }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [customerId, day, simulation, revision]);
  async function act(work) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await work(); setNotice(simulation ? 'Evaluación simulada completada. No se realizó ningún envío real.' : 'Operación completada. Consulta el estado en el historial.'); setRevision(value => value + 1); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <article className="wa-card"><span className="wa-eyebrow">SEGUIMIENTO POR CLIENTE</span><h2>Timeline de mensajes</h2>
    {simulation && <p className="wa-banner">MODO SIMULACIÓN · Toda la secuencia usa datos locales; ningún envío real.</p>}
    <div className="wa-grid"><label>Cliente de la timeline<select aria-label="Cliente de la timeline" disabled={busy} value={customerId} onChange={event => { setCustomerId(event.target.value); setConsentSource(''); setData(null); setError(''); setNotice(''); setLoading(Boolean(event.target.value)); }}><option value="">Seleccionar cliente</option>{customers.map(row => <option key={row.id} value={row.id}>{row.name} · {row.nit}</option>)}</select></label>
      {simulation && <label>Fecha de demostración<input type="date" value={day} onChange={event => { setDay(event.target.value); setLoading(true); setError(''); }} /></label>}</div>
    {error && <div className="wa-error" role="alert">{error}<button onClick={() => { setError(''); setLoading(Boolean(customerId)); setRevision(value => value + 1); }}>Reintentar</button></div>}
    {notice && <p className="wa-success" role="status">{notice}</p>}
    {loading && <p role="status">Consultando cartera y mensajes…</p>}
    {!customerId && <p>Selecciona un cliente para ver sus avisos.</p>}
    {data && <><h3>{data.customer.name}</h3><dl className="wa-customer-summary"><dt>NIT</dt><dd>{data.customer.nit}</dd><dt>Celular</dt><dd>{data.customer.phone || 'Sin celular'}</dd><dt>Saldo</dt><dd>{money(data.total_balance)}</dd><dt>Etapa actual</dt><dd>{data.stage_label}</dd><dt>Último mensaje</dt><dd>{data.last_contact ? `${date(data.last_contact.date)} · ${data.last_contact.label}` : 'Sin contacto registrado'}</dd><dt>Próximo mensaje</dt><dd>{data.next_contact ? `${date(data.next_contact.date)} · ${data.next_contact.label}` : 'Sin próximo aviso aplicable'}</dd></dl>
      <div className="wa-actions"><button disabled={busy} onClick={() => act(() => whatsappRequest(`/customers/${customerId}/exclusion`, { method: 'patch', body: { excluded: !data.excluded } }))}>{data.excluded ? 'Permitir mensajes automáticos' : 'Excluir de mensajes automáticos'}</button>
        <button disabled={busy} onClick={() => {
          if (data.real_provider && !window.confirm('¿Procesar ahora los avisos pendientes de los clientes autorizados? Se podrán enviar mensajes reales.')) return;
          return act(() => whatsappRequest('/automations/process', { method: 'post', body: simulation ? { reference_date: day } : {} }));
        }}>{simulation ? 'Simular evaluación del día' : 'Procesar avisos pendientes ahora'}</button></div>
      {data.real_provider && <form onSubmit={event => {
        event.preventDefault();
        const authorized = !data.contact_authorized;
        void act(async () => {
          await whatsappRequest(`/customers/${customerId}/consent`, { method: 'patch', body: { authorized, ...(authorized ? { source: consentSource.trim() } : {}) } });
          setConsentSource('');
        });
      }}>
        <p>{data.contact_authorized ? 'Autorización de WhatsApp registrada para este número.' : 'El cliente aún no tiene autorización de WhatsApp registrada para este número.'}</p>
        {!data.contact_authorized && <label>Referencia del consentimiento<input required maxLength={200} value={consentSource} onChange={event => setConsentSource(event.target.value)} /></label>}
        <button disabled={busy || (!data.contact_authorized && !consentSource.trim())}>{data.contact_authorized ? 'Revocar autorización de WhatsApp' : 'Registrar consentimiento del cliente'}</button>
      </form>}
      {data.excluded && <p className="wa-warning">Cliente excluido: el backend bloquea los mensajes automáticos.</p>}
      <p>FACTURA / CARTERA ↓ PRONTO PAGO ↓ RECORDATORIO ↓ VENCE HOY ↓ MORA</p>
      <ol className="wa-timeline">{data.steps.map((step, index) => <li key={`${step.stage}:${step.date}:${index}`}><span className="wa-eyebrow">{labels[step.status] || step.status}</span><h3>{step.label}</h3><p>{step.description}</p><code>{step.template_name}</code><p>Fecha prevista: {date(step.date)} · Fecha real: {date(step.message?.sent_at)}</p>
        <p>{step.reason || step.message?.automation_context?.reason || 'Aviso vigente según la regla MERTEL.'}</p>
        {step.message?.automation_context?.cancellation_reason && <p className="wa-warning">{step.message.automation_context.cancellation_reason}</p>}
        {step.content && <pre>{step.content}</pre>}
      </li>)}</ol>
    </>}
  </article>;
}
