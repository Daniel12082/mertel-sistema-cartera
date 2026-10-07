import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import { whatsappRequest } from '../../services/whatsappCenter.service';
import { getMessageTemplateAdminData } from '../../services/messageTemplatesAdmin.service';
import MessageTemplates from './MessageTemplates';
import './WhatsAppCenter.css';

const connectionLabels = { NOT_CONFIGURED: 'No conectado', CONFIGURED: 'Configurado · sin validar', CONNECTED: 'Conectado · simulación MOCK', DISCONNECTED: 'Desconectado', ERROR: 'Error de conexión MOCK' };
const stateLabels = { PENDING: 'Pendiente', PROCESSING: 'Procesando', SENT: 'Enviado (MOCK)', DELIVERED: 'Entregado', READ: 'Leído', FAILED: 'Fallido', CANCELLED: 'Cancelado' };
const auditLabels = { configure: 'Configuración actualizada', disconnect: 'WhatsApp desconectado', test_connection: 'Prueba de conexión', automation_update: 'Regla de mensajería actualizada', created: 'Plantilla creada', updated: 'Plantilla modificada', activated: 'Plantilla activada', deactivated: 'Plantilla desactivada', queued: 'Mensaje en cola', cancelled: 'Mensaje cancelado', sent: 'Mensaje enviado (MOCK)', delivered: 'Mensaje entregado', read: 'Mensaje leído', failed: 'Mensaje fallido (MOCK)', incoming: 'Respuesta recibida' };
const entityLabels = { whatsapp_setting: 'WhatsApp', whatsapp_message: 'Mensaje', message_template: 'Plantilla' };
const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const time = value => value ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Bogota' }).format(new Date(value)) : '—';

function RuleEditor({ stage, rule, templates, busy, save, connected }) {
  const [form, setForm] = useState(rule || { stage: stage.key, enabled: false, template_id: '', start_time: '', end_time: '', weekdays: [], daily_limit: '', interval_hours: '', mode: 'MANUAL' });
  const update = (key, value) => setForm(current => ({ ...current, [key]: value }));
  return <form className="wa-card" onSubmit={event => { event.preventDefault(); save(stage.key, { ...form, daily_limit: Number(form.daily_limit), interval_hours: Number(form.interval_hours) }); }}>
    <h3>{stage.label}</h3>
    <div className="wa-grid"><label>Modo<select aria-label="Modo" value={form.mode} onChange={event => update('mode', event.target.value)}><option value="MANUAL">Manual</option><option value="AUTOMATICO">Automático</option></select></label>
      <label>Plantilla<select aria-label="Plantilla" required value={form.template_id} onChange={event => update('template_id', event.target.value)}><option value="">Seleccionar plantilla</option>{templates.filter(template => template.status === 'active' && (!template.stage || template.stage === stage.key)).map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
      <label>Hora inicio<input required type="time" value={form.start_time} onChange={event => update('start_time', event.target.value)} /></label>
      <label>Hora fin<input required type="time" value={form.end_time} onChange={event => update('end_time', event.target.value)} /></label>
      <label>Máximo por etapa/día<input required type="number" min="1" value={form.daily_limit} onChange={event => update('daily_limit', event.target.value)} /></label>
      <label>Intervalo mínimo (horas)<input required type="number" min="1" max="8760" value={form.interval_hours} onChange={event => update('interval_hours', event.target.value)} /></label></div>
    <fieldset><legend>Días permitidos · hora de Bogotá</legend><div className="wa-days">{days.map((day, index) => <label key={day}><input type="checkbox" checked={form.weekdays.includes(index + 1)} onChange={event => update('weekdays', event.target.checked ? [...form.weekdays, index + 1] : form.weekdays.filter(value => value !== index + 1))} />{day}</label>)}</div></fieldset>
    <label className="wa-check"><input type="checkbox" checked={form.enabled} disabled={!connected && !form.enabled} onChange={event => update('enabled', event.target.checked)} />Regla activa</label>
    <button disabled={busy}>Guardar regla de {stage.label}</button>
  </form>;
}

export default function WhatsAppCenter() {
  const { permissions = [] } = useAuth(); const authorized = permissions.includes('settings.manage');
  const [data, setData] = useState(null); const [templates, setTemplates] = useState([]); const [tab, setTab] = useState('Conexión');
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const [settingsForm, setSettingsForm] = useState(null); const [credentials, setCredentials] = useState(null);
  const [messages, setMessages] = useState({ messages: [], page: 1, has_next: false }); const [audit, setAudit] = useState([]);
  const [filters, setFilters] = useState({ customer_id: '', template_id: '', stage: '', status: '', date_from: '', date_to: '', page: 1 });
  const [previewForm, setPreviewForm] = useState({ customer_id: '', template_id: '' }); const [preview, setPreview] = useState(null);
  const [incoming, setIncoming] = useState({ phone: '', content: '', provider_message_id: '' });
  const [revision, setRevision] = useState(0);
  const operationPending = useRef(false);
  useEffect(() => {
    if (!authorized) return;
    const controller = new AbortController();
    Promise.all([whatsappRequest('', { signal: controller.signal }), getMessageTemplateAdminData({ signal: controller.signal })]).then(([center, templateData]) => {
      if (!controller.signal.aborted) { setData(center); setTemplates(templateData.templates); }
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [authorized, revision]);
  useEffect(() => {
    if (!authorized || !['Mensajes', 'Historial'].includes(tab)) return;
    const controller = new AbortController();
    const request = tab === 'Mensajes' ? whatsappRequest('/messages', { params: filters, signal: controller.signal }) : whatsappRequest('/audit', { signal: controller.signal });
    request.then(result => { if (!controller.signal.aborted) { if (tab === 'Mensajes') setMessages(result); else setAudit(result); } }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [authorized, tab, filters, revision]);
  async function act(work, success) {
    if (operationPending.current) return;
    operationPending.current = true;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await work();
      if (tab === 'Mensajes') setMessages(await whatsappRequest('/messages', { params: filters }));
      setNotice(success); setRevision(value => value + 1); return result;
    }
    catch (failure) { setError(failure.message); }
    finally { operationPending.current = false; setBusy(false); }
  }
  const settings = data?.settings; const connected = settings?.connection_status === 'CONNECTED';
  const stages = data?.stage_catalog || [];
  function changeFilter(key, value) { setFilters(current => ({ ...current, [key]: value, page: 1 })); }
  if (!authorized) return <section className="wa-center"><h1>Centro de WhatsApp MERTEL</h1><p role="alert">No tienes permiso para configurar WhatsApp.</p></section>;
  return <section className="wa-center"><header><span>Administración de MERTEL</span><h1>Centro de WhatsApp</h1><p>Configuración, plantillas y seguimiento de cobranza.</p><p className="wa-banner">Entorno de preparación · solo pruebas MOCK · ningún envío real</p></header>
    <nav aria-label="Secciones de WhatsApp">{['Conexión', 'Plantillas', 'Automatizaciones', 'Mensajes', 'Historial'].map(item => <button key={item} aria-pressed={tab === item} onClick={() => { setTab(item); setError(''); setNotice(''); if (item !== 'Plantillas') setRevision(value => value + 1); }}>{item}</button>)}</nav>
    {error && <p className="wa-error" role="alert">{error}</p>}{notice && <p role="status" className="wa-success">{notice}</p>}
    {!data && <p role="status">Cargando configuración… <button onClick={() => setRevision(value => value + 1)}>Reintentar</button></p>}
    {data && tab === 'Conexión' && <>
      <article className="wa-card"><h2>Estado de conexión</h2><p className={`wa-state ${connected ? 'connected' : ''}`}>{connectionLabels[settings.connection_status] || 'Estado desconocido'}</p>
        <dl><dt>Proveedor</dt><dd>{settings.provider || 'No configurado'}</dd><dt>Número</dt><dd>{settings.number || 'No configurado'}</dd><dt>Automatizaciones</dt><dd>{settings.automations_enabled ? 'Activadas · solo MOCK' : 'Desactivadas'}</dd><dt>Credencial</dt><dd>{settings.credentials_configured ? '••••••••••••••••' : 'No configurada'}</dd></dl>
        <div className="wa-actions"><button disabled={busy} onClick={() => setSettingsForm({ provider: settings.provider || '', number: settings.number, phone_number_id: settings.phone_number_id, business_account_id: settings.business_account_id, global_daily_limit: settings.global_daily_limit ?? '', customer_daily_limit: settings.customer_daily_limit ?? '' })}>Configurar WhatsApp</button>
          <button disabled={busy || settings.provider !== 'MOCK'} onClick={() => act(() => whatsappRequest('/test', { method: 'post', body: {} }), 'Prueba MOCK completada. Configuración válida.')}>Probar conexión MOCK</button>
          <button disabled={busy || settings.provider !== 'MOCK'} onClick={() => act(() => whatsappRequest('/test', { method: 'post', body: { fail: true } }), 'Fallo de conexión MOCK simulado.')}>Simular conexión fallida</button>
          <button disabled={busy || !settings.provider} onClick={() => act(() => whatsappRequest('/disconnect', { method: 'post' }), 'WhatsApp desconectado.')}>Desconectar</button>
          <button onClick={() => setCredentials({ access_token: '', webhook_verification_token: '' })}>Actualizar credencial</button></div>
      </article>
      {settingsForm && <form className="wa-card" onSubmit={event => { event.preventDefault(); act(async () => { const result = await whatsappRequest('/settings', { method: 'patch', body: { ...settingsForm, provider: settingsForm.provider || null, global_daily_limit: settingsForm.global_daily_limit === '' ? null : Number(settingsForm.global_daily_limit), customer_daily_limit: settingsForm.customer_daily_limit === '' ? null : Number(settingsForm.customer_daily_limit) } }); setSettingsForm(null); return result; }, 'Configuración guardada.'); }}>
        <h2>Configuración del canal</h2><div className="wa-grid">{Object.entries({ provider: 'Proveedor', number: 'Número', phone_number_id: 'Phone number ID', business_account_id: 'Business account ID', global_daily_limit: 'Máximo global diario', customer_daily_limit: 'Máximo por cliente/día' }).map(([key, label]) => <label key={key}>{label}{key === 'provider' ? <select aria-label={label} value={settingsForm[key]} onChange={event => setSettingsForm({ ...settingsForm, [key]: event.target.value })}><option value="">No configurado</option><option value="MOCK">MOCK · pruebas internas</option><option value="WHATSAPP_CLOUD_API">WhatsApp Cloud API · integración pendiente</option></select> : <input type={key.includes('limit') ? 'number' : 'text'} min={key.includes('limit') ? 1 : undefined} maxLength={100} value={settingsForm[key]} onChange={event => setSettingsForm({ ...settingsForm, [key]: event.target.value })} />}</label>)}</div>
        <p>Define límites expresamente. No hay valores comerciales predeterminados. Horarios y días se configuran por etapa.</p><button disabled={busy}>Guardar configuración</button><button type="button" onClick={() => setSettingsForm(null)}>Cancelar</button>
      </form>}
      {credentials && <form className="wa-card" onSubmit={event => { event.preventDefault(); act(async () => { const result = await whatsappRequest('/settings', { method: 'patch', body: { credentials } }); setCredentials(null); return result; }, 'Credencial actualizada de forma segura.'); }}><h2>Actualizar credencial</h2><p>El servidor requiere una clave de cifrado configurada. La API real todavía no se conecta.</p>{Object.entries({ access_token: 'Access token', webhook_verification_token: 'Webhook verification token' }).map(([key, label]) => <label key={key}>{label}<input type="password" required autoComplete="new-password" value={credentials[key]} onChange={event => setCredentials({ ...credentials, [key]: event.target.value })} /></label>)}<button disabled={busy}>Guardar credencial</button><button type="button" onClick={() => setCredentials(null)}>Cancelar</button></form>}
    </>}
    {data && tab === 'Plantillas' && <><p>Se reutiliza el catálogo existente. Los ejemplos sin aprobación comercial deben identificarse como DEMO / BORRADOR.</p><MessageTemplates /></>}
    {data && tab === 'Automatizaciones' && <>
      <article className="wa-card"><h2>Automatizaciones por etapa</h2>{!connected && <p role="status">Automatización no disponible: WhatsApp no está conectado.</p>}<p>El motor de cobranza determina la etapa. El canal selecciona la regla y prepara la cola.</p><p>Reintentos: máximo 3 intentos, separados por 15 minutos. Zona horaria: America/Bogota.</p>
        <button disabled={busy || (!connected && !settings.automations_enabled)} onClick={() => act(() => whatsappRequest('/settings', { method: 'patch', body: { automations_enabled: !settings.automations_enabled } }), 'Estado de automatizaciones actualizado.')}>{settings.automations_enabled ? 'Desactivar automatizaciones' : 'Activar automatizaciones MOCK'}</button>
        <Link to="/administracion/configuracion-cobranza">Revisar etapas del motor</Link></article>
      {!stages.length && <p>No hay etapas activas configuradas en el motor.</p>}{stages.map(stage => <RuleEditor key={`${stage.key}:${revision}`} stage={stage} rule={settings.rules.find(rule => rule.stage === stage.key)} templates={templates} busy={busy} connected={connected} save={(key, body) => act(() => whatsappRequest(`/automations/${encodeURIComponent(key)}`, { method: 'put', body }), 'Regla guardada.')} />)}
    </>}
    {data && tab === 'Mensajes' && <>
      <form className="wa-card" onSubmit={event => { event.preventDefault(); act(async () => { const result = await whatsappRequest('/test-configuration', { method: 'post', body: previewForm }); setPreview(result); }, 'Vista previa generada sin envío.'); }}>
        <h2>Preparar mensaje</h2><div className="wa-grid"><label>ID del cliente<input required value={previewForm.customer_id} onChange={event => { setPreviewForm({ ...previewForm, customer_id: event.target.value }); setPreview(null); }} /></label><label>Plantilla<select aria-label="Plantilla" required value={previewForm.template_id} onChange={event => { setPreviewForm({ ...previewForm, template_id: event.target.value }); setPreview(null); }}><option value="">Seleccionar plantilla</option>{templates.filter(template => template.status === 'active').map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label></div><button disabled={busy}>Probar configuración / vista previa</button>
        {preview && <article aria-label="Vista previa del mensaje"><h3>{preview.customer.name}</h3><p>Etapa: {stages.find(stage => stage.key === preview.stage)?.label || preview.stage || 'Sin etapa elegible'}</p><pre>{preview.content}</pre><dl>{preview.variables.map(variable => <div key={variable.name}><dt>{variable.name}</dt><dd>{variable.value ?? 'No disponible'}</dd></div>)}</dl>{!preview.can_prepare && <p role="alert">Información pendiente: {[...preview.missing_variables, ...preview.unsupported_variables].join(', ') || 'Revisa teléfono y contenido.'}</p>}
          <button type="button" disabled={busy || !preview.can_prepare} onClick={() => act(() => whatsappRequest('/queue', { method: 'post', body: { ...previewForm, mode: 'MANUAL' } }), 'Mensaje preparado en la cola. No se ha enviado.')}>Guardar en cola manual</button>
          <button type="button" disabled={busy || !settings.automations_enabled} onClick={() => act(() => whatsappRequest('/queue', { method: 'post', body: { customer_id: previewForm.customer_id, mode: 'AUTOMATICO' } }), 'Regla automática evaluada por el motor y mensaje preparado.')}>Generar cola automática MOCK</button>
        </article>}
      </form>
      <article className="wa-card"><h2>Cola e historial de mensajes</h2><div className="wa-grid wa-filters">{Object.entries({ customer_id: 'Filtrar cliente ID', template_id: 'Filtrar plantilla', stage: 'Filtrar etapa', status: 'Filtrar estado', date_from: 'Desde', date_to: 'Hasta' }).map(([key, label]) => <label key={key}>{label}{['status', 'stage', 'template_id'].includes(key) ? <select aria-label={label} value={filters[key]} onChange={event => changeFilter(key, event.target.value)}><option value="">Todos</option>{(key === 'status' ? Object.entries(stateLabels) : key === 'stage' ? stages.map(stage => [stage.key, stage.label]) : templates.map(template => [template.id, template.name])).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select> : <input type={key.includes('date') ? 'date' : 'text'} value={filters[key]} onChange={event => changeFilter(key, event.target.value)} />}</label>)}</div>
        {!messages.messages.length ? <p>No hay mensajes para estos filtros.</p> : <div className="wa-table"><table><thead><tr><th>Cliente / plantilla</th><th>Estado / fechas</th><th>Contenido / proveedor</th><th>Pruebas MOCK</th></tr></thead><tbody>{messages.messages.map(message => <tr key={message.id}><td><strong>{message.customer_name}</strong><p>{message.template_name || 'Respuesta recibida'}</p><small>{stages.find(stage => stage.key === message.stage)?.label || message.stage || 'Respuesta'} · WhatsApp · {message.direction === 'inbound' ? 'Entrante' : 'Saliente'}</small></td><td><strong>{stateLabels[message.status] || message.status}</strong><p>Creación: {time(message.created_at)}</p><p>Programado: {time(message.scheduled_at)}</p><p>Envío: {time(message.sent_at)}</p><p>Entrega: {time(message.delivered_at)} · Lectura: {time(message.read_at)}</p><p>Intentos: {message.attempts}</p>{message.next_attempt_at && <p>Reintento: {time(message.next_attempt_at)}</p>}</td><td><p className="wa-content">{message.content}</p><small>{message.provider || 'Sin proveedor'} · {message.provider_message_id || 'Sin ID externo'}</small>{message.error_message && <p className="wa-error">{message.error_code}: {message.error_message}</p>}</td><td>{message.direction === 'outbound' && <div className="wa-actions">{['PENDING', 'FAILED'].includes(message.status) && <><button disabled={busy} onClick={() => act(() => whatsappRequest(`/messages/${message.id}/mock-send`, { method: 'post', body: {} }), 'Procesamiento MOCK completado; consulta el estado del mensaje.')}>Simular envío {message.id}</button><button disabled={busy} onClick={() => act(() => whatsappRequest(`/messages/${message.id}/mock-send`, { method: 'post', body: { fail: true } }), 'Fallo MOCK simulado; consulta el estado del mensaje.')}>Simular fallo {message.id}</button><button disabled={busy} onClick={() => act(() => whatsappRequest(`/messages/${message.id}/cancel`, { method: 'post' }), 'Mensaje cancelado.')}>Cancelar {message.id}</button></>}{['SENT', 'DELIVERED'].includes(message.status) && <>{message.status === 'SENT' && <button disabled={busy} onClick={() => act(() => whatsappRequest(`/messages/${message.id}/mock-delivery`, { method: 'post', body: { status: 'DELIVERED' } }), 'Entrega MOCK registrada.')}>Simular entrega {message.id}</button>}<button disabled={busy} onClick={() => act(() => whatsappRequest(`/messages/${message.id}/mock-delivery`, { method: 'post', body: { status: 'READ' } }), 'Lectura MOCK registrada.')}>Simular lectura {message.id}</button></>}</div>}</td></tr>)}</tbody></table></div>}
        <div className="wa-actions"><button disabled={busy || filters.page <= 1} onClick={() => setFilters({ ...filters, page: filters.page - 1 })}>Anterior</button><span>Página {messages.page}</span><button disabled={busy || !messages.has_next} onClick={() => setFilters({ ...filters, page: filters.page + 1 })}>Siguiente</button><button onClick={() => setRevision(value => value + 1)}>Actualizar mensajes</button></div>
      </article>
      <form className="wa-card" onSubmit={event => { event.preventDefault(); act(() => whatsappRequest('/mock-incoming', { method: 'post', body: { ...incoming, received_at: new Date().toISOString() } }), 'Respuesta MOCK registrada sin responder automáticamente.'); }}><h2>Simular respuesta entrante</h2><div className="wa-grid"><label>Teléfono del cliente<input required value={incoming.phone} onChange={event => setIncoming({ ...incoming, phone: event.target.value })} /></label><label>ID de mensaje MOCK<input required placeholder="mock:respuesta-1" value={incoming.provider_message_id} onChange={event => setIncoming({ ...incoming, provider_message_id: event.target.value })} /></label></div><label>Respuesta<textarea required value={incoming.content} onChange={event => setIncoming({ ...incoming, content: event.target.value })} /></label><button disabled={busy}>Registrar respuesta MOCK</button></form>
    </>}
    {data && tab === 'Historial' && <article className="wa-card"><h2>Auditoría administrativa y de mensajes</h2><p>Consulta los cambios administrativos y el seguimiento de mensajes. La línea de tiempo de cada cliente reúne sus gestiones, promesas y mensajes.</p>{!audit.length ? <p>No hay eventos registrados.</p> : <ol>{audit.map(event => <li key={event.id}><strong>{auditLabels[event.action] || event.action}</strong> · {entityLabels[event.entity_type] || event.entity_type} #{event.entity_id} · {time(event.created_at)}</li>)}</ol>}</article>}
  </section>;
}
