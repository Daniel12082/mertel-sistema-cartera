import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

// Providers normalize transport details; credentials are always read from server-only env.
export class WhatsAppProvider {
  async sendMessage() { throw new Error('Provider method not implemented'); }
  async sendTemplateMessage(message) { return this.sendMessage(message); }
  async getConnectionStatus() { throw new Error('Provider method not implemented'); }
  async validateConnection() { throw new Error('Provider method not implemented'); }
  handleIncomingWebhook() { throw new Error('Provider method not implemented'); }
  handleDeliveryStatus() { throw new Error('Provider method not implemented'); }
}

const META_TEST_RECIPIENT = '+573173697659';
const GRAPH_HOST = 'https://graph.facebook.com';

export class MetaWhatsAppProvider extends WhatsAppProvider {
  constructor({ env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 12000 } = {}) {
    super();
    this.env = env;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.config = readMetaConfig(env);
  }

  async request(path, { method = 'GET', body, signal } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('timeout')), this.timeoutMs);
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', abort, { once: true });
    const multipart = body instanceof FormData;
    try {
      const response = await this.fetchImpl(`${GRAPH_HOST}/${this.config.version}/${path}`, {
        method, signal: controller.signal,
        headers: { Authorization: `Bearer ${this.config.accessToken}`, Accept: 'application/json', ...(body && !multipart ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: multipart ? body : JSON.stringify(body) } : {})
      });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { /* Provider response details are not logged or returned. */ }
      if (!response.ok || data?.error) {
        const error = data?.error || {};
        const code = response.status === 401 || response.status === 403 ? 'META_AUTH_FAILED' :
          response.status === 429 ? 'META_RATE_LIMITED' : `META_HTTP_${response.status}`;
        const safe = new Error(typeof error.error_user_msg === 'string' ? error.error_user_msg.slice(0, 500) : 'Meta rechazó la solicitud.');
        safe.code = typeof error.code === 'number' ? String(error.code) : code;
        safe.httpStatus = response.status;
        safe.retryAfter = response.headers.get('retry-after');
        throw safe;
      }
      return data || {};
    } catch (error) {
      if (error?.httpStatus) throw error;
      const safe = new Error(error?.name === 'AbortError' ? 'Tiempo de espera agotado al consultar Meta.' : 'No fue posible conectar con Meta.');
      safe.code = error?.name === 'AbortError' ? 'META_TIMEOUT' : 'META_NETWORK_ERROR';
      throw safe;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  }

  assertTestRecipient(value, { manual = false } = {}) {
    const configured = String(this.env.WHATSAPP_TEST_ALLOWED_RECIPIENTS || '').split(',').map(item => item.trim()).filter(Boolean);
    let recipient;
    try { recipient = normalizePhone(value); } catch { throw providerError('META_RECIPIENT_INVALID', 'Destinatario inválido.'); }
    if (this.env.WHATSAPP_TEST_MODE !== 'true') return recipient;
    let configuredRecipient = null;
    try { configuredRecipient = configured.length === 1 ? normalizePhone(configured[0]) : null; } catch { /* rejected below */ }
    const allowed = configuredRecipient === META_TEST_RECIPIENT;
    if (!allowed || recipient !== META_TEST_RECIPIENT || !manual) throw providerError('META_TEST_RECIPIENT_BLOCKED', 'El modo de pruebas solo permite un envío manual al destinatario de prueba autorizado.');
    return recipient;
  }

  async validateConnection() {
    const data = await this.request(`${this.config.phoneNumberId}?fields=display_phone_number,verified_name`);
    const phone = typeof data.display_phone_number === 'string' ? data.display_phone_number : null;
    return { status: 'CONNECTED', phone, verified_name: typeof data.verified_name === 'string' ? data.verified_name : null, provider: 'WHATSAPP_CLOUD_API' };
  }

  async getConnectionStatus() { return this.validateConnection(); }
  async getMessagingLimit() {
    const data = await this.request(`${this.config.phoneNumberId}?fields=whatsapp_business_manager_messaging_limit`);
    const tier = data.whatsapp_business_manager_messaging_limit;
    if (tier === 'TIER_UNLIMITED') return null;
    const limit = typeof tier === 'number' ? tier : Number(/^TIER_(\d+)$/.exec(tier)?.[1]);
    if (!Number.isSafeInteger(limit) || limit < 1) throw providerError('META_MESSAGING_LIMIT_UNKNOWN', 'Meta no devolvió el cupo de mensajería del portafolio.');
    return limit;
  }

  async listMessageTemplates() {
    const rows = [];
    let after = null;
    for (let page = 0; page < 20; page++) {
      const params = new URLSearchParams({ fields: 'name,status,category,language,components', limit: '100' });
      if (after) params.set('after', after);
      const data = await this.request(`${this.config.businessAccountId}/message_templates?${params}`);
      if (!Array.isArray(data.data)) throw providerError('META_INVALID_RESPONSE', 'Meta devolvió una lista de plantillas inválida.');
      rows.push(...data.data.map(normalizeMetaTemplate));
      after = data.paging?.cursors?.after || null;
      if (!data.paging?.next || !after) break;
    }
    return rows;
  }

  async sendMessage({ recipient, manual = false, payload, signal } = {}) {
    const to = this.assertTestRecipient(recipient, { manual });
    if (!payload || !['text', 'template', 'image', 'document', 'audio', 'video'].includes(payload.type)) throw providerError('META_MESSAGE_TYPE_UNSUPPORTED', 'Tipo de mensaje no habilitado.');
    const data = await this.request(`${this.config.phoneNumberId}/messages`, { method: 'POST', body: { messaging_product: 'whatsapp', recipient_type: 'individual', to: to.slice(1), ...payload }, signal });
    const message = data.messages?.[0];
    if (typeof message?.id !== 'string' || !message.id.startsWith('wamid.')) throw providerError('META_INVALID_RESPONSE', 'Meta no confirmó un identificador de mensaje.');
    // HTTP success means accepted by Meta, never delivered. Delivery comes only by webhook.
    return { accepted: true, status: 'SENT', provider: 'WHATSAPP_CLOUD_API', provider_message_id: message.id,
      response: { messaging_product: data.messaging_product || 'whatsapp', contacts: data.contacts || [], messages: [message] } };
  }

  async uploadMedia({ buffer, mime, name }) {
    const body = new FormData();
    body.append('messaging_product', 'whatsapp');
    body.append('file', new Blob([buffer], { type: mime }), name);
    const data = await this.request(`${this.config.phoneNumberId}/media`, { method: 'POST', body });
    if (typeof data.id !== 'string' || !/^\d{1,30}$/.test(data.id)) throw providerError('META_INVALID_RESPONSE', 'Meta no devolvió el identificador del adjunto.');
    return data.id;
  }

  async sendTemplateMessage({ recipient, manual = false, template, expectedBody, callbackId, sendBefore, clock = () => new Date(), signal } = {}) {
    const to = this.assertTestRecipient(recipient, { manual });
    const approved = (await this.listMessageTemplates()).find(row => row.name === template?.name && row.language === template?.language && row.status === 'APPROVED');
    if (!approved) throw providerError('META_TEMPLATE_NOT_APPROVED', 'La plantilla no está aprobada por Meta para este idioma.');
    if (expectedBody && (approved.category !== 'UTILITY' || approved.components.length !== 1 ||
        approved.components[0].type !== 'BODY' || approved.components[0].text !== expectedBody)) {
      throw providerError('META_TEMPLATE_CHANGED', 'La plantilla aprobada en Meta cambió de contenido o categoría.');
    }
    validateTemplateParameters(approved, template.components || []);
    if (sendBefore && clock() >= sendBefore) throw providerError('META_SCHEDULE_CLOSED', 'Terminó el horario de envío antes de contactar a Meta.');
    return this.sendMessage({ recipient: to, manual, payload: { type: 'template', ...(callbackId ? { biz_opaque_callback_data: callbackId } : {}),
      template: { name: approved.name, language: { code: approved.language }, ...(template.components?.length ? { components: template.components } : {}) } }, signal });
  }

  verifyWebhookSignature(rawBody, signature) {
    if (typeof signature !== 'string' || !/^sha256=[a-f\d]{64}$/i.test(signature)) return false;
    const expected = createHmac('sha256', this.config.appSecret).update(rawBody).digest();
    const received = Buffer.from(signature.slice(7), 'hex');
    return received.length === expected.length && timingSafeEqual(expected, received);
  }

  verifyWebhookChallenge(mode, token, challenge) {
    if (mode !== 'subscribe' || typeof token !== 'string' || typeof challenge !== 'string') return null;
    const supplied = Buffer.from(token); const expected = Buffer.from(this.config.webhookVerifyToken);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected) ? challenge : null;
  }

  handleIncomingWebhook(dto) { return normalizeMetaWebhook(dto, this.config); }
  handleDeliveryStatus(dto) { return normalizeMetaStatus(dto); }
}

function readMetaConfig(env) {
  if (String(env.WHATSAPP_PROVIDER || '').toLowerCase() !== 'meta') throw providerError('META_PROVIDER_DISABLED', 'WHATSAPP_PROVIDER=meta no está configurado en el backend.');
  const fields = {
    accessToken: env.WHATSAPP_ACCESS_TOKEN, version: env.WHATSAPP_API_VERSION,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID, businessAccountId: env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    appId: env.WHATSAPP_APP_ID, businessId: env.WHATSAPP_BUSINESS_ID,
    webhookVerifyToken: env.WHATSAPP_WEBHOOK_VERIFY_TOKEN, appSecret: env.WHATSAPP_APP_SECRET
  };
  if (Object.values(fields).some(value => typeof value !== 'string' || !value.trim())) throw providerError('META_CONFIGURATION_INCOMPLETE', 'Falta configuración requerida de WhatsApp Cloud API en el entorno seguro del backend.');
  if (!/^v\d+\.\d+$/.test(fields.version) || !/^\d{8,25}$/.test(fields.phoneNumberId) || !/^\d{8,25}$/.test(fields.businessAccountId) || !/^\d{8,25}$/.test(fields.appId) || !/^\d{8,25}$/.test(fields.businessId)) throw providerError('META_CONFIGURATION_INVALID', 'La configuración de WhatsApp Cloud API no tiene un formato válido.');
  return fields;
}

function providerError(code, message) { return Object.assign(new Error(message), { code }); }
function normalizeMetaTemplate(row) {
  if (!row || typeof row.name !== 'string' || typeof row.language !== 'string' || typeof row.status !== 'string' || !Array.isArray(row.components)) throw providerError('META_INVALID_TEMPLATE', 'Meta devolvió una plantilla con formato inválido.');
  return { name: row.name, language: row.language, category: row.category || null, status: row.status, components: row.components };
}
function validateTemplateParameters(template, components) {
  if (!Array.isArray(components) || components.some(component => !component || !['header', 'body', 'button'].includes(component.type) || !Array.isArray(component.parameters))) throw providerError('META_TEMPLATE_COMPONENT_INVALID', 'Los componentes de la plantilla no son válidos.');
  for (const definition of template.components) {
    if (definition.type === 'HEADER' && definition.format !== 'TEXT') throw providerError('META_TEMPLATE_COMPONENT_UNSUPPORTED', 'Las plantillas con encabezado multimedia requieren habilitar el envío multimedia validado.');
    if (definition.type === 'BUTTONS' && (definition.buttons || []).some(button => ['URL', 'PHONE_NUMBER', 'OTP', 'CATALOG', 'MPM'].includes(button.type))) throw providerError('META_TEMPLATE_COMPONENT_UNSUPPORTED', 'Los botones dinámicos o interactivos requieren validación adicional.');
  }
  const required = template.components.filter(row => ['HEADER', 'BODY'].includes(row.type)).flatMap(row => [...(row.text || '').matchAll(/\{\{(\d+)\}\}/g)].map(match => ({ type: row.type.toLowerCase(), index: Number(match[1]) })));
  const supplied = components.flatMap(component => (component.parameters || []).map((parameter, index) => ({ type: component.type, index: index + 1, parameter })));
  if (required.length !== supplied.length || required.some((item, index) => item.type !== supplied[index].type || supplied[index].parameter.type !== 'text' || typeof supplied[index].parameter.text !== 'string' || supplied[index].parameter.text.length > 1024)) throw providerError('META_TEMPLATE_PARAMETERS_INVALID', 'Los parámetros no corresponden a las variables de la plantilla aprobada.');
}

function normalizeMetaWebhook(payload, config) {
  if (payload?.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) throw providerError('META_WEBHOOK_INVALID', 'Webhook de Meta inválido.');
  const events = [];
  for (const entry of payload.entry) for (const change of entry.changes || []) {
    if (change.field !== 'messages' || !change.value) continue;
    const phoneId = change.value.metadata?.phone_number_id;
    if ((entry.id && entry.id !== config.businessAccountId) || (phoneId && phoneId !== config.phoneNumberId)) continue;
    for (const message of change.value.messages || []) {
      const timestamp = new Date(Number(message.timestamp) * 1000);
      if (typeof message?.id !== 'string' || typeof message?.type !== 'string' || Number.isNaN(timestamp.getTime())) throw providerError('META_WEBHOOK_INVALID', 'Evento de mensaje de Meta inválido.');
      events.push({ kind: 'message', phone: normalizePhone(message.from), provider_message_id: message.id, type: message.type,
        content: message.type === 'text' ? message.text?.body : null,
        media: message[message.type]?.id ? { id: message[message.type].id, mime_type: message[message.type].mime_type || null, sha256: message[message.type].sha256 || null } : null,
        timestamp });
    }
    for (const status of change.value.statuses || []) events.push({ kind: 'status', ...normalizeMetaStatus(status, phoneId === config.phoneNumberId) });
  }
  return events;
}
function normalizeMetaStatus(status, acceptCallback = false) {
  const values = { sent: 'SENT', delivered: 'DELIVERED', read: 'READ', failed: 'FAILED' };
  if (!status || typeof status.id !== 'string' || !values[status.status]) throw providerError('META_STATUS_INVALID', 'Estado de Meta inválido.');
  const timestamp = new Date(Number(status.timestamp) * 1000);
  if (Number.isNaN(timestamp.getTime())) throw providerError('META_STATUS_INVALID', 'Marca de tiempo de Meta inválida.');
  const callback = acceptCallback && typeof status.biz_opaque_callback_data === 'string'
    ? /^mertel-(invoice|media):([1-9]\d{0,19})$/.exec(status.biz_opaque_callback_data) : null;
  return { kind: 'status', provider_message_id: status.id, status: values[status.status], recipient: status.recipient_id ? normalizePhone(status.recipient_id) : null, timestamp,
    ...(callback ? { callback_id: callback[2], ...(callback[1] === 'media' ? { callback_media: true } : {}) } : {}),
    errors: Array.isArray(status.errors) ? status.errors.map(row => ({ code: String(row.code || ''), title: String(row.title || '').slice(0, 200), message: String(row.message || '').slice(0, 500) })) : [] };
}

export function normalizePhone(value) {
  if (typeof value !== 'string' || !/^[+\d\s()-]{7,30}$/.test(value)) throw new Error('Teléfono inválido.');
  let digits = value.replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('3')) digits = `57${digits}`;
  if (!/^[1-9]\d{7,14}$/.test(digits)) throw new Error('Teléfono inválido.');
  return `+${digits}`;
}

export class MockWhatsAppProvider extends WhatsAppProvider {
  async validateConnection({ fail = false } = {}) { return { status: fail ? 'ERROR' : 'CONNECTED', simulated: true }; }
  async getConnectionStatus() { return { status: 'CONNECTED', simulated: true }; }
  async sendMessage({ fail = false } = {}) {
    return fail ? { status: 'FAILED', error_code: 'MOCK_SEND_FAILED', error_message: 'Fallo de envío simulado.' } :
      { status: 'SENT', provider_message_id: `mock:${randomUUID()}`, simulated: true };
  }
  handleIncomingWebhook(dto) {
    if (!dto || typeof dto.content !== 'string' || !dto.content.trim() || dto.content.length > 16000 ||
        typeof dto.provider_message_id !== 'string' || !/^mock:[\w-]{1,100}$/.test(dto.provider_message_id) ||
        typeof dto.received_at !== 'string' || !Number.isFinite(Date.parse(dto.received_at))) throw new Error('Mensaje entrante inválido.');
    return { direction: 'inbound', provider: 'MOCK', phone: normalizePhone(dto.phone),
      content: dto.content, received_at: new Date(dto.received_at), provider_message_id: dto.provider_message_id };
  }
  handleDeliveryStatus(dto) {
    if (!dto || !['DELIVERED', 'READ', 'FAILED'].includes(dto.status)) throw new Error('Estado de entrega inválido.');
    return { status: dto.status, simulated: true };
  }
}

export function whatsappProvider(name) {
  if (name === 'MOCK') return new MockWhatsAppProvider();
  if (name === 'WHATSAPP_CLOUD_API' || String(name).toLowerCase() === 'meta') return new MetaWhatsAppProvider();
  throw new Error('Proveedor WhatsApp no disponible.');
}
