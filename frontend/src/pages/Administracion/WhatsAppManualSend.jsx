import { useEffect, useRef, useState } from 'react';
import { getCustomers } from '../../services/customer.service';
import { sendManualWhatsApp, whatsappRequest } from '../../services/whatsappCenter.service';
import { useAppDataMode } from '../../simulation/useAppDataMode';
import { WhatsAppMediaPreview } from './WhatsAppMedia';
import { MEDIA_UNAVAILABLE } from '../../services/whatsappMedia.service';

export default function WhatsAppManualSend({ templates, settings }) {
  const { mode } = useAppDataMode();
  const simulation = mode === 'SIMULATION';
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [form, setForm] = useState({ customer_id: '', template_id: '' });
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const pending = useRef(false);
  const previewRequest = useRef(null);
  const mounted = useRef(true);
  const customer = customers.find(row => String(row.id) === form.customer_id);
  const available = templates.filter(row => row.status === 'active' && row.channel === 'whatsapp');
  const template = available.find(row => String(row.id) === form.template_id);
  const hasPhone = Boolean(customer && typeof customer.phone === 'string' && customer.phone.trim());
  const ready = Boolean(customer && template && hasPhone && preview && preview.can_prepare && (simulation || !preview.attachment) && !busy && !result);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; previewRequest.current?.abort(); };
  }, []);
  useEffect(() => {
    let active = true;
    getCustomers().then(response => {
      if (!response.success || !Array.isArray(response.data) || response.data.some(row => !row || row.id == null)) throw new Error('Respuesta de clientes inválida.');
      if (active) setCustomers(response.data.filter(row => row.status === 'active' && !row.deleted_at));
    }).catch(() => { if (active) setError('No se pudieron cargar los clientes. Intenta nuevamente.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry]);

  async function showPreview(selection) {
    previewRequest.current?.abort();
    setPreview(null); setError(''); setResult(null);
    if (!selection.customer_id || !selection.template_id) return;
    const controller = new AbortController(); previewRequest.current = controller;
    setBusy(true);
    try {
      const value = await whatsappRequest('/preview', { method: 'post', body: selection, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!value || !value.customer || !value.template || String(value.customer.id) !== selection.customer_id ||
        String(value.template.id) !== selection.template_id || typeof value.content !== 'string' ||
        !Array.isArray(value.missing_variables) || !Array.isArray(value.unsupported_variables) || typeof value.can_prepare !== 'boolean') {
        throw new Error('Revisa el cliente y la plantilla e intenta nuevamente.');
      }
      setPreview(value);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof TypeError ? 'No se pudo mostrar el mensaje. Revisa la selección e intenta nuevamente.' : failure.message);
    } finally { if (!controller.signal.aborted && mounted.current) setBusy(false); }
  }
  function select(key, value) {
    const selection = { ...form, [key]: value };
    setForm(selection);
    setBusy(false);
    void showPreview(selection);
  }
  async function send() {
    if (!ready || pending.current) return;
    pending.current = true; setBusy(true); setSending(true); setError('');
    try {
      const message = await sendManualWhatsApp(form);
      if (!mounted.current) return;
      if (!message || !['SENT', 'DELIVERED', 'READ'].includes(message.status)) {
        setResult({ warning: true, text: message?.status === 'FAILED' ? 'El mensaje no se pudo enviar. Consulta el historial para reintentar.' : 'El mensaje sigue pendiente por las condiciones del canal. Consulta el historial; aún no se envió.' });
      } else setResult({ text: preview.attachment ? 'Mensaje multimedia simulado preparado correctamente. Ningún archivo fue enviado ni entregado realmente.' : simulation ? 'Mensaje simulado enviado correctamente. No se realizó ningún envío real.' : 'Mensaje enviado correctamente en el proveedor MOCK. No se realizó ningún envío real.' });
    } catch (failure) {
      if (mounted.current) setError(failure instanceof TypeError ? 'No se pudo enviar el mensaje. Intenta nuevamente.' : failure.message);
    } finally { pending.current = false; if (mounted.current) { setBusy(false); setSending(false); } }
  }
  return <article className="wa-card wa-manual" aria-busy={busy || loading}>
    <span className="wa-eyebrow">ENVÍO MANUAL</span><h2>Enviar mensaje por WhatsApp</h2>
    <p>Elige el cliente y la plantilla. Revisa el mensaje antes de enviarlo.</p>
    {loading && <p role="status">Cargando clientes…</p>}
    {error && <div className="wa-error" role="alert"><p>{error}</p><button disabled={busy} onClick={() => {
      if (!customers.length) { setLoading(true); setError(''); setRetry(value => value + 1); }
      else void showPreview(form);
    }}>Reintentar</button></div>}
    <div className="wa-manual-layout"><div>
      <label>Cliente<select aria-label="Cliente" value={form.customer_id} disabled={loading || sending} onChange={event => select('customer_id', event.target.value)}>
        <option value="">Seleccionar cliente</option>{customers.map(row => <option key={row.id} value={row.id}>{row.name} · {row.nit}</option>)}
      </select></label>
      {!loading && !customers.length && !error && <p>No hay clientes disponibles.</p>}
      <label>Número de WhatsApp<input readOnly value={customer ? customer.phone || 'Sin teléfono registrado' : ''} placeholder="Selecciona un cliente" /></label>
      {customer && !hasPhone && <p className="wa-warning">El cliente no tiene teléfono registrado. Selecciona otro cliente o actualiza su información.</p>}
      <label>Plantilla<select aria-label="Plantilla" value={template ? form.template_id : ''} disabled={sending} onChange={event => select('template_id', event.target.value)}>
        <option value="">Seleccionar plantilla</option>{available.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
      </select></label>
      {!available.length && <p>No hay plantillas activas autorizadas disponibles.</p>}
      <button disabled={busy || !customer || !template} onClick={() => showPreview(form)}>Vista previa</button>
    </div><div className="wa-preview" aria-label="Vista previa del mensaje">
      <h3>Vista previa</h3>
      {busy && !sending ? <p role="status">Cargando vista previa…</p> : preview ? <>
        <pre>{preview.content}</pre>
        {preview.attachment && <><WhatsAppMediaPreview key={preview.attachment.id} attachment={preview.attachment} />{!simulation && <p className="wa-warning">{MEDIA_UNAVAILABLE}</p>}</>}
        {!preview.can_prepare && <p className="wa-warning" role="alert">Información pendiente: {[...preview.missing_variables, ...preview.unsupported_variables].join(', ') || 'Revisa el teléfono y el contenido.'}</p>}
      </> : <p>{!customer ? 'Selecciona un cliente para continuar.' : !template ? 'Selecciona una plantilla para continuar.' : 'Genera la vista previa para continuar.'}</p>}
      <p className="wa-banner">{simulation ? 'MODO SIMULACIÓN · Este mensaje no será enviado a ningún teléfono.' : 'Prueba con proveedor MOCK · Este mensaje no será enviado a ningún teléfono.'}</p>
      {!simulation && settings.connection_status !== 'CONNECTED' && <p className="wa-warning">Configura y valida la conexión MOCK antes del envío.</p>}
      <button className="wa-primary" disabled={!ready || (!simulation && (settings.provider !== 'MOCK' || settings.connection_status !== 'CONNECTED'))} onClick={send}>{sending ? 'Enviando…' : 'Enviar mensaje por WhatsApp'}</button>
      {result && <p role="status" className={result.warning ? 'wa-warning' : 'wa-success'}>{result.text}</p>}
    </div></div>
  </article>;
}
