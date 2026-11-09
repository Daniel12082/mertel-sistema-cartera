import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CheckCheck, MessageCircle, Search, Send, UserRound, ShieldCheck } from 'lucide-react';
import { getCustomers } from '../../services/customer.service';
import { whatsappRequest, sendMetaTestMessage, sendManualWhatsApp, sendConversationSimulation, associateConversationSimulation } from '../../services/whatsappCenter.service';
import WhatsAppQuickReplies from './WhatsAppQuickReplies';
import { WhatsAppAttachmentPicker, WhatsAppMediaPreview } from './WhatsAppMedia';
import { discardDraftMedia, temporaryWhatsAppMedia, MEDIA_UNAVAILABLE } from '../../services/whatsappMedia.service';
import { collectionResultsRequest } from '../../services/collectionResults.service';
import { useAppDataMode } from '../../simulation/useAppDataMode';
import { buildConversations, conversationMessageStatus, messageTime, phoneKey, conversationStatus } from './whatsappConversation.presentation';
import './WhatsAppConversations.css';

const time = value => value && Number.isFinite(new Date(value).getTime()) ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Bogota' }).format(new Date(value)) : 'Fecha no disponible';
const validAmount = value => typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value);
const money = value => !validAmount(value) ? 'No disponible' : new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(value));
const merge = (rows, more) => [...new Map([...rows, ...more].map(row => [String(row.id), row])).values()];
const checkMessages = (response, customerId) => {
  if (!response || !Array.isArray(response.messages) || response.messages.some(row => !row || row.id == null)) throw new Error('No se pudo interpretar el historial de mensajes.');
  if (customerId && response.messages.some(row => String(row.customer_id) !== customerId)) throw new Error('El historial no corresponde al cliente seleccionado.');
  return response;
};

function CustomerCard({ customer, context, sequence, lastContact, error, loading, retry }) {
  return <aside className="wa-inbox-profile" aria-label="Ficha del cliente"><div className="wa-profile-title"><UserRound size={19} /><h3>Ficha del cliente</h3></div>
    {!customer ? <p>Asocia esta conversación de forma explícita para consultar la cartera.</p> : <>
      <div className="wa-avatar large">{customer.name.slice(0, 2).toUpperCase()}</div><h3>{customer.name}</h3><p className="wa-muted">{customer.nit}</p>
      <dl><dt>Teléfono</dt><dd>{customer.phone || 'Sin teléfono registrado'}</dd><dt>Saldo pendiente</dt><dd className="wa-profile-balance">{money(context?.total_balance)}</dd></dl>
      {loading && <p role="status">Consultando cartera…</p>}{error && <div className="wa-warning" role="alert">{error}<button onClick={retry}>Reintentar cartera</button></div>}
      <dl><dt>Etapa de cobranza</dt><dd>{context?.collection_item?.stage_label || sequence?.stage_label || 'No disponible'}</dd>
        <dt>Último contacto</dt><dd>{lastContact ? `${time(lastContact.date)} · ${lastContact.label || 'WhatsApp'}` : 'Sin información disponible'}</dd>
        <dt>Próxima acción</dt><dd>{sequence?.next_contact ? `${sequence.next_contact.date?.slice(0, 10) || 'Sin fecha'} · ${sequence.next_contact.label}` : 'Sin acción informada'}</dd></dl>
      <h4>Facturas pendientes</h4>{context ? context.open_invoices.length ? <ul className="wa-profile-invoices">{context.open_invoices.map(invoice => <li key={invoice.invoice_id ?? invoice.id}><strong>{invoice.invoice_number}</strong><span>{money(invoice.balance)}</span><small>Vence: {invoice.due_date || 'No disponible'}</small></li>)}</ul> : <p>No hay facturas pendientes.</p> : <p>La cartera no está disponible.</p>}
    </>}
  </aside>;
}

function ChatMessages({ messages }) {
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [messages.length]);
  return <div className="wa-chat-messages" role="log" aria-label="Mensajes de la conversación" aria-live="polite">
    {!messages.length && <div className="wa-chat-empty"><MessageCircle size={32} /><h3>Una conversación por comenzar</h3><p>No hay mensajes registrados para este cliente.</p></div>}
    {messages.map(message => <article key={message.id} className={`wa-chat-bubble ${message.direction === 'inbound' ? 'incoming' : 'outgoing'}`} aria-label={`${message.direction === 'inbound' ? 'Mensaje entrante' : 'Mensaje saliente'} ${message.id}`}>
      {message.content && <p>{message.content}</p>}{message.attachment && <WhatsAppMediaPreview key={message.attachment.id} attachment={message.attachment} />}<footer><time>{time(messageTime(message))}</time><span>{message.attachment ? 'Multimedia simulada · sin entrega real' : conversationMessageStatus(message)}{message.status === 'READ' && <CheckCheck size={14} aria-hidden="true" />}</span></footer>
    </article>)}<div ref={end} />
  </div>;
}

export default function WhatsAppConversations({ settings, chatOnly = false, preferenceOwner }) {
  const { mode } = useAppDataMode(); const simulated = mode === 'SIMULATION';
  const metaConnected = !simulated && settings?.provider === 'WHATSAPP_CLOUD_API' && settings?.connection_status === 'CONNECTED';
  const metaProduction = metaConnected && settings.real_sending_enabled && !settings.test_mode;
  const preferenceKey = `mertel:wa-inbox:${mode}:${preferenceOwner ?? 'admin'}`;
  const [preferences, setPreferences] = useState(() => {
    if (!chatOnly) return {};
    try { return JSON.parse(localStorage.getItem(preferenceKey)) || {}; }
    catch { return {}; }
  });
  const [showRemoved, setShowRemoved] = useState(false);
  const [newChat, setNewChat] = useState(false);
  const [newNumber, setNewNumber] = useState('');
  const [newChatError, setNewChatError] = useState('');
  const newChatsKey = `mertel:wa-new-chats:${mode}:${preferenceOwner ?? 'admin'}`;
  const [newChats, setNewChats] = useState(() => {
    if (!chatOnly) return [];
    try {
      const saved = JSON.parse(localStorage.getItem(newChatsKey));
      return Array.isArray(saved) ? saved.filter(row => row && phoneKey(row.phone)) : [];
    } catch { return []; }
  });
  useEffect(() => {
    if (chatOnly) {
      try { localStorage.setItem(preferenceKey, JSON.stringify(preferences)); } catch { /* Storage can be disabled. */ }
    }
  }, [chatOnly, preferenceKey, preferences]);
  useEffect(() => {
    if (chatOnly) {
      try { localStorage.setItem(newChatsKey, JSON.stringify(newChats)); } catch { /* Storage can be disabled. */ }
    }
  }, [chatOnly, newChatsKey, newChats]);
  function updatePreference(key, patch) {
    setPreferences(current => ({ ...current, [key]: { ...current[key], ...patch } }));
  }
  const [customers, setCustomers] = useState([]), [records, setRecords] = useState([]);
  const [selection, setSelection] = useState(''), [search, setSearch] = useState(''), [filter, setFilter] = useState(''), [customerFilter, setCustomerFilter] = useState('');
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const [page, setPage] = useState(1), [hasNext, setHasNext] = useState(false);
  const [detail, setDetail] = useState({ messages: [], context: null, sequence: null, error: '', historyError: '', loading: false, page: 1, hasNext: false });
  const [drafts, setDrafts] = useState({}), [notice, setNotice] = useState(''), [sendError, setSendError] = useState('');
  const [previews, setPreviews] = useState({}), [quickBusy, setQuickBusy] = useState(false);
  const [attachments, setAttachments] = useState({}), [mediaBusy, setMediaBusy] = useState(false);
  const draftMedia = useRef({});
  const [busy, setBusy] = useState(false), [mobile, setMobile] = useState('list'), [associateId, setAssociateId] = useState('');
  const [loadingMore, setLoadingMore] = useState(false); const pagePending = useRef(false);
  const pending = useRef(false), active = useRef(true), chosen = useRef('');
  const conversations = useMemo(() => {
    const newPhones = new Set(newChats.map(row => phoneKey(row.phone)).filter(Boolean));
    const rows = buildConversations(customers, records).map(row => {
      const phone = phoneKey(row.phone);
      // Keep the draft and selection when a new number first appears in the message history.
      return !row.customer && newPhones.has(phone) ? { ...row, key: `unlinked:new:${phone}` } : row;
    });
    const existing = new Set(rows.map(row => phoneKey(row.phone)));
    for (const phone of newPhones) {
      if (existing.has(phone)) continue;
      rows.push({ key: `unlinked:new:${phone}`, customer: null, name: 'Nuevo chat', phone: `+${phone}`, nit: '', candidates: [], messages: [], last: null });
    }
    return rows;
  }, [customers, records, newChats]);
  const conversation = conversations.find(row => row.key === selection) || null;
  const customerId = conversation?.customer ? String(conversation.customer.id) : '';
  const filtered = conversations.filter(row => (!chatOnly || Boolean(preferences[row.key]?.removed) === showRemoved) && (!customerFilter || String(row.customer?.id) === customerFilter) && (!filter || (filter === 'empty' ? !row.last : filter === 'history' ? Boolean(row.last) : row.last?.status === filter)) &&
    `${row.name} ${row.nit} ${row.phone}`.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim())).sort((a, b) => Number(Boolean(preferences[b.key]?.pinned)) - Number(Boolean(preferences[a.key]?.pinned)));
  const messages = merge(conversation?.messages || [], detail.messages).sort((a, b) => (new Date(messageTime(a)).getTime() || 0) - (new Date(messageTime(b)).getTime() || 0));
  const latestContact = messages.filter(row => row.direction === 'inbound' ? Boolean(row.received_at) : Boolean(row.sent_at)).at(-1);
  const lastContact = latestContact ? { date: messageTime(latestContact), label: latestContact.direction === 'inbound' ? 'Mensaje recibido' : latestContact.template_name || 'WhatsApp' } : detail.sequence?.last_contact;
  const recipient = phoneKey(conversation?.phone);
  const metaTestChat = metaConnected && settings.test_mode && Boolean(recipient) && recipient === phoneKey(settings.test_allowed_recipient);
  const draft = drafts[selection] || '';
  function hasOpenMetaWindow() {
    const now = Date.now();
    return messages.some(message => {
      if (message.provider !== 'WHATSAPP_CLOUD_API' || message.direction !== 'inbound' || phoneKey(message.recipient || message.phone) !== recipient) return false;
      const received = new Date(message.received_at).getTime();
      return received <= now && now - received < 24 * 60 * 60 * 1000;
    });
  }
  const canReplyToMeta = Boolean(recipient && (metaTestChat || metaProduction) && hasOpenMetaWindow());
  const canWriteMetaDraft = canReplyToMeta || (metaProduction && Boolean(recipient));
  const modeLabel = simulated ? 'Demo local' : metaProduction ? 'Meta conectada' : metaConnected ? settings.test_mode ? 'Meta conectada · prueba controlada' : 'Meta conectada · envío desactivado' : 'Proveedor MOCK · Meta pendiente';
  const modeNotice = simulated ? 'SIMULACIÓN — No se enviará ningún mensaje real'
    : metaProduction ? 'Puedes responder con texto durante las 24 horas siguientes al último mensaje recibido.'
    : metaConnected && settings.test_mode ? 'Puedes responder al número de prueba autorizado dentro de las 24 horas siguientes a su último mensaje.'
    : metaConnected ? 'El envío de mensajes está desactivado en la configuración del servidor.'
    : 'Meta no está conectado. La redacción libre está disponible únicamente en Modo Simulación.';
  const attachment = attachments[selection] || null;
  const preview = previews[selection];
  const unresolved = /\{\{[^}]*\}\}/.test(draft);
  const draftProblem = preview?.problem || (unresolved ? 'El mensaje contiene variables sin resolver. Selecciona una plantilla y revisa los datos pendientes.' : '');
  const realProblem = !simulated && preview && draft.trim() !== preview.content.trim() ? 'El envío manual actual requiere el texto validado de la plantilla. Vuelve a insertarla para enviar; el texto editado puede enviarse en Simulación.' : '';
  const canSend = Boolean(conversation?.customer && phoneKey(conversation.customer.phone) && (draft.trim() || attachment) && (!attachment || simulated && temporaryWhatsAppMedia.get(attachment)) && !draftProblem && !realProblem && !busy && !quickBusy && !mediaBusy &&
    (simulated || preview?.can_prepare && settings?.provider === 'MOCK' && settings?.connection_status === 'CONNECTED'));

  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => () => { Object.values(draftMedia.current).forEach(discardDraftMedia); }, []);
  function setAttachment(key, value) {
    discardDraftMedia(draftMedia.current[key]);
    draftMedia.current[key] = value;
    setAttachments(current => ({ ...current, [key]: value }));
  }
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([getCustomers(), whatsappRequest('/messages', { params: { page: 1 }, signal: controller.signal })]).then(([response, history]) => {
      if (!response.success || !Array.isArray(response.data) || response.data.some(row => !row || row.id == null)) throw new Error('No se pudieron interpretar los clientes.');
      checkMessages(history);
      if (!controller.signal.aborted) { setCustomers(response.data.filter(row => row.status === 'active' && !row.deleted_at)); setRecords(history.messages); setHasNext(Boolean(history.has_next)); setPage(1); }
    }).catch(() => { if (!controller.signal.aborted) setError('No se pudieron cargar las conversaciones. Revisa tu acceso e intenta nuevamente.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    if (!customerId) return;
    const controller = new AbortController();
    Promise.allSettled([
      whatsappRequest('/messages', { params: { customer_id: customerId, page: 1 }, signal: controller.signal }),
      collectionResultsRequest(`/customers/${encodeURIComponent(customerId)}/context`, { signal: controller.signal }),
      whatsappRequest(`/customers/${encodeURIComponent(customerId)}/sequence`, { signal: controller.signal }),
    ]).then(([history, financial, sequence]) => {
      if (controller.signal.aborted) return;
      let context = null, next = null, rows = [], profileError = '', historyError = '', more = false;
      if (history.status === 'fulfilled') { try { const checked = checkMessages(history.value, customerId); rows = checked.messages; more = Boolean(checked.has_next); } catch { historyError = 'No se pudo consultar el historial completo.'; } } else historyError = 'No se pudo consultar el historial completo.';
      if (financial.status === 'fulfilled' && financial.value && financial.value.customer && String(financial.value.customer.id) === customerId &&
        validAmount(financial.value.total_balance) && Array.isArray(financial.value.open_invoices) &&
        financial.value.open_invoices.every(row => row && (row.invoice_id != null || row.id != null) && (row.customer_id == null || String(row.customer_id) === customerId))) context = financial.value;
      else profileError = 'No se pudo consultar la cartera autorizada. El saldo no se sustituye por cero.';
      if (sequence.status === 'fulfilled' && sequence.value && sequence.value.customer && String(sequence.value.customer.id) === customerId) next = sequence.value;
      setDetail({ messages: rows, context, sequence: next, error: profileError, historyError, loading: false, page: 1, hasNext: more });
    });
    return () => controller.abort();
  }, [customerId, revision, chatOnly]);

  function choose(key) {
    if (chatOnly && preferences[key]?.unread) updatePreference(key, { unread: false });
    if (chosen.current === key) setRevision(value => value + 1);
    chosen.current = key; setSelection(key); setMobile('chat'); setNotice(''); setSendError(''); setAssociateId('');
    setQuickBusy(false);
    setMediaBusy(false);
    setDetail({ messages: [], context: null, sequence: null, error: '', historyError: '', loading: key.startsWith('customer:'), page: 1, hasNext: false });
  }
  async function loadMore(client) {
    if (pagePending.current) return;
    pagePending.current = true; setLoadingMore(true);
    const key = selection; setError('');
    try {
      const result = checkMessages(await whatsappRequest('/messages', { params: client ? { customer_id: customerId, page: detail.page + 1 } : { page: page + 1 } }), client ? customerId : null);
      if (!active.current || client && chosen.current !== key) return;
      if (client) setDetail(current => ({ ...current, messages: merge(current.messages, result.messages), page: current.page + 1, hasNext: Boolean(result.has_next) }));
      else { setRecords(current => merge(current, result.messages)); setPage(value => value + 1); setHasNext(Boolean(result.has_next)); }
    } catch { if (active.current) setError('No se pudieron cargar más mensajes. Intenta nuevamente.'); }
    finally { pagePending.current = false; if (active.current) setLoadingMore(false); }
  }
  async function send() {
    if (pending.current) return;
    if (metaConnected) {
      if (!canReplyToMeta || !hasOpenMetaWindow() || !draft.trim() || draft.length > 4096) return;
      if (metaTestChat && !window.confirm('¿Enviar este mensaje real al número de prueba autorizado?')) return;
    } else if (!canSend) return;
    const key = selection, id = customerId, content = draft; pending.current = true; setBusy(true); setSendError(''); setNotice('');
    try {
      const message = metaTestChat
        ? (await sendMetaTestMessage(content)).message
        : metaProduction
          ? (await whatsappRequest('/meta/replies', { method: 'post', body: { recipient: `+${recipient}`, content } })).message
          : simulated
          ? await sendConversationSimulation(id, content, attachment)
          : await sendManualWhatsApp({ customer_id: id, template_id: String(preview.template.id) });
      if (!active.current) return;
      setRecords(current => merge(current, [message]));
      if (['SENT', 'DELIVERED', 'READ'].includes(message.status)) {
        setDrafts(current => ({ ...current, [key]: '' }));
        setAttachment(key, null);
        setPreviews(current => ({ ...current, [key]: null }));
        if (chosen.current === key) setNotice(metaConnected ? 'Meta aceptó el mensaje. El estado de entrega se actualizará por webhook.' : attachment ? 'Mensaje multimedia simulado preparado correctamente. Ningún archivo fue enviado ni entregado realmente.' : simulated ? 'Mensaje simulado enviado correctamente. No se realizó ningún envío real.' : 'Mensaje enviado correctamente en el proveedor MOCK. No se realizó ningún envío real.');
      } else if (chosen.current === key) {
        if (message.status === 'FAILED') setSendError(message.error_message || 'El mensaje no se pudo enviar. Consulta el historial.');
        else setNotice('El mensaje sigue pendiente. No se ha confirmado el envío.');
      }
    } catch (failure) { if (active.current && chosen.current === key) setSendError(failure.message); }
    finally { pending.current = false; if (active.current) setBusy(false); }
  }
  async function associate() {
    if (pending.current || !conversation || !associateId || !simulated) return;
    const key = selection; pending.current = true; setBusy(true); setSendError('');
    try {
      await associateConversationSimulation(conversation.messages.map(row => row.id), associateId);
      if (active.current && chosen.current === key) { choose(`customer:${associateId}`); setRevision(value => value + 1); }
    } catch (failure) { if (active.current) setSendError(failure.message); }
    finally { pending.current = false; if (active.current) setBusy(false); }
  }
  function openNumber(event) {
    event.preventDefault();
    const phone = phoneKey(newNumber);
    if (!phone) { setNewChatError('Escribe un número válido con código de país.'); return; }
    const matches = conversations.filter(row => phoneKey(row.phone) === phone);
    const match = matches.length === 1 ? matches[0] : matches.find(row => !row.customer);
    if (match) {
      setShowRemoved(Boolean(preferences[match.key]?.removed));
      choose(match.key);
    } else {
      const formatted = `+${phone}`;
      setNewChats(current => current.some(row => phoneKey(row.phone) === phone) ? current : [...current, { phone: formatted, created_at: new Date().toISOString() }]);
      choose(`unlinked:new:${phone}`);
    }
    setNewChat(false); setNewNumber(''); setNewChatError('');
  }
  function removeConversation() {
    if (!window.confirm('¿Quitar este chat de la bandeja? Podrás recuperarlo en Chats quitados.')) return;
    updatePreference(selection, { removed: true, pinned: false });
    choose(''); setMobile('list');
  }
  return <section className="wa-inbox" aria-label="Bandeja de conversaciones">
    <header className="wa-inbox-heading"><div><span className="wa-eyebrow">ATENCIÓN A CLIENTES · MERTEL</span><h2>{chatOnly ? "WhatsApp" : "Conversaciones"}</h2><p>{chatOnly ? "Bandeja de conversaciones" : "Cada conversación, con el contexto de su cartera."}</p></div><span className="wa-inbox-mode"><ShieldCheck size={16} />{modeLabel}</span></header>
    <p className="wa-inbox-warning">{modeNotice}</p>
    {error && <div className="wa-error" role="alert">{error}<button onClick={() => { setError(''); setLoading(true); setRevision(value => value + 1); }}>Reintentar conversaciones</button></div>}
    <div className={`wa-inbox-layout mobile-${mobile}${chatOnly ? " wa-chat-only" : ""}`}>
      <aside className="wa-conversation-list" aria-label="Lista de conversaciones"><div className="wa-list-controls">
        {chatOnly && <>
          <div className="wa-inbox-actions">
            <button type="button" aria-expanded={newChat} onClick={() => { setNewChat(!newChat); setNewChatError(''); }}>Nuevo chat</button>
            <button type="button" aria-pressed={showRemoved} onClick={() => { setShowRemoved(!showRemoved); choose(''); setMobile('list'); }}>{showRemoved ? 'Volver a la bandeja' : 'Chats quitados'}</button>
          </div>
          {newChat && <form className="wa-new-chat" onSubmit={openNumber}>
            <label htmlFor="wa-new-number">Número de WhatsApp</label>
            <input id="wa-new-number" type="tel" placeholder="+57…" value={newNumber} onChange={event => setNewNumber(event.target.value)} required />
            <button type="submit">Iniciar chat</button>
            <small>El chat se crea en la bandeja. Podrás escribir el primer mensaje desde la conversación.</small>
            {newChatError && <p role="alert">{newChatError}</p>}
          </form>}
        </>}
        <label className="wa-inbox-search"><Search size={17} /><input aria-label="Buscar conversaciones" placeholder="Nombre, NIT o teléfono" value={search} onChange={event => setSearch(event.target.value)} /></label>
        <div className="wa-inbox-filters"><label>Cliente<select aria-label="Filtrar conversaciones por cliente" value={customerFilter} onChange={event => setCustomerFilter(event.target.value)}><option value="">Todos los clientes</option>{customers.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <label>Conversación<select aria-label="Filtrar conversaciones por estado" value={filter} onChange={event => setFilter(event.target.value)}><option value="">Todas</option><option value="history">Con mensajes recientes</option><option value="empty">Sin mensajes recientes</option>{Object.entries(conversationStatus).map(([key, label]) => <option key={key} value={key}>Último: {label}</option>)}</select></label></div></div>
        <div className="wa-conversation-scroll">{loading && <p role="status">Cargando conversaciones…</p>}{!loading && !filtered.length && <p className="wa-list-empty">No hay conversaciones para estos filtros.</p>}
          {filtered.map(row => <button key={row.key} className={`wa-conversation-item ${row.key === selection ? 'selected' : ''}`} aria-label={`Abrir conversación ${row.name}`} aria-pressed={row.key === selection} onClick={() => choose(row.key)}><span className="wa-avatar">{row.name.slice(0, 2).toUpperCase()}</span><span className="wa-conversation-text"><strong>{row.name}</strong>{preferences[row.key]?.pinned && <small>Fijado</small>}{preferences[row.key]?.unread && <small className="wa-inbox-unread">No leído</small>}<small>{row.phone || 'Sin teléfono'}</small><span>{row.last?.content || 'Sin mensajes recientes'}</span><small>{row.last ? time(messageTime(row.last)) : 'Sin fecha de contacto'}</small></span></button>)}
          {hasNext && <button className="wa-list-more" disabled={loadingMore} onClick={() => loadMore(false)}>Cargar más conversaciones</button>}</div>
      </aside>
      <main className="wa-chat" aria-label="Chat del cliente">
        {!conversation ? <div className="wa-chat-empty wa-chat-welcome"><MessageCircle size={44} /><h3>Tu bandeja de WhatsApp</h3><p>Selecciona una conversación para consultar los mensajes y la cartera del cliente.</p>{!metaConnected && <small>Sin conexión real con Meta</small>}</div> : <>
          <header className="wa-chat-header"><button className="wa-inbox-back" aria-label="Volver a conversaciones" onClick={() => setMobile('list')}><ArrowLeft size={18} /></button><span className="wa-avatar">{conversation.name.slice(0, 2).toUpperCase()}</span><div><strong>{conversation.name}</strong><small>{conversation.phone || 'Sin teléfono registrado'}</small></div><button className="wa-profile-toggle" onClick={() => setMobile(mobile === 'details' ? 'chat' : 'details')}><UserRound size={17} />{mobile === 'details' ? 'Volver al chat' : 'Ficha del cliente'}</button></header>
          {chatOnly && <div className="wa-inbox-actions wa-chat-actions" aria-label="Acciones de la conversación">
            {preferences[selection]?.removed ? <button type="button" onClick={() => { updatePreference(selection, { removed: false }); setShowRemoved(false); }}>Restaurar chat</button> : <>
              <button type="button" onClick={() => updatePreference(selection, { pinned: !preferences[selection]?.pinned })}>{preferences[selection]?.pinned ? 'Desfijar' : 'Fijar'}</button>
              <button type="button" onClick={() => updatePreference(selection, { unread: !preferences[selection]?.unread })}>{preferences[selection]?.unread ? 'Marcar como leído' : 'Marcar como no leído'}</button>
              <button type="button" onClick={removeConversation}>Quitar de la bandeja</button>
            </>}
          </div>}
          {!conversation.customer && <div className="wa-association"><p>{conversation.candidates.length > 1 ? 'Hay varios clientes con este teléfono. Selecciona explícitamente a quién pertenece esta conversación.' : 'No hay una identidad de cliente confirmada para esta conversación.'}</p>
            {simulated && conversation.candidates.length > 1 && <><label>Cliente para asociar<select aria-label="Cliente para asociar" value={associateId} onChange={event => setAssociateId(event.target.value)}><option value="">Seleccionar cliente</option>{conversation.candidates.map(row => <option key={row.id} value={row.id}>{row.name} · {row.nit}</option>)}</select></label><button disabled={busy || !associateId} onClick={associate}>Asociar en esta demo</button></>}
          </div>}
          {detail.historyError && <p className="wa-warning" role="alert">{detail.historyError}<button onClick={() => setRevision(value => value + 1)}>Reintentar historial</button></p>}
          {detail.hasNext && <button className="wa-chat-more" disabled={loadingMore} onClick={() => loadMore(true)}>Cargar mensajes anteriores</button>}
          <ChatMessages messages={messages} />
          {metaConnected ? <form className="wa-chat-compose" onSubmit={event => { event.preventDefault(); void send(); }}>
            {notice && <p className="wa-success" role="status">{notice}</p>}
            {sendError && <p className="wa-error" role="alert">{sendError}</p>}
            {canWriteMetaDraft ? <>
              <label htmlFor="wa-meta-reply">{metaTestChat ? 'Respuesta de prueba por WhatsApp' : 'Mensaje de WhatsApp'}</label>
              <div>
                <textarea id="wa-meta-reply" value={draft} maxLength={4096} disabled={busy} placeholder="Escribe un mensaje…"
                  aria-describedby={canReplyToMeta ? undefined : 'wa-meta-draft-note'}
                  onChange={event => setDrafts(current => ({ ...current, [selection]: event.target.value }))} />
                <button type="submit" disabled={busy || !canReplyToMeta || !draft.trim()}><Send size={18} />{busy ? 'Enviando…' : metaTestChat ? 'Enviar prueba por WhatsApp' : 'Enviar mensaje'}</button>
              </div>
              {!canReplyToMeta && <small id="wa-meta-draft-note">Puedes dejar el mensaje escrito. Cuando el contacto te escriba, actualiza la conversación para enviarlo. Para iniciar el chat, Meta requiere una plantilla aprobada.</small>}
              {!canReplyToMeta && <div className="wa-chat-draft-actions">
                <button type="button" disabled={loading} onClick={() => { setError(''); setLoading(true); setRevision(value => value + 1); }}>
                  {loading ? 'Actualizando…' : 'Actualizar conversación'}
                </button>
              </div>}
              {metaTestChat && <small>Comparte el límite diario de 3 pruebas con la pestaña Conexión.</small>}
            </> : <p>{metaProduction ? 'Esta conversación no tiene un número de WhatsApp válido.' : metaTestChat ? 'Pide al destinatario de prueba que escriba al número de MERTEL para abrir una ventana de respuesta.' : modeNotice}</p>}
          </form> : <form className="wa-chat-compose" onSubmit={event => { event.preventDefault(); void send(); }}>
            {conversation.customer && !phoneKey(conversation.customer.phone) && <p className="wa-warning">Este cliente no tiene un número de WhatsApp válido. No se puede simular el envío.</p>}
            {notice && <p className="wa-success" role="status">{notice}</p>}{sendError && <p className="wa-error" role="alert">{sendError}</p>}
            {draftProblem && <p className="wa-warning" role="alert">{draftProblem}</p>}{realProblem && <p className="wa-warning" role="alert">{realProblem}</p>}
            <WhatsAppAttachmentPicker key={`media:${selection}:${mode}`} value={attachment} onChange={value => setAttachment(selection, value)} onPending={setMediaBusy} disabled={!conversation.customer || !phoneKey(conversation.customer.phone) || busy || quickBusy} />
            {attachment && <p className="wa-warning wa-media-notice">{simulated ? 'Archivo temporal · prueba local de preparación; sin envío ni entrega real.' : MEDIA_UNAVAILABLE}</p>}
            <label htmlFor="wa-conversation-draft">Mensaje {simulated ? 'de demostración' : '· plantilla manual MOCK'}</label><div>
              <WhatsAppQuickReplies key={`${selection}:${mode}`} customerId={customerId} simulated={simulated} value={draft} disabled={!conversation.customer || !phoneKey(conversation.customer.phone) || (!chatOnly && Boolean(detail.error)) || busy}
                onPending={setQuickBusy} onChange={value => { setDrafts(current => ({ ...current, [selection]: value })); if (!value) setPreviews(current => ({ ...current, [selection]: null })); }}
                onInsert={(value, rendered) => { setDrafts(current => ({ ...current, [selection]: value })); setAttachment(selection, rendered.attachment || null); setPreviews(current => ({ ...current, [selection]: rendered })); setSendError(''); }} />
              <button type="submit" aria-label={simulated ? 'Simular envío del mensaje' : 'Enviar mensaje con proveedor MOCK'} disabled={!canSend}><Send size={18} />{busy ? 'Enviando…' : simulated ? 'Simular envío' : 'Enviar con MOCK'}</button></div>
            <small>{simulated ? 'SIMULACIÓN — No se enviará ningún mensaje real' : 'Envío manual de plantillas · Proveedor MOCK; credenciales de Meta pendientes.'} · Escribe / para ver las plantillas.</small>
          </form>}
        </>}
      </main>
      <CustomerCard customer={conversation?.customer} context={detail.context} sequence={detail.sequence} lastContact={lastContact} error={detail.error} loading={detail.loading} retry={() => { setDetail(current => ({ ...current, loading: true, error: '' })); setRevision(value => value + 1); }} />
    </div>
  </section>;
}
