import pool from '../config/database.js';
import { validCompanyId } from '../utils/companyScope.js';
import { operationError, operationId } from './collectionOperations.validation.js';
import { loadCompanyCollectionRules } from './companyCollection.service.js';
import { collectionStageCatalog } from './collectionPolicy.js';
import { collectionMessage } from './collectionMessages.service.js';
import { renderMessageTemplate } from '../utils/messageTemplate.js';
import { normalizePhone, whatsappProvider } from './whatsappProvider.service.js';
import { defaultWhatsAppSettings, publicWhatsAppSettings, encryptCredentials, positiveLimit, validateRule,
  bogotaDate, nextWindow, idempotencyKey, retryAt, deliveryTransition, MESSAGE_STATES, RETRY_POLICY } from './whatsappPolicy.js';

const SETTING = 'whatsapp_center';
const messageColumns = `CAST(m.id AS CHAR) AS id,CAST(m.customer_id AS CHAR) AS customer_id,
  CAST(m.template_id AS CHAR) AS template_id,c.name AS customer_name,t.name AS template_name,m.stage,m.channel,m.direction,
  m.message_mode,m.recipient,m.content,UPPER(m.status) AS status,m.provider,m.provider_message_id,m.created_at,
  m.sent_at,m.delivered_at,m.read_at,m.received_at,m.scheduled_at,m.error_code,m.error_message,m.attempts,m.last_attempt_at,m.next_attempt_at`;

async function transaction(scope, work, dbPool = pool) {
  if (!validCompanyId(scope?.companyId)) throw operationError(403, 'El contexto MERTEL no está disponible.');
  const db = await dbPool.getConnection();
  try {
    await db.beginTransaction();
    // Serializes settings, limits and queue claims, including requests on different servers.
    const [[company]] = await db.query("SELECT id FROM companies WHERE id=? AND status='active' AND deleted_at IS NULL FOR UPDATE", [scope.companyId]);
    if (!company) throw operationError(403, 'MERTEL no está disponible.');
    const [rows] = await db.query('SELECT id,setting_value FROM settings WHERE company_id=? AND setting_key=?', [scope.companyId, SETTING]);
    const settings = rows.length ? { ...defaultWhatsAppSettings(), ...JSON.parse(rows[0].setting_value) } : defaultWhatsAppSettings();
    if (!rows.length) {
      const [[legacy]] = await db.query("SELECT setting_value FROM settings WHERE company_id=? AND setting_key='daily_message_limit'", [scope.companyId]);
      if (legacy && /^\d+$/.test(legacy.setting_value) && Number(legacy.setting_value) > 0) settings.global_daily_limit = Number(legacy.setting_value);
    }
    const result = await work(db, settings, rows[0]?.id);
    await db.commit(); return result;
  } catch (error) { try { await db.rollback(); } catch { /* original error */ } throw error; }
  finally { db.release(); }
}
async function audit(db, scope, actorId, action, entityType, entityId, data) {
  await db.query('INSERT INTO audit_logs (company_id,user_id,action,entity_type,entity_id,new_values) VALUES (?,?,?,?,?,?)',
    [scope.companyId, actorId ?? scope.actorId ?? null, action, entityType, entityId ?? null, JSON.stringify(data)]);
}
async function saveSettings(db, scope, actorId, settings, action) {
  await db.query(`INSERT INTO settings (company_id,setting_key,setting_value,value_type,description) VALUES (?,?,?,'json','Centro WhatsApp MERTEL')
    ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)`, [scope.companyId, SETTING, JSON.stringify(settings)]);
  const [[row]] = await db.query('SELECT id FROM settings WHERE company_id=? AND setting_key=?', [scope.companyId, SETTING]);
  await audit(db, scope, actorId, action, 'whatsapp_setting', row.id, publicWhatsAppSettings(settings));
}
async function stagesFor(db, scope) { return collectionStageCatalog(await loadCompanyCollectionRules(scope.companyId, db)); }
function connected(settings) {
  if (settings.provider !== 'MOCK' || settings.connection_status !== 'CONNECTED') throw operationError(409, 'Automatización no disponible: WhatsApp no está conectado. En esta fase solo se admite conexión MOCK.');
}

export async function getWhatsAppCenter({ scope }, dbPool = pool) {
  return transaction(scope, async (db, settings) => ({ settings: publicWhatsAppSettings(settings), stage_catalog: await stagesFor(db, scope) }), dbPool);
}
export async function updateWhatsAppSettings({ scope, actorId, body }, dbPool = pool) {
  const allowed = ['provider', 'number', 'phone_number_id', 'business_account_id', 'credentials', 'global_daily_limit', 'customer_daily_limit', 'automations_enabled'];
  if (!body || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) throw operationError(400, 'Campos de configuración inválidos.');
  return transaction(scope, async (db, settings) => {
    let changedConnection = false;
    for (const key of ['provider', 'number', 'phone_number_id', 'business_account_id']) {
      if (!Object.hasOwn(body, key)) continue;
      if (key === 'provider' ? ![null, 'MOCK', 'WHATSAPP_CLOUD_API'].includes(body[key]) : typeof body[key] !== 'string' || body[key].length > 100) throw operationError(400, 'Proveedor o identificador inválido.');
      if (key === 'number' && body[key]) { try { body[key] = normalizePhone(body[key]); } catch { throw operationError(400, 'Número inválido.'); } }
      if (settings[key] !== body[key]) changedConnection = true;
      settings[key] = body[key];
    }
    if (Object.hasOwn(body, 'credentials')) {
      const credentials = body.credentials;
      if (!credentials || Array.isArray(credentials) || Object.keys(credentials).some(key => !['access_token', 'webhook_verification_token'].includes(key)) ||
          !['access_token', 'webhook_verification_token'].every(key => typeof credentials[key] === 'string' && credentials[key].trim() && credentials[key].length <= 4096)) throw operationError(400, 'Credenciales inválidas.');
      settings.encrypted_credentials = encryptCredentials(credentials); changedConnection = true;
    }
    if (changedConnection) { settings.connection_status = settings.provider ? 'CONFIGURED' : 'NOT_CONFIGURED'; settings.automations_enabled = false; }
    for (const key of ['global_daily_limit', 'customer_daily_limit']) if (Object.hasOwn(body, key)) settings[key] = positiveLimit(body[key], key);
    if (Object.hasOwn(body, 'automations_enabled')) {
      if (typeof body.automations_enabled !== 'boolean') throw operationError(400, 'Estado de automatizaciones inválido.');
      if (body.automations_enabled) {
        connected(settings);
        if (!settings.global_daily_limit || !settings.customer_daily_limit || !settings.rules.some(rule => rule.enabled && rule.mode === 'AUTOMATICO')) throw operationError(409, 'Define límites y una regla automática activa antes de activar automatizaciones.');
        const stages = await stagesFor(db, scope);
        for (const rule of settings.rules.filter(item => item.enabled && item.mode === 'AUTOMATICO')) {
          validateRule(rule, stages);
          const [[template]] = await db.query("SELECT stage,status,content FROM message_templates WHERE id=? AND company_id=? AND channel='whatsapp'", [rule.template_id, scope.companyId]);
          if (!template || template.status !== 'active' || (template.stage && template.stage !== rule.stage)) throw operationError(409, 'La automatización requiere una plantilla activa y compatible.');
          validateTemplateContent(template.content);
        }
      }
      settings.automations_enabled = body.automations_enabled;
    }
    await saveSettings(db, scope, actorId, settings, 'configure'); return publicWhatsAppSettings(settings);
  }, dbPool);
}
export async function testWhatsAppConnection({ scope, actorId, fail = false }, dbPool = pool) {
  if (typeof fail !== 'boolean') throw operationError(400, 'fail debe ser booleano.');
  return transaction(scope, async (db, settings) => {
    if (settings.provider !== 'MOCK') throw operationError(409, 'Selecciona MOCK para probar. La API real está pendiente.');
    const result = await whatsappProvider(settings.provider).validateConnection({ fail });
    settings.connection_status = result.status;
    if (result.status !== 'CONNECTED') settings.automations_enabled = false;
    await saveSettings(db, scope, actorId, settings, 'test_connection'); return publicWhatsAppSettings(settings);
  }, dbPool);
}
export async function disconnectWhatsApp({ scope, actorId }, dbPool = pool) {
  return transaction(scope, async (db, settings) => {
    settings.connection_status = settings.provider ? 'DISCONNECTED' : 'NOT_CONFIGURED'; settings.automations_enabled = false;
    await saveSettings(db, scope, actorId, settings, 'disconnect'); return publicWhatsAppSettings(settings);
  }, dbPool);
}
export async function saveWhatsAppRule({ scope, actorId, stage, body }, dbPool = pool) {
  return transaction(scope, async (db, settings) => {
    const rule = validateRule({ ...body, stage }, await stagesFor(db, scope));
    const [[template]] = await db.query("SELECT stage,status,content FROM message_templates WHERE id=? AND company_id=? AND channel='whatsapp'", [rule.template_id, scope.companyId]);
    if (!template || (template.stage && template.stage !== stage) || (rule.enabled && template.status !== 'active')) throw operationError(400, 'Plantilla no disponible o incompatible con la etapa.');
    if (rule.enabled) connected(settings);
    if (rule.enabled) validateTemplateContent(template.content);
    settings.rules = [...settings.rules.filter(item => item.stage !== stage), rule];
    await saveSettings(db, scope, actorId, settings, 'automation_update'); return rule;
  }, dbPool);
}
function validateTemplateContent(content) {
  const rendered = renderMessageTemplate(content || '', {});
  if (!content?.trim() || rendered.unsupported_variables.length || rendered.malformed_variables) throw operationError(409, 'La plantilla tiene contenido o variables inválidas.');
}
export async function previewWhatsApp({ scope, body }, dbPool = pool) {
  if (!body || Object.keys(body).some(key => !['customer_id', 'template_id', 'reference_date'].includes(key))) throw operationError(400, 'Campos de preview inválidos.');
  return collectionMessage({ scope, customerId: body.customer_id, templateId: body.template_id,
    referenceDate: body.reference_date || bogotaDate(), step: 'preview' }, dbPool);
}
export async function testWhatsAppConfiguration({ scope, body }, dbPool = pool) {
  return transaction(scope, async (db, settings) => {
    if (settings.provider !== 'MOCK') throw operationError(409, 'Configura un proveedor MOCK para probar la configuración.');
    const validation = await whatsappProvider(settings.provider).validateConnection();
    const preview = await collectionMessage({ scope, customerId: body?.customer_id, templateId: body?.template_id,
      referenceDate: bogotaDate(), step: 'preview', transactionDb: db }, dbPool);
    return { ...preview, configuration_valid: validation.status === 'CONNECTED' && preview.can_prepare,
      provider: settings.provider, simulated: true };
  }, dbPool);
}

async function enforceLimits(db, scope, settings, rule, customerId, day, excludeId = null) {
  if (!settings.global_daily_limit || !settings.customer_daily_limit) throw operationError(409, 'Configura los límites global y por cliente.');
  const [[counts]] = await db.query(`SELECT COUNT(*) AS global_count,
    COALESCE(SUM(customer_id=?),0) AS customer_count,COALESCE(SUM(stage=?),0) AS stage_count
    FROM messages WHERE company_id=? AND direction='outbound' AND budget_date=? AND UPPER(status)<>'CANCELLED' AND (? IS NULL OR id<>?)`,
    [customerId, rule.stage, scope.companyId, day, excludeId, excludeId]);
  if (Number(counts.global_count) >= settings.global_daily_limit || Number(counts.customer_count) >= settings.customer_daily_limit || Number(counts.stage_count) >= rule.daily_limit) throw operationError(409, 'Límite diario alcanzado.');
}
async function messageById(db, scope, id, lock = false) {
  const [[row]] = await db.query(`SELECT ${messageColumns} FROM messages m JOIN customers c ON c.id=m.customer_id AND c.company_id=m.company_id
    LEFT JOIN message_templates t ON t.id=m.template_id AND t.company_id=m.company_id WHERE m.id=? AND m.company_id=? ${lock ? 'FOR UPDATE' : ''}`, [id, scope.companyId]);
  if (!row) throw operationError(404, 'Mensaje no encontrado.'); return row;
}
export async function enqueueWhatsApp({ scope, actorId, body, now = new Date() }, dbPool = pool) {
  if (!body || Object.keys(body).some(key => !['customer_id', 'template_id', 'mode'].includes(key)) || !['MANUAL', 'AUTOMATICO'].includes(body.mode)) throw operationError(400, 'Modo o campos de mensaje inválidos.');
  const customerId = operationId(body.customer_id, 'customer_id');
  return transaction(scope, async (db, settings) => {
    const stages = await stagesFor(db, scope);
    // Template, variables and stage are resolved from the collection engine inside the transaction.
    let templateId = body.template_id;
    if (body.mode === 'AUTOMATICO') {
      connected(settings);
      if (!settings.automations_enabled) throw operationError(409, 'Automatizaciones desactivadas.');
      // Ask the engine through the existing template adapter; never calculate aging here.
      const available = await collectionMessage({ scope, customerId, referenceDate: bogotaDate(now), step: 'templates', transactionDb: db }, dbPool);
      const candidates = settings.rules.filter(rule => rule.enabled && rule.mode === 'AUTOMATICO' && available.some(t => t.id === rule.template_id));
      let chosen;
      for (const rule of candidates) {
        const candidate = await collectionMessage({ scope, customerId, templateId: rule.template_id, referenceDate: bogotaDate(now), step: 'preview', transactionDb: db }, dbPool);
        if (candidate.stage === rule.stage) { chosen = rule; break; }
      }
      if (!chosen) throw operationError(409, 'El motor no identifica una regla automática aplicable.');
      templateId = chosen.template_id;
    }
    const preview = await collectionMessage({ scope, customerId, templateId, referenceDate: bogotaDate(now), step: 'prepare', transactionDb: db }, dbPool);
    const rule = settings.rules.find(item => item.stage === preview.stage && item.enabled && item.mode === body.mode && item.template_id === String(templateId));
    if (!rule || !stages.some(stage => stage.key === preview.stage)) throw operationError(409, 'Configura una regla activa para esta etapa, plantilla y modo.');
    let phone; try { phone = normalizePhone(preview.customer.phone); } catch { throw operationError(409, 'El cliente no tiene un teléfono válido.'); }
    const scheduledAt = nextWindow(rule, now); const day = bogotaDate(scheduledAt);
    const key = idempotencyKey({ companyId: scope.companyId, customerId, stage: preview.stage, templateId, day, mode: body.mode });
    const [[duplicate]] = await db.query('SELECT CAST(id AS CHAR) AS id FROM messages WHERE company_id=? AND idempotency_key=?', [scope.companyId, key]);
    if (duplicate) return { message: await messageById(db, scope, duplicate.id), duplicate: true };
    const [[recent]] = await db.query(`SELECT id FROM messages WHERE company_id=? AND customer_id=? AND stage=? AND template_id=?
      AND direction='outbound' AND UPPER(status)<>'CANCELLED' AND created_at>? LIMIT 1`,
      [scope.companyId, customerId, preview.stage, templateId, new Date(now.getTime() - rule.interval_hours * 3600000)]);
    if (recent) throw operationError(409, 'El intervalo de esta regla impide otro mensaje.');
    await enforceLimits(db, scope, settings, rule, customerId, day);
    const [inserted] = await db.query(`INSERT INTO messages (company_id,customer_id,invoice_id,template_id,created_by,channel,recipient,content,status,
      provider,stage,direction,message_mode,idempotency_key,scheduled_at,budget_date) VALUES (?,?,?,?,?,'whatsapp',?,?,'PENDING',?,?,'outbound',?,?,?,?)`,
      [scope.companyId, customerId, preview.main_invoice?.id ?? null, templateId, actorId, phone, preview.content, settings.provider, preview.stage, body.mode, key, scheduledAt, day]);
    await audit(db, scope, actorId, 'queued', 'whatsapp_message', inserted.insertId, { status: 'PENDING', stage: preview.stage });
    return { message: await messageById(db, scope, inserted.insertId), duplicate: false };
  }, dbPool);
}

export async function mockSendWhatsApp({ scope, actorId, messageId, fail = false, now = new Date() }, dbPool = pool) {
  const id = operationId(messageId, 'message_id');
  if (typeof fail !== 'boolean') throw operationError(400, 'fail debe ser booleano.');
  return transaction(scope, async (db, settings) => {
    connected(settings);
    const message = await messageById(db, scope, id, true);
    if (message.direction !== 'outbound' || message.provider !== 'MOCK' || !['PENDING', 'FAILED'].includes(message.status)) throw operationError(409, 'El mensaje no puede procesarse en MOCK.');
    if (message.attempts >= RETRY_POLICY.max_attempts) throw operationError(409, 'Máximo de intentos alcanzado.');
    if (message.next_attempt_at && new Date(message.next_attempt_at) > now) throw operationError(409, 'El reintento todavía no está disponible.');
    const rule = settings.rules.find(item => item.stage === message.stage && item.enabled && item.mode === message.message_mode && item.template_id === message.template_id);
    if (!rule || (message.message_mode === 'AUTOMATICO' && !settings.automations_enabled)) throw operationError(409, 'La regla o automatización no está activa.');
    const preview = await collectionMessage({ scope, customerId: message.customer_id, templateId: message.template_id, referenceDate: bogotaDate(now), step: 'prepare', transactionDb: db }, dbPool);
    if (preview.stage !== message.stage || preview.content !== message.content || normalizePhone(preview.customer.phone) !== message.recipient) throw operationError(409, 'El contexto del cliente cambió. Cancela el mensaje y prepara uno actualizado.');
    const window = nextWindow(rule, now);
    if (window > now || (message.scheduled_at && new Date(message.scheduled_at) > now)) {
      const scheduled = new Date(Math.max(window.getTime(), new Date(message.scheduled_at || now).getTime()));
      await enforceLimits(db, scope, settings, rule, message.customer_id, bogotaDate(scheduled), id);
      await db.query("UPDATE messages SET status='PENDING',scheduled_at=?,budget_date=? WHERE id=? AND company_id=?", [scheduled, bogotaDate(scheduled), id, scope.companyId]);
      return { message: await messageById(db, scope, id), scheduled: true, simulated: true };
    }
    await enforceLimits(db, scope, settings, rule, message.customer_id, bogotaDate(now), id);
    const attempts = Number(message.attempts) + 1;
    await db.query("UPDATE messages SET status='PROCESSING',attempts=?,last_attempt_at=?,budget_date=? WHERE id=? AND company_id=?", [attempts, now, bogotaDate(now), id, scope.companyId]);
    const result = await whatsappProvider('MOCK').sendTemplateMessage({ content: message.content, recipient: message.recipient, fail });
    await db.query(`UPDATE messages SET status=?,provider_message_id=?,sent_at=?,error_code=?,error_message=?,next_attempt_at=? WHERE id=? AND company_id=?`,
      [result.status, result.provider_message_id ?? null, result.status === 'SENT' ? now : null, result.error_code ?? null,
        result.error_message ?? null, result.status === 'FAILED' ? retryAt(attempts, now) : null, id, scope.companyId]);
    await audit(db, scope, actorId, result.status.toLowerCase(), 'whatsapp_message', id, { status: result.status, simulated: true, attempts });
    return { message: await messageById(db, scope, id), simulated: true };
  }, dbPool);
}
export async function cancelWhatsAppMessage({ scope, actorId, messageId }, dbPool = pool) {
  const id = operationId(messageId, 'message_id');
  return transaction(scope, async (db) => {
    const message = await messageById(db, scope, id, true);
    if (!['PENDING', 'FAILED'].includes(message.status) || message.direction !== 'outbound') throw operationError(409, 'El mensaje no puede cancelarse.');
    await db.query("UPDATE messages SET status='CANCELLED',next_attempt_at=NULL WHERE id=? AND company_id=?", [id, scope.companyId]);
    await audit(db, scope, actorId, 'cancelled', 'whatsapp_message', id, { status: 'CANCELLED' });
    return messageById(db, scope, id);
  }, dbPool);
}
export async function mockDeliveryWhatsApp({ scope, actorId, messageId, status }, dbPool = pool) {
  const id = operationId(messageId, 'message_id');
  let dto; try { dto = whatsappProvider('MOCK').handleDeliveryStatus({ status }); } catch { throw operationError(400, 'Estado inválido.'); }
  return transaction(scope, async (db) => {
    const message = await messageById(db, scope, id, true);
    if (message.provider !== 'MOCK' || !message.provider_message_id || message.direction !== 'outbound') throw operationError(409, 'No es un envío MOCK.');
    if (message.status === dto.status) return message;
    if (!deliveryTransition(message.status, dto.status)) throw operationError(409, 'No se permite retroceder el estado.');
    const column = dto.status === 'READ' ? 'read_at' : dto.status === 'DELIVERED' ? 'delivered_at' : 'updated_at';
    await db.query(`UPDATE messages SET status=?,${column}=UTC_TIMESTAMP(),error_code=?,error_message=?,next_attempt_at=? WHERE id=? AND company_id=?`,
      [dto.status, dto.status === 'FAILED' ? 'MOCK_DELIVERY_FAILED' : null, dto.status === 'FAILED' ? 'Fallo de entrega simulado.' : null,
        dto.status === 'FAILED' ? retryAt(Number(message.attempts)) : null, id, scope.companyId]);
    await audit(db, scope, actorId, dto.status.toLowerCase(), 'whatsapp_message', id, { status: dto.status, simulated: true });
    return messageById(db, scope, id);
  }, dbPool);
}
export async function mockIncomingWhatsApp({ scope, actorId, body }, dbPool = pool) {
  let dto; try { dto = whatsappProvider('MOCK').handleIncomingWebhook(body); } catch { throw operationError(400, 'Mensaje entrante inválido.'); }
  return transaction(scope, async (db) => {
    const [[existing]] = await db.query("SELECT CAST(id AS CHAR) AS id FROM messages WHERE company_id=? AND provider='MOCK' AND provider_message_id=?", [scope.companyId, dto.provider_message_id]);
    if (existing) return { message: await messageById(db, scope, existing.id), duplicate: true };
    const [customers] = await db.query("SELECT CAST(id AS CHAR) AS id,phone FROM customers WHERE company_id=? AND status='active' AND deleted_at IS NULL AND phone IS NOT NULL", [scope.companyId]);
    const matches = customers.filter(customer => { try { return normalizePhone(customer.phone) === dto.phone; } catch { return false; } });
    if (matches.length !== 1) throw operationError(409, 'El teléfono debe identificar un único cliente MERTEL.');
    const [result] = await db.query(`INSERT INTO messages (company_id,customer_id,channel,recipient,content,status,provider,provider_message_id,direction,received_at)
      VALUES (?,?,'whatsapp',?,?,'DELIVERED','MOCK',?,'inbound',?)`, [scope.companyId, matches[0].id, dto.phone, dto.content, dto.provider_message_id, dto.received_at]);
    await audit(db, scope, actorId, 'incoming', 'whatsapp_message', result.insertId, { status: 'DELIVERED', simulated: true });
    return { message: await messageById(db, scope, result.insertId), duplicate: false };
  }, dbPool);
}
export async function listWhatsAppMessages({ scope, filters = {}, customerId }, dbPool = pool) {
  const clauses = ["m.company_id=?", "m.channel='whatsapp'"]; const values = [scope.companyId];
  for (const [key, column] of [['customer_id', 'm.customer_id'], ['template_id', 'm.template_id'], ['stage', 'm.stage'], ['status', 'UPPER(m.status)']]) {
    const value = key === 'customer_id' && customerId ? customerId : filters[key];
    if (!value) continue;
    if (key.endsWith('_id')) operationId(value, key);
    else if (typeof value !== 'string' || value.length > 50 || (key === 'status' && !MESSAGE_STATES.includes(value))) throw operationError(400, 'Filtro inválido.');
    clauses.push(`${column}=?`); values.push(value);
  }
  for (const [key, operator] of [['date_from', '>='], ['date_to', '<=']]) if (filters[key]) {
    if (typeof filters[key] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(filters[key]) || !Number.isFinite(Date.parse(filters[key]))) throw operationError(400, 'Fecha inválida.');
    clauses.push(`DATE(CONVERT_TZ(m.created_at,'+00:00','-05:00'))${operator}?`); values.push(filters[key]);
  }
  if (filters.date_from && filters.date_to && filters.date_from > filters.date_to) throw operationError(400, 'Rango de fechas inválido.');
  const page = Number(filters.page ?? 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw operationError(400, 'Página inválida.');
  return transaction(scope, async db => {
    const [rows] = await db.query(`SELECT ${messageColumns} FROM messages m JOIN customers c ON c.id=m.customer_id AND c.company_id=m.company_id
      LEFT JOIN message_templates t ON t.id=m.template_id AND t.company_id=m.company_id WHERE ${clauses.join(' AND ')} ORDER BY m.created_at DESC,m.id DESC LIMIT 51 OFFSET ?`, [...values, (page - 1) * 50]);
    return { messages: rows.slice(0, 50), page, has_next: rows.length > 50 };
  }, dbPool);
}
export async function listWhatsAppAudit({ scope }, dbPool = pool) {
  return transaction(scope, async db => {
    const [rows] = await db.query(`SELECT CAST(id AS CHAR) AS id,action,entity_type,CAST(entity_id AS CHAR) AS entity_id,created_at
      FROM audit_logs WHERE company_id=? AND entity_type IN ('whatsapp_setting','whatsapp_message','message_template') ORDER BY id DESC LIMIT 100`, [scope.companyId]);
    return rows;
  }, dbPool);
}
