import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import { sendMetaTestMessage, whatsappRequest } from '../../services/whatsappCenter.service';
import { getMessageTemplateAdminData } from '../../services/messageTemplatesAdmin.service';
import MessageTemplates from './MessageTemplates';
import WhatsAppConversations from './WhatsAppConversations';
import WhatsAppAutomationPreview from './WhatsAppAutomationPreview';
import { useAppDataMode } from '../../simulation/useAppDataMode';
import { simulationAvailable } from '../../simulation/store';
import WhatsAppManualSend from './WhatsAppManualSend';
import WhatsAppCustomerTimeline from './WhatsAppCustomerTimeline';
import './WhatsAppCenter.css';

const connectionLabels = { NOT_CONFIGURED: 'No conectado', CONFIGURED: 'Configurado · sin validar', CONNECTED: 'Conectado', DISCONNECTED: 'Desconectado', ERROR: 'Error de conexión' };
const stateLabels = { PENDING: 'Pendiente', PROCESSING: 'Solicitud enviada a Meta', SENT: 'Aceptado por Meta', DELIVERED: 'Entregado', READ: 'Leído', FAILED: 'Fallido', CANCELLED: 'Cancelado' };
const messageStateLabel = message => message?.status === 'SENT' && message.provider === 'MOCK' ? 'Enviado (MOCK)' : stateLabels[message?.status] || message?.status;
const auditLabels = { configure: 'Configuración actualizada', conversation_associated: 'Conversación vinculada a un cliente', disconnect: 'WhatsApp desconectado', test_connection: 'Prueba de conexión', automation_update: 'Regla de mensajería actualizada', created: 'Plantilla creada', updated: 'Plantilla modificada', activated: 'Plantilla activada', deactivated: 'Plantilla desactivada', queued: 'Mensaje en cola', cancelled: 'Mensaje cancelado', sent: 'Mensaje enviado (MOCK)', delivered: 'Mensaje entregado', read: 'Mensaje leído', failed: 'Mensaje fallido (MOCK)', incoming: 'Respuesta recibida' };
const entityLabels = { whatsapp_setting: 'WhatsApp', whatsapp_message: 'Mensaje', message_template: 'Plantilla' };
const time = value => value ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Bogota' }).format(new Date(value)) : '—';

export default function WhatsAppCenter({ chatOnly = false }) {
  const { permissions = [], user } = useAuth(); const authorized = permissions.includes('settings.manage');
  const { mode } = useAppDataMode();
  const canManageTemplates = permissions.includes('message_templates.manage');
  const [data, setData] = useState(null); const [templates, setTemplates] = useState([]); const [tab, setTab] = useState('Conexión');
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const [settingsForm, setSettingsForm] = useState(null); const [credentials, setCredentials] = useState(null);
  const [messages, setMessages] = useState({ messages: [], page: 1, has_next: false }); const [audit, setAudit] = useState([]);
  const [filters, setFilters] = useState({ customer_id: '', template_id: '', stage: '', status: '', date_from: '', date_to: '', page: 1 });
  const [incoming, setIncoming] = useState({ phone: '', content: '', provider_message_id: '' });
  const [metaTest, setMetaTest] = useState({ content: 'Prueba de conexión MERTEL WhatsApp.', confirmed: false });
  const [metaTemplates, setMetaTemplates] = useState(null);
  const [revision, setRevision] = useState(0);
  const operationPending = useRef(false);
  useEffect(() => {
    if (!authorized) return;
    const controller = new AbortController();
    Promise.all([whatsappRequest('', { signal: controller.signal }), !chatOnly && canManageTemplates ? getMessageTemplateAdminData({ signal: controller.signal }) : Promise.resolve({ templates: [] })]).then(([center, templateData]) => {
      if (!controller.signal.aborted) { setData(center); setTemplates(Array.isArray(templateData.templates) ? templateData.templates.filter(template => template && template.id != null) : []); }
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [authorized, canManageTemplates, chatOnly, revision]);
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
  const metaConfigured = settings?.provider === 'WHATSAPP_CLOUD_API';
  const allowMock = simulationAvailable && !metaConfigured;
  const metaTestMode = metaConfigured && settings?.test_mode;
  function changeFilter(key, value) { setFilters(current => ({ ...current, [key]: value, page: 1 })); }
  if (!authorized) return <section className="wa-center"><h1>Centro de WhatsApp MERTEL</h1><p role="alert">No tienes permiso para configurar WhatsApp.</p></section>;
  if (chatOnly) return <section className="wa-center wa-center-expanded">
    {error && <p role="alert" className="wa-error">{error}</p>}
    {settings ? <WhatsAppConversations key={`${mode}:${user?.id ?? 'admin'}`} settings={settings}
      conversationCustomers={data.conversation_customers} chatOnly preferenceOwner={user?.id} /> : !error && <p role="status">Cargando WhatsApp…</p>}
  </section>;
  return <section className="wa-center"><header><span>Administración de MERTEL</span><h1>Centro de WhatsApp</h1><p>Atiende conversaciones y consulta el contexto de cada cliente.</p><p className="wa-banner">{mode === 'SIMULATION' ? 'MODO SIMULACIÓN · Datos locales de demostración · ningún envío real' : metaTestMode ? 'WhatsApp Cloud API · envíos al número de prueba autorizado' : metaConfigured ? 'WhatsApp Cloud API · ' + (connected && settings.real_sending_enabled ? 'respuestas manuales activas' : 'respuestas manuales no disponibles') : allowMock ? 'Proveedor MOCK · pruebas internas · ningún envío real' : 'Conexión real con Meta no disponible'}</p></header>
    <nav aria-label="Secciones de WhatsApp">{['Conexión', 'Plantillas', 'Automatizaciones', 'Mensajes', 'Historial', 'Envío manual', 'Timeline'].map(item => <button key={item} aria-pressed={tab === item} onClick={() => { setTab(item); setError(''); setNotice(''); if (item !== 'Plantillas') setRevision(value => value + 1); }}>{item}</button>)}</nav>
    {error && <p className="wa-error" role="alert">{error}</p>}{notice && <p role="status" className="wa-success">{notice}</p>}
    {!data && <p role="status">{error ? 'Configuración no disponible.' : 'Cargando configuración…'} <button onClick={() => { setError(''); setRevision(value => value + 1); }}>Reintentar</button></p>}
    {data && tab === 'Conexión' && <>
      <article className="wa-card"><h2>Estado de conexión</h2><p className={`wa-state ${connected ? 'connected' : ''}`}>{connectionLabels[settings.connection_status] || 'Estado desconocido'}</p>
        <dl><dt>Proveedor</dt><dd>{(metaConfigured || allowMock) && settings.provider || 'No configurado'}</dd><dt>Número</dt><dd>{settings.number || 'No configurado'}</dd><dt>Automatizaciones</dt><dd>{settings.automations_enabled && (metaConfigured || allowMock) ? (metaConfigured ? 'Activadas · WhatsApp' : 'Activadas · MOCK') : 'Desactivadas'}</dd><dt>Credencial</dt><dd>{metaConfigured && connected ? 'Validada por Meta' : settings.credentials_configured ? '••••••••••••••••' : 'No configurada'}</dd></dl>
        <div className="wa-actions"><button disabled={busy} onClick={() => setSettingsForm({ provider: settings.provider || '', number: settings.number, phone_number_id: settings.phone_number_id, business_account_id: settings.business_account_id, global_daily_limit: settings.global_daily_limit ?? '', customer_daily_limit: settings.customer_daily_limit ?? '' })}>Configurar WhatsApp</button>
          {(metaConfigured || allowMock) && <button disabled={busy || !settings.provider} onClick={() => act(() => whatsappRequest('/test', { method: 'post', body: {} }), metaConfigured ? 'Conexión con Meta validada.' : 'Prueba MOCK completada. Configuración válida.')}>Probar conexión {metaConfigured ? 'Meta' : 'MOCK'}</button>}
          {settings.provider === 'WHATSAPP_CLOUD_API' && <button disabled={busy} onClick={() => act(async () => { const result = await whatsappRequest('/meta/templates'); setMetaTemplates(result.templates || []); return result; }, 'Plantillas oficiales consultadas desde Meta. No se modificó el catálogo interno.')}>Consultar plantillas Meta</button>}
          {allowMock && <button disabled={busy || settings.provider !== 'MOCK'} onClick={() => act(() => whatsappRequest('/test', { method: 'post', body: { fail: true } }), 'Fallo de conexión MOCK simulado.')}>Simular conexión fallida</button>}
          <button disabled={busy || !settings.provider} onClick={() => act(() => whatsappRequest('/disconnect', { method: 'post' }), 'WhatsApp desconectado.')}>Desconectar</button>
          {allowMock && <button onClick={() => setCredentials({ access_token: '', webhook_verification_token: '' })}>Actualizar credencial</button>}</div>
      </article>
      {settingsForm && <form className="wa-card" onSubmit={event => { event.preventDefault(); act(async () => { const result = await whatsappRequest('/settings', { method: 'patch', body: { ...settingsForm, provider: settingsForm.provider || null, global_daily_limit: settingsForm.global_daily_limit === '' ? null : Number(settingsForm.global_daily_limit), customer_daily_limit: settingsForm.customer_daily_limit === '' ? null : Number(settingsForm.customer_daily_limit) } }); setSettingsForm(null); return result; }, 'Configuración guardada.'); }}>
        <h2>Configuración del canal</h2><div className="wa-grid">{Object.entries({ provider: 'Proveedor', number: 'Número', phone_number_id: 'Phone number ID', business_account_id: 'Business account ID', global_daily_limit: 'Máximo global diario', customer_daily_limit: 'Máximo por cliente/día' }).map(([key, label]) => <label key={key}>{label}{key === 'provider' ? <select aria-label={label} value={settingsForm[key]} onChange={event => setSettingsForm({ ...settingsForm, [key]: event.target.value })}><option value="">No configurado</option>{allowMock && <option value="MOCK">MOCK · pruebas internas</option>}<option value="WHATSAPP_CLOUD_API">WhatsApp Cloud API · solo configuración por entorno</option></select> : <input type={key.includes('limit') ? 'number' : 'text'} min={key.includes('limit') ? 1 : undefined} maxLength={100} value={settingsForm[key]} onChange={event => setSettingsForm({ ...settingsForm, [key]: event.target.value })} />}</label>)}</div>
        <p>Define límites expresamente. No hay valores comerciales predeterminados. Horarios y días se configuran por etapa.</p><button disabled={busy}>Guardar configuración</button><button type="button" onClick={() => setSettingsForm(null)}>Cancelar</button>
      </form>}
      {credentials && <form className="wa-card" onSubmit={event => { event.preventDefault(); act(async () => { const result = await whatsappRequest('/settings', { method: 'patch', body: { credentials } }); setCredentials(null); return result; }, 'Credencial actualizada de forma segura.'); }}><h2>Actualizar credencial</h2><p>Solo para MOCK; las credenciales de Meta se definen exclusivamente en el entorno seguro del backend.</p>{Object.entries({ access_token: 'Access token', webhook_verification_token: 'Webhook verification token' }).map(([key, label]) => <label key={key}>{label}<input type="password" required autoComplete="new-password" value={credentials[key]} onChange={event => setCredentials({ ...credentials, [key]: event.target.value })} /></label>)}<button disabled={busy}>Guardar credencial</button><button type="button" onClick={() => setCredentials(null)}>Cancelar</button></form>}
      {metaTestMode && <form className="wa-card" onSubmit={event => { event.preventDefault(); if (!metaTest.confirmed) { setError('Confirma el envío al número de prueba autorizado.'); return; } act(async () => { const result = await sendMetaTestMessage(metaTest.content); setMetaTest({ content: '', confirmed: false }); return result; }, 'Meta aceptó la solicitud. El estado final llegará por webhook.'); }}><h2>Envíos reales de prueba</h2><p>Destino autorizado por el backend: <strong>{settings.test_allowed_recipient}</strong>. Hasta 3 pruebas por día. No se pueden seleccionar clientes, archivos, campañas ni automatizaciones.</p><label>Mensaje de prueba<textarea maxLength={4096} value={metaTest.content} onChange={event => setMetaTest({ ...metaTest, content: event.target.value })} /></label><label><input type="checkbox" checked={metaTest.confirmed} onChange={event => setMetaTest({ ...metaTest, confirmed: event.target.checked })} /> Confirmo este envío al destinatario autorizado.</label><button className="wa-primary" disabled={busy || !connected || !metaTest.confirmed || !metaTest.content.trim()}>Enviar prueba a {settings.test_allowed_recipient}</button></form>}
      {metaTemplates && <article className="wa-card"><h2>Plantillas oficiales de Meta</h2><p>Estas plantillas son externas al catálogo interno de MERTEL. Solo las que estén aprobadas podrán utilizarse cuando se habilite su flujo manual validado.</p>{!metaTemplates.length ? <p>No hay plantillas disponibles.</p> : <div className="wa-table"><table><thead><tr><th>Nombre</th><th>Idioma</th><th>Categoría</th><th>Estado</th></tr></thead><tbody>{metaTemplates.map(template => <tr key={`${template.name}-${template.language}`}><td>{template.name}</td><td>{template.language}</td><td>{template.category || '—'}</td><td>{template.status}</td></tr>)}</tbody></table></div>}</article>}
    </>}
    {data && tab === 'Envío manual' && (metaConfigured
      ? <article className="wa-card"><h2>Enviar desde el chat</h2><p>Selecciona un cliente y abre Enviar aviso de facturas para revisar el mensaje antes de enviarlo.</p><Link to="/administracion/whatsapp">Ir a conversaciones</Link></article>
      : allowMock ? <WhatsAppManualSend templates={templates} settings={settings} /> : <p role="alert">Conecta WhatsApp en la pestaña Conexión para enviar mensajes.</p>)}
    {data && tab === 'Timeline' && <WhatsAppCustomerTimeline />}
    {data && tab === 'Plantillas' && <><p>Se reutiliza el catálogo existente. Los ejemplos sin aprobación comercial deben identificarse como DEMO / BORRADOR.</p><MessageTemplates /></>}
    {data && tab === 'Automatizaciones' && <WhatsAppAutomationPreview templates={templates} settings={settings} busy={busy} act={act} revision={revision} />}
    {data && tab === 'Mensajes' && <>
      <article className="wa-card"><h2>Cola e historial de mensajes</h2><div className="wa-grid wa-filters">{Object.entries({ customer_id: 'Filtrar cliente ID', template_id: 'Filtrar plantilla', stage: 'Filtrar etapa', status: 'Filtrar estado', date_from: 'Desde', date_to: 'Hasta' }).map(([key, label]) => <label key={key}>{label}{['status', 'stage', 'template_id'].includes(key) ? <select aria-label={label} value={filters[key]} onChange={event => changeFilter(key, event.target.value)}><option value="">Todos</option>{(key === 'status' ? Object.entries(stateLabels) : key === 'stage' ? stages.map(stage => [stage.key, stage.label]) : templates.map(template => [template.id, template.name])).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select> : <input type={key.includes('date') ? 'date' : 'text'} value={filters[key]} onChange={event => changeFilter(key, event.target.value)} />}</label>)}</div>
        {!messages.messages.length ? <p>No hay mensajes para estos filtros.</p> : <div className="wa-table"><table><thead><tr><th>Cliente / plantilla</th><th>Estado / fechas</th><th>Contenido / proveedor</th><th>Acciones</th></tr></thead><tbody>{messages.messages.map(message => <tr key={message.id} data-message-id={message.id}><td><strong>{message.customer_name}</strong><p>{message.template_name || 'Respuesta recibida'}</p><small>{stages.find(stage => stage.key === message.stage)?.label || message.stage || 'Respuesta'} · WhatsApp · {message.direction === 'inbound' ? 'Entrante' : 'Saliente'}</small></td><td><strong>{messageStateLabel(message)}</strong><p>Creación: {time(message.created_at)}</p><p>Programado: {time(message.scheduled_at)}</p><p>Envío: {time(message.sent_at)}</p><p>Entrega: {time(message.delivered_at)} · Lectura: {time(message.read_at)}</p><p>Intentos: {message.attempts}</p>{message.next_attempt_at && <p>Reintento: {time(message.next_attempt_at)}</p>}</td><td><p className="wa-content">{message.content}</p><small>{message.provider || 'Sin proveedor'} · {message.provider_message_id || 'Sin ID externo'}</small>{message.error_message && <p className="wa-error">{message.error_code}: {message.error_message}</p>}</td><td>{message.direction === 'outbound' && metaConfigured && message.provider === 'WHATSAPP_CLOUD_API' && message.status === 'PENDING' && <button disabled={busy} onClick={() => act(() => whatsappRequest(`/messages/${message.id}/cancel`, { method: 'post' }), 'Mensaje cancelado.')}>Cancelar {message.id}</button>}{message.direction === 'outbound' && allowMock && <div className="wa-actions">{['PENDING', 'FAILED'].includes(message.status) && <><button disabled={busy} onClick={() => act(() => whatsappRequest(`/messages/${message.id}/mock-send`, { method: 'post', body: {} }), 'Procesamiento MOCK completado; consulta el estado del mensaje.')}>Simular envío {message.id}</button><button disabled={busy} onClick={() => act(() => whatsappRequest(`/messages/${message.id}/mock-send`, { method: 'post', body: { fail: true } }), 'Fallo MOCK simulado; consulta el estado del mensaje.')}>Simular fallo {message.id}</button><button disabled={busy} onClick={() => act(() => whatsappRequest(`/messages/${message.id}/cancel`, { method: 'post' }), 'Mensaje cancelado.')}>Cancelar {message.id}</button></>}{['SENT', 'DELIVERED'].includes(message.status) && <>{message.status === 'SENT' && <button disabled={busy} onClick={() => act(() => whatsappRequest(`/messages/${message.id}/mock-delivery`, { method: 'post', body: { status: 'DELIVERED' } }), 'Entrega MOCK registrada.')}>Simular entrega {message.id}</button>}<button disabled={busy} onClick={() => act(() => whatsappRequest(`/messages/${message.id}/mock-delivery`, { method: 'post', body: { status: 'READ' } }), 'Lectura MOCK registrada.')}>Simular lectura {message.id}</button></>}</div>}</td></tr>)}</tbody></table></div>}
        <div className="wa-actions"><button disabled={busy || filters.page <= 1} onClick={() => setFilters({ ...filters, page: filters.page - 1 })}>Anterior</button><span>Página {messages.page}</span><button disabled={busy || !messages.has_next} onClick={() => setFilters({ ...filters, page: filters.page + 1 })}>Siguiente</button><button onClick={() => setRevision(value => value + 1)}>Actualizar mensajes</button></div>
      </article>
      {allowMock && <form className="wa-card" onSubmit={event => { event.preventDefault(); act(() => whatsappRequest('/mock-incoming', { method: 'post', body: { ...incoming, received_at: new Date().toISOString() } }), 'Respuesta MOCK registrada sin responder automáticamente.'); }}><h2>Simular respuesta entrante</h2><div className="wa-grid"><label>Teléfono del cliente<input required value={incoming.phone} onChange={event => setIncoming({ ...incoming, phone: event.target.value })} /></label><label>ID de mensaje MOCK<input required placeholder="mock:respuesta-1" value={incoming.provider_message_id} onChange={event => setIncoming({ ...incoming, provider_message_id: event.target.value })} /></label></div><label>Respuesta<textarea required value={incoming.content} onChange={event => setIncoming({ ...incoming, content: event.target.value })} /></label><button disabled={busy}>Registrar respuesta MOCK</button></form>}
    </>}
    {data && tab === 'Historial' && <article className="wa-card"><h2>Auditoría administrativa y de mensajes</h2><p>Consulta los cambios administrativos y el seguimiento de mensajes. La línea de tiempo de cada cliente reúne sus gestiones, promesas y mensajes.</p>{!audit.length ? <p>No hay eventos registrados.</p> : <ol>{audit.map(event => <li key={event.id}><strong>{auditLabels[event.action] || event.action}</strong> · {entityLabels[event.entity_type] || event.entity_type} #{event.entity_id} · {time(event.created_at)}</li>)}</ol>}</article>}
  </section>;
}
