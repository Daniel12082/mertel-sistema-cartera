import { createHash } from 'node:crypto';
import pool from '../config/database.js';
import {buildWhatsAppSequence,automaticSelection,automaticNotices,automaticContent,automaticDayAllowed,noticeContext,validMobile,automaticWindow,renderAutomaticNotice,MERTEL_CONTACTS} from './whatsappSequence.js';
import {dateDay,dateFromDay} from './promptPayment.service.js';
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
  CAST(m.invoice_id AS CHAR) AS invoice_id,m.message_mode,m.recipient,m.content,UPPER(m.status) AS status,m.provider,m.provider_message_id,m.created_at,
  m.automation_context,m.sent_at,m.delivered_at,m.read_at,m.received_at,m.scheduled_at,m.error_code,m.error_message,m.attempts,m.last_attempt_at,m.next_attempt_at`;

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
    [scope.companyId, actorId ?? scope.actorId ?? null, action, entityType, entityId ?? null, JSON.stringify({...data,actor_type:actorId??scope.actorId?'USER':'SYSTEM'})]);
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

function runtimeProvider(settings) {
  if (settings?.provider === 'MOCK') return 'MOCK';
  return String(process.env.WHATSAPP_PROVIDER || '').toLowerCase() === 'meta' ? 'WHATSAPP_CLOUD_API' : settings.provider;
}

export async function getWhatsAppCenter({ scope }, dbPool = pool) {
  return transaction(scope, async (db, settings) => ({ settings: publicWhatsAppSettings({ ...settings, provider: runtimeProvider(settings) }), stage_catalog: await stagesFor(db, scope),contact_rules:MERTEL_CONTACTS }), dbPool);
}
function requireContactTemplate(rule,template){
  const expected=MERTEL_CONTACTS.find(step=>step.stage===rule.stage);
  if(rule.mode==='AUTOMATICO'&&(!expected||template.name!==expected.template_name))throw operationError(409,'Selecciona la plantilla MERTEL correspondiente a esta regla automática.');
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
          const [[template]] = await db.query("SELECT name,stage,status,content FROM message_templates WHERE id=? AND company_id=? AND channel='whatsapp'", [rule.template_id, scope.companyId]);
          if (!template || template.status !== 'active' || (template.stage && template.stage !== rule.stage)) throw operationError(409, 'La automatización requiere una plantilla activa y compatible.');
          validateTemplateContent(template.content);
          requireContactTemplate(rule,template);
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
    const providerName = runtimeProvider(settings);
    if (!providerName) throw operationError(409, 'Configura un proveedor antes de probar la conexión.');
    if (providerName === 'WHATSAPP_CLOUD_API' && fail) throw operationError(400, 'No se puede simular un fallo en Meta.');
    let result;
    try { result = await whatsappProvider(providerName).validateConnection({ fail }); }
    catch (error) { settings.connection_status = 'ERROR'; settings.automations_enabled = false; await saveSettings(db, scope, actorId, settings, 'test_connection_failed'); throw operationError(409, error.message || 'No se pudo validar Meta.'); }
    settings.connection_status = result.status;
    if (result.status !== 'CONNECTED') settings.automations_enabled = false;
    await saveSettings(db, scope, actorId, settings, 'test_connection');
    return { ...publicWhatsAppSettings({ ...settings, provider: providerName }), connection: { phone: result.phone || null, verified_name: result.verified_name || null } };
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
    const [[template]] = await db.query("SELECT name,stage,status,content FROM message_templates WHERE id=? AND company_id=? AND channel='whatsapp'", [rule.template_id, scope.companyId]);
    if (!template || (template.stage && template.stage !== stage) || (rule.enabled && template.status !== 'active')) throw operationError(400, 'Plantilla no disponible o incompatible con la etapa.');
    if (rule.enabled) connected(settings);
    if (rule.enabled) validateTemplateContent(template.content);
    requireContactTemplate(rule,template);
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
  const [[row]] = await db.query(`SELECT ${messageColumns} FROM messages m LEFT JOIN customers c ON c.id=m.customer_id AND c.company_id=m.company_id
    LEFT JOIN message_templates t ON t.id=m.template_id AND t.company_id=m.company_id WHERE m.id=? AND m.company_id=? ${lock ? 'FOR UPDATE' : ''}`, [id, scope.companyId]);
  if (!row) throw operationError(404, 'Mensaje no encontrado.'); return row;
}

export async function enqueueMetaTestMessage({ scope, actorId, body, now = new Date() }, dbPool = pool) {
  if (!body || Object.keys(body).some(key => !['recipient', 'content', 'confirmed'].includes(key)) || body.confirmed !== true ||
      typeof body.content !== 'string' || !body.content.trim() || body.content.length > 4096) throw operationError(400, 'Confirma un mensaje de prueba de texto válido.');
  return transaction(scope, async (db, settings) => {
    if (runtimeProvider(settings) !== 'WHATSAPP_CLOUD_API') throw operationError(409, 'Meta Cloud API no está configurada en el backend.');
    let recipient;
    try { recipient = normalizePhone(body.recipient); whatsappProvider('WHATSAPP_CLOUD_API').assertTestRecipient(recipient, { manual: true }); }
    catch (error) { throw operationError(403, error.message || 'Destinatario de prueba no autorizado.'); }
    const key = createHash('sha256').update(JSON.stringify(['meta-test', scope.companyId, recipient, body.content.trim(), now.toISOString().slice(0, 16)])).digest('hex');
    const [[duplicate]] = await db.query('SELECT CAST(id AS CHAR) id FROM messages WHERE company_id=? AND idempotency_key=?', [scope.companyId, key]);
    if (duplicate) return { message: await messageById(db, scope, duplicate.id), duplicate: true };
    const [[{ total }]] = await db.query(
      "SELECT COUNT(*) AS total FROM messages WHERE company_id=? AND provider='WHATSAPP_CLOUD_API' AND customer_id IS NULL AND recipient=? AND direction='outbound' AND message_mode='MANUAL' AND budget_date=?",
      [scope.companyId, recipient, bogotaDate(now)],
    );
    if (Number(total) >= 3) {
      throw operationError(429, 'Alcanzaste el límite de 3 envíos de prueba por día para este destinatario.');
    }
    const [result] = await db.query(`INSERT INTO messages(company_id,customer_id,created_by,channel,recipient,content,status,provider,direction,message_mode,idempotency_key,scheduled_at,budget_date)
      VALUES (?,NULL,?,'whatsapp',? ,?,'PENDING','WHATSAPP_CLOUD_API','outbound','MANUAL',?,?,?)`,
      [scope.companyId, actorId, recipient, body.content.trim(), key, now, bogotaDate(now)]);
    await audit(db, scope, actorId, 'meta_test_queued', 'whatsapp_message', result.insertId, { recipient, status: 'PENDING', test_mode: true });
    return { message: await messageById(db, scope, result.insertId), duplicate: false };
  }, dbPool);
}

export async function sendMetaTestMessage({ scope, actorId, messageId, body, now = new Date() }, dbPool = pool) {
  if (!body || Object.keys(body).some(key => key !== 'confirmed') || body.confirmed !== true) throw operationError(400, 'Confirma explícitamente el envío de prueba antes de continuar.');
  const id = operationId(messageId, 'message_id');
  const claimed = await transaction(scope, async (db, settings) => {
    if (runtimeProvider(settings) !== 'WHATSAPP_CLOUD_API' || settings.connection_status !== 'CONNECTED') throw operationError(409, 'Valida la conexión con Meta antes de enviar la prueba.');
    const message = await messageById(db, scope, id, true);
    if (message.customer_id || message.provider !== 'WHATSAPP_CLOUD_API' || message.message_mode !== 'MANUAL' || message.direction !== 'outbound' || message.status !== 'PENDING' || Number(message.attempts) !== 0) throw operationError(409, 'Solo se puede enviar un mensaje manual de prueba pendiente.');
    try { whatsappProvider('WHATSAPP_CLOUD_API').assertTestRecipient(message.recipient, { manual: true }); }
    catch (error) { throw operationError(403, error.message || 'Destinatario de prueba no autorizado.'); }
    if (!message.scheduled_at || bogotaDate(new Date(message.scheduled_at)) !== bogotaDate(now)) {
      throw operationError(409, 'Esta prueba quedó pendiente de un día anterior. Prepara una prueba nueva.');
    }
    const attempts = 1;
    await db.query("UPDATE messages SET status='PROCESSING',attempts=?,last_attempt_at=?,budget_date=? WHERE id=? AND company_id=?", [attempts, now, bogotaDate(now), id, scope.companyId]);
    await audit(db, scope, actorId, 'meta_request', 'whatsapp_message', id, { recipient: message.recipient, attempts, test_mode: true });
    return { message: { ...message, attempts } };
  }, dbPool);
  try {
    const result = await whatsappProvider('WHATSAPP_CLOUD_API').sendMessage({ recipient: claimed.message.recipient, manual: true, payload: { type: 'text', text: { preview_url: false, body: claimed.message.content } } });
    return transaction(scope, async db => {
      await db.query("UPDATE messages SET status='SENT',provider_message_id=?,sent_at=?,error_code=NULL,error_message=NULL,next_attempt_at=NULL WHERE id=? AND company_id=? AND status='PROCESSING'", [result.provider_message_id, now, id, scope.companyId]);
      await audit(db, scope, actorId, 'meta_accepted', 'whatsapp_message', id, { provider_message_id: result.provider_message_id, accepted_at: now, test_mode: true });
      return { message: await messageById(db, scope, id), accepted: true };
    }, dbPool);
  } catch (error) {
    return transaction(scope, async db => {
      const code = String(error?.code || 'META_SEND_FAILED').slice(0, 100);
      await db.query("UPDATE messages SET status='FAILED',error_code=?,error_message=?,next_attempt_at=NULL WHERE id=? AND company_id=? AND status='PROCESSING'", [code, String(error?.message || 'Meta rechazó el envío.').slice(0, 500), id, scope.companyId]);
      await audit(db, scope, actorId, 'meta_failed', 'whatsapp_message', id, { error_code: code, test_mode: true });
      return { message: await messageById(db, scope, id), accepted: false };
    }, dbPool);
  }
}

export async function listMetaMessageTemplates({ scope }, dbPool = pool) {
  return transaction(scope, async (db, settings) => {
    if (runtimeProvider(settings) !== 'WHATSAPP_CLOUD_API') throw operationError(409, 'Meta Cloud API no está configurada en el backend.');
    const templates = await whatsappProvider('WHATSAPP_CLOUD_API').listMessageTemplates();
    return { templates };
  }, dbPool);
}

export async function receiveMetaWebhook({ events }, dbPool = pool) {
  if (!Array.isArray(events)) throw new Error('Eventos Meta inválidos.');
  const db = await dbPool.getConnection();
  try {
    await db.beginTransaction();
    const [companies] = await db.query("SELECT id FROM companies WHERE status='active' AND deleted_at IS NULL ORDER BY id LIMIT 2 FOR UPDATE");
    if (companies.length !== 1) throw new Error('El webhook requiere una única compañía activa de MERTEL.');
    const scope = { companyId: String(companies[0].id), actorId: null };
    for (const event of events) {
      if (event.kind === 'status') {
        const [[message]] = await db.query("SELECT CAST(id AS CHAR) id,UPPER(status) status FROM messages WHERE company_id=? AND provider='WHATSAPP_CLOUD_API' AND provider_message_id=? FOR UPDATE", [scope.companyId, event.provider_message_id]);
        if (!message) continue;
        if (event.status === 'SENT' || message.status === event.status || !deliveryTransition(message.status, event.status)) continue;
        const column = event.status === 'READ' ? 'read_at' : event.status === 'DELIVERED' ? 'delivered_at' : 'updated_at';
        const error = event.errors?.[0];
        await db.query(`UPDATE messages SET status=?,${column}=?,error_code=?,error_message=?,next_attempt_at=NULL WHERE id=? AND company_id=?`, [event.status, event.timestamp, error?.code || null, error?.message || error?.title || null, message.id, scope.companyId]);
        await audit(db, scope, null, `meta_${event.status.toLowerCase()}`, 'whatsapp_message', message.id, { provider_message_id: event.provider_message_id, status: event.status, webhook_at: event.timestamp });
      } else if (event.kind === 'message') {
        const [[duplicate]] = await db.query("SELECT id FROM messages WHERE company_id=? AND provider='WHATSAPP_CLOUD_API' AND provider_message_id=?", [scope.companyId, event.provider_message_id]);
        if (duplicate) continue;
        const [customers] = await db.query("SELECT CAST(id AS CHAR) id,phone FROM customers WHERE company_id=? AND status='active' AND deleted_at IS NULL AND phone IS NOT NULL", [scope.companyId]);
        const matching = customers.filter(customer => { try { return normalizePhone(customer.phone) === event.phone; } catch { return false; } });
        const customerId = matching.length === 1 ? matching[0].id : null;
        const content = event.content || `[${event.type || 'media'} recibido · id ${event.media?.id || 'sin identificador'}]`;
        const [result] = await db.query("INSERT INTO messages(company_id,customer_id,channel,recipient,content,status,provider,provider_message_id,direction,received_at) VALUES (?,?,'whatsapp',? ,?,'DELIVERED','WHATSAPP_CLOUD_API',?,'inbound',?)", [scope.companyId, customerId, event.phone, content.slice(0, 16000), event.provider_message_id, event.timestamp]);
        await audit(db, scope, null, 'meta_incoming', 'whatsapp_message', result.insertId, { provider_message_id: event.provider_message_id, type: event.type, linked_customer: Boolean(customerId) });
      }
    }
    await db.commit();
  } catch (error) { try { await db.rollback(); } catch { /* preserve original */ } throw error; }
  finally { db.release(); }
}
export async function enqueueWhatsApp({ scope, actorId, body, now = new Date() }, dbPool = pool) {
  if (!body || Object.keys(body).some(key => !['customer_id', 'template_id', 'mode'].includes(key)) || !['MANUAL', 'AUTOMATICO'].includes(body.mode)) throw operationError(400, 'Modo o campos de mensaje inválidos.');
  const customerId = operationId(body.customer_id, 'customer_id');
  return transaction(scope, async (db, settings) => {
    if (runtimeProvider(settings) === 'WHATSAPP_CLOUD_API') throw operationError(403, 'Durante las pruebas de Meta se bloquean los mensajes de cartera. Usa únicamente el envío manual de prueba autorizado.');
    if (body.mode === 'AUTOMATICO') return enqueueAutomatic(db, { ...scope, actorId: null }, settings, customerId, now);
    const stages = await stagesFor(db, scope);
    // Template, variables and stage are resolved from the collection engine inside the transaction.
    let templateId = body.template_id;
    let selection=null,resolvedContext;
    const preview = await collectionMessage({ scope, customerId, templateId, referenceDate: bogotaDate(now), step: 'prepare', transactionDb: db,resolvedContext }, dbPool);
    const configuredRule = settings.rules.find(item => item.stage === preview.stage && item.enabled && item.mode === body.mode && item.template_id === String(templateId));
    const rule=selection?.rule||configuredRule||(body.mode==='MANUAL'?{stage:preview.stage,daily_limit:settings.global_daily_limit,interval_hours:null}:null);
    if (!rule || (body.mode==='AUTOMATICO'&&!stages.some(stage => stage.key === preview.stage))) throw operationError(409, 'Configura una regla activa para esta etapa, plantilla y modo.');
    let phone; try { phone = normalizePhone(preview.customer.phone); } catch { throw operationError(409, 'El cliente no tiene un teléfono válido.'); }
    const scheduledAt = rule.start_time?nextWindow(rule, now):new Date(now);
    if(selection&&bogotaDate(scheduledAt)!==selection.step.date)throw operationError(409,'El horario permitido queda fuera de la fecha exacta de este mensaje. No se traslada a otro día.');
    // DATETIME has second precision. Avoid MySQL rounding an immediate queue entry
    // into the future, which could postpone its first MOCK/worker attempt.
    scheduledAt.setUTCMilliseconds(0);
    const day = bogotaDate(scheduledAt);
    const key = idempotencyKey({ companyId: scope.companyId, customerId, stage:selection?`${preview.stage}:${selection.invoice.invoice_id}:${selection.step.date}`:preview.stage, templateId, day, mode: body.mode });
    if(selection){const [[event]]=await db.query("SELECT CAST(id AS CHAR) id FROM messages WHERE company_id=? AND customer_id=? AND invoice_id=? AND stage=? AND budget_date=? AND message_mode='AUTOMATICO' AND UPPER(status)<>'CANCELLED' LIMIT 1",[scope.companyId,customerId,selection.invoice.invoice_id,preview.stage,day]);if(event)return {message:await messageById(db,scope,event.id),duplicate:true};}
    const [[duplicate]] = await db.query('SELECT CAST(id AS CHAR) AS id FROM messages WHERE company_id=? AND idempotency_key=?', [scope.companyId, key]);
    if (duplicate) return { message: await messageById(db, scope, duplicate.id), duplicate: true };
    const [[recent]] = await db.query(`SELECT id FROM messages WHERE company_id=? AND customer_id=? AND stage=? AND template_id=?
      AND direction='outbound' AND UPPER(status)<>'CANCELLED' AND created_at>? LIMIT 1`,
      [scope.companyId, customerId, preview.stage, templateId, new Date(now.getTime() - rule.interval_hours * 3600000)]);
    if (rule.interval_hours&&recent) throw operationError(409, 'El intervalo de esta regla impide otro mensaje.');
    await enforceLimits(db, scope, settings, rule, customerId, day);
    const [inserted] = await db.query(`INSERT INTO messages (company_id,customer_id,invoice_id,template_id,created_by,channel,recipient,content,status,
      provider,stage,direction,message_mode,idempotency_key,scheduled_at,budget_date) VALUES (?,?,?,?,?,'whatsapp',?,?,'PENDING',?,?,'outbound',?,?,?,?)`,
      [scope.companyId, customerId, preview.main_invoice?.id ?? null, templateId, actorId, phone, preview.content, settings.provider, preview.stage, body.mode, key, scheduledAt, day]);
    await audit(db, scope, actorId, 'queued', 'whatsapp_message', inserted.insertId, { status: 'PENDING', stage: preview.stage,customer_id:customerId,invoice_id:selection?.invoice.invoice_id||preview.main_invoice?.id||null,contact_date:selection?.step.date||day,invoice_ids:selection?.invoice_ids||[],amount:selection?.balance||null,mode:body.mode });
    return { message: await messageById(db, scope, inserted.insertId), duplicate: false };
  }, dbPool);
}

export async function mockSendWhatsApp({ scope, actorId, messageId, customerId, fail = false, now = new Date() }, dbPool = pool) {
  const id = operationId(messageId, 'message_id');
  if (typeof fail !== 'boolean') throw operationError(400, 'fail debe ser booleano.');
  return transaction(scope, async (db, settings) => {
    connected(settings);
    const message = await messageById(db, scope, id, true);
    if(customerId&&String(customerId)!==String(message.customer_id))throw operationError(404,'Mensaje no encontrado para este cliente.');
    if (message.message_mode === 'AUTOMATICO') return dispatchAutomatic(db, { ...scope, actorId: null }, settings, message, now, fail);
    if (message.direction !== 'outbound' || message.provider !== 'MOCK' || !['PENDING', 'FAILED'].includes(message.status)) throw operationError(409, 'El mensaje no puede procesarse en MOCK.');
    if (message.attempts >= RETRY_POLICY.max_attempts) throw operationError(409, 'Máximo de intentos alcanzado.');
    if (message.next_attempt_at && new Date(message.next_attempt_at) > now) throw operationError(409, 'El reintento todavía no está disponible.');
    let rule = settings.rules.find(item => item.stage === message.stage && item.enabled && item.mode === message.message_mode && item.template_id === message.template_id);
    let resolvedContext;
    rule=rule||(message.message_mode==='MANUAL'?{stage:message.stage,daily_limit:settings.global_daily_limit}:null);
    if(!rule)throw operationError(409,'La regla no está activa.');
    const preview = await collectionMessage({ scope, customerId: message.customer_id, templateId: message.template_id, referenceDate: bogotaDate(now), step: 'prepare', transactionDb: db,resolvedContext }, dbPool);
    const phone=normalizePhone(preview.customer.phone);
    if (preview.stage !== message.stage || preview.content !== message.content || phone !== message.recipient) throw operationError(409, 'El contexto del cliente cambió. Cancela el mensaje y prepara uno actualizado.');
    const window = rule.start_time?nextWindow(rule, now):new Date(now);
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
  return transaction(scope, async (db, settings) => {
    const [[existing]] = await db.query("SELECT CAST(id AS CHAR) AS id FROM messages WHERE company_id=? AND provider='MOCK' AND provider_message_id=?", [scope.companyId, dto.provider_message_id]);
    if (existing) return { message: await messageById(db, scope, existing.id), duplicate: true };
    const [customers] = await db.query("SELECT CAST(id AS CHAR) AS id,phone FROM customers WHERE company_id=? AND status='active' AND deleted_at IS NULL AND phone IS NOT NULL", [scope.companyId]);
    const matches = customers.filter(customer => { try { return normalizePhone(customer.phone) === dto.phone; } catch { return false; } });
    if (matches.length !== 1) throw operationError(409, 'El teléfono debe identificar un único cliente MERTEL.');
    const [result] = await db.query(`INSERT INTO messages (company_id,customer_id,channel,recipient,content,status,provider,provider_message_id,direction,received_at)
      VALUES (?,?,'whatsapp',?,?,'DELIVERED','MOCK',?,'inbound',?)`, [scope.companyId, matches[0].id, dto.phone, dto.content, dto.provider_message_id, dto.received_at]);
    if (['BAJA', 'STOP', 'CANCELAR'].includes(dto.content.trim().toUpperCase())) {
      settings.excluded_customers = { ...settings.excluded_customers, [matches[0].id]: { source: dto.content.trim().toUpperCase(), date: dto.received_at } };
      await saveSettings(db, scope, actorId, settings, 'customer_excluded');
    }
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
    const [rows] = await db.query(`SELECT ${messageColumns} FROM messages m LEFT JOIN customers c ON c.id=m.customer_id AND c.company_id=m.company_id
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

export async function processWhatsAppAutomations({scope,actorId,now=new Date()},dbPool=pool){
  const systemScope={...scope,actorId:null};
  const active=await transaction(systemScope,async(db,settings)=>settings.provider==='MOCK'&&settings.connection_status==='CONNECTED'&&settings.automations_enabled,dbPool);
  if(!active)return {queued:0,sent:0,cancelled:0,skipped:0,enabled:false};
  const result={queued:0,sent:0,cancelled:0,skipped:0,enabled:true};
  const [customers]=await dbPool.query("SELECT CAST(id AS CHAR) id FROM customers WHERE company_id=? AND status='active' AND deleted_at IS NULL ORDER BY id",[scope.companyId]);
  for(const customer of customers){
    try{const value=await enqueueWhatsApp({scope:systemScope,body:{customer_id:customer.id,mode:'AUTOMATICO'},now},dbPool);if(!value.duplicate)result.queued++;}
    catch(error){if(![400,403,404,409].includes(error.status))throw error;result.skipped++;}
  }
  const [messages]=await dbPool.query("SELECT CAST(id AS CHAR) id FROM messages WHERE company_id=? AND message_mode='AUTOMATICO' AND UPPER(status) IN ('PENDING','FAILED') AND attempts<3 AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY scheduled_at,id",[scope.companyId,now]);
  for(const message of messages){
    try{const value=await mockSendWhatsApp({scope:systemScope,messageId:message.id,now},dbPool);if(value.message.status==='SENT')result.sent++;if(value.cancelled)result.cancelled++;}
    catch(error){if(![400,403,404,409].includes(error.status))throw error;result.skipped++;}
  }
  // A user can request evaluation, but individual automatic messages keep their SYSTEM actor.
  if(actorId&&result.queued+result.sent+result.cancelled)await transaction(scope,db=>audit(db,scope,actorId,'automation_evaluated','whatsapp_setting',null,result),dbPool);
  return result;
}

async function automaticInput(db, scope, settings, customerId, day) {
  const [[customer]] = await db.query("SELECT CAST(id AS CHAR) id,name,nit,phone,credit_limit,available_credit FROM customers WHERE company_id=? AND id=? AND status='active' AND deleted_at IS NULL FOR UPDATE", [scope.companyId, customerId]);
  if (!customer) throw operationError(404, 'Cliente no encontrado.');
  const [invoices] = await db.query(`SELECT CAST(id AS CHAR) id,CAST(id AS CHAR) invoice_id,CAST(customer_id AS CHAR) customer_id,
    DATE_FORMAT(issue_date,'%Y-%m-%d') issue_date,DATE_FORMAT(due_date,'%Y-%m-%d') due_date,
    invoice_number,document_value,base_value,iva_value,balance,promo_18,discount,notes,deleted_at
    FROM invoices WHERE company_id=? AND customer_id=? AND deleted_at IS NULL ORDER BY due_date,id FOR UPDATE`, [scope.companyId, customerId]);
  const [templates] = await db.query("SELECT CAST(id AS CHAR) id,name,stage,status,channel,content FROM message_templates WHERE company_id=? AND channel='whatsapp'", [scope.companyId]);
  const [messages] = await db.query(`SELECT ${messageColumns} FROM messages m JOIN customers c ON c.id=m.customer_id AND c.company_id=m.company_id
    LEFT JOIN message_templates t ON t.id=m.template_id AND t.company_id=m.company_id WHERE m.company_id=? AND m.customer_id=? ORDER BY m.id DESC`, [scope.companyId, customerId]);
  const rules = await loadCompanyCollectionRules(scope.companyId, db);
  return { customer, invoices, templates, messages, rules, settings, referenceDate: day };
}

async function oneAutomaticPerDay(db, scope, customerId, day, excludeId = null) {
  const [[row]] = await db.query(`SELECT COUNT(*) count FROM messages WHERE company_id=? AND customer_id=? AND message_mode='AUTOMATICO'
    AND direction='outbound' AND (DATE(CONVERT_TZ(sent_at,'+00:00','-05:00'))=? OR (budget_date=? AND UPPER(status)<>'CANCELLED'))
    AND (? IS NULL OR id<>?)`, [scope.companyId, customerId, day, day, excludeId, excludeId]);
  if (Number(row.count)) throw operationError(409, 'Máximo un mensaje automático por cliente y día.');
}
function renderAutomatic(notice, day) {
  try { return renderAutomaticNotice(notice, day); } catch (error) { throw operationError(409, error.message); }
}
async function enqueueAutomatic(db, scope, settings, customerId, now) {
  connected(settings);
  if (!settings.automations_enabled) throw operationError(409, 'Automatizaciones desactivadas.');
  const input = await automaticInput(db, scope, settings, customerId, bogotaDate(now));
  if (settings.excluded_customers?.[customerId]) throw operationError(409, 'Cliente excluido de mensajes automáticos.');
  if (!validMobile(input.customer.phone)) throw operationError(409, 'Cliente sin celular válido; no consume cupo.');
  const notice = automaticSelection(input);
  if (!notice) throw operationError(409, 'No hay un aviso automático vigente pendiente de envío.');
  if (notice.message) return { message: notice.message, duplicate: true };
  const key = createHash('sha256').update(JSON.stringify([String(scope.companyId), customerId, 'AVISO_MERTEL', notice.stage, notice.date])).digest('hex');
  const [[duplicate]] = await db.query('SELECT CAST(id AS CHAR) id FROM messages WHERE company_id=? AND idempotency_key=?', [scope.companyId, key]);
  if (duplicate) return { message: await messageById(db, scope, duplicate.id), duplicate: true };
  const scheduled = automaticWindow(notice, input.rules, now, input.messages);
  const context = { notice_date: notice.date, expires_on: notice.expires_on, invoice_ids: notice.invoice_ids, reason: notice.description,
    cancellation_reason: scheduled ? null : 'No hay día permitido dentro del plazo máximo del aviso.' };
  const content = renderAutomatic(notice, input.referenceDate);
  if (scheduled) {
    await oneAutomaticPerDay(db, scope, customerId, bogotaDate(scheduled));
    await enforceLimits(db, scope, settings, notice.rule, customerId, bogotaDate(scheduled));
  }
  const [inserted] = await db.query(`INSERT INTO messages(company_id,customer_id,invoice_id,template_id,channel,recipient,content,status,provider,stage,direction,message_mode,idempotency_key,scheduled_at,budget_date,automation_context)
    VALUES (?,?,?,?,'whatsapp',?,?,?,? ,?,'outbound','AUTOMATICO',?,?,?,?)`,
    [scope.companyId, customerId, notice.invoice.id ?? notice.invoice.invoice_id, notice.template.id, normalizePhone(input.customer.phone), content,
      scheduled ? 'PENDING' : 'CANCELLED', settings.provider, notice.stage, key, scheduled, scheduled ? bogotaDate(scheduled) : null, JSON.stringify(context)]);
  await audit(db, scope, null, scheduled ? 'queued' : 'cancelled', 'whatsapp_message', inserted.insertId, { ...context, actor_type: 'SYSTEM' });
  return { message: await messageById(db, scope, inserted.insertId), duplicate: false };
}
async function dispatchAutomatic(db, scope, settings, message, now, fail) {
  if (message.sent_at || ['SENT', 'DELIVERED', 'READ'].includes(message.status)) return { message, duplicate: true, simulated: true };
  if (!['PENDING', 'FAILED'].includes(message.status)) throw operationError(409, 'El mensaje automático no puede enviarse.');
  const context = noticeContext(message), day = bogotaDate(now);
  const input = await automaticInput(db, scope, settings, message.customer_id, day);
  const cancel = async reason => {
    await db.query("UPDATE messages SET status='CANCELLED',next_attempt_at=NULL,automation_context=? WHERE id=? AND company_id=?", [JSON.stringify({ ...context, cancellation_reason: reason }), message.id, scope.companyId]);
    await audit(db, scope, null, 'cancelled', 'whatsapp_message', message.id, { reason, actor_type: 'SYSTEM' });
    return { message: await messageById(db, scope, message.id), cancelled: true, simulated: true };
  };
  if (!context) return cancel('Aviso anterior sin identidad permanente; requiere revisión.');
  if (day > context.expires_on) return cancel('Aviso descartado: superó su ventana máxima de 3 días o el día calendario 10.');
  if (!settings.automations_enabled || settings.excluded_customers?.[message.customer_id]) return cancel('Automatización desactivada o cliente excluido.');
  if (!validMobile(input.customer.phone)) return cancel('Cliente sin celular válido; no consume cupo.');
  const notice = automaticNotices(input).find(row => row.stage === message.stage && row.date === context.notice_date);
  if (!notice?.applicable) return cancel(notice?.reason || 'La cartera aplicable ya fue pagada o el aviso dejó de aplicar.');
  const winner = automaticSelection(input);
  if (winner && MERTEL_CONTACTS.findIndex(row => row.stage === winner.stage) > MERTEL_CONTACTS.findIndex(row => row.stage === notice.stage)) return cancel('Se priorizó un aviso de mayor urgencia.');
  if (message.attempts >= RETRY_POLICY.max_attempts) return cancel('Se agotaron los intentos del aviso.');
  if (message.next_attempt_at && new Date(message.next_attempt_at) > now) return { message, simulated: true };
  const scheduled = automaticWindow(notice, input.rules, now, input.messages);
  if (!scheduled) return cancel('No hay día permitido dentro del plazo máximo.');
  const content = renderAutomatic(notice, day), recipient = normalizePhone(input.customer.phone);
  await oneAutomaticPerDay(db, scope, message.customer_id, bogotaDate(scheduled), message.id);
  await enforceLimits(db, scope, settings, notice.rule, message.customer_id, bogotaDate(scheduled), message.id);
  if (scheduled > now) {
    await db.query('UPDATE messages SET scheduled_at=?,budget_date=?,content=?,recipient=? WHERE id=? AND company_id=?', [scheduled, bogotaDate(scheduled), content, recipient, message.id, scope.companyId]);
    return { message: await messageById(db, scope, message.id), scheduled: true, simulated: true };
  }
  const attempts = Number(message.attempts) + 1;
  await db.query("UPDATE messages SET status='PROCESSING',content=?,recipient=?,attempts=?,last_attempt_at=?,budget_date=? WHERE id=? AND company_id=?", [content, recipient, attempts, now, day, message.id, scope.companyId]);
  const result = await whatsappProvider(settings.provider).sendTemplateMessage({ content, recipient, fail });
  await db.query('UPDATE messages SET status=?,provider_message_id=?,sent_at=?,error_code=?,error_message=?,next_attempt_at=? WHERE id=? AND company_id=?',
    [result.status, result.provider_message_id ?? null, result.status === 'SENT' ? now : null, result.error_code ?? null, result.error_message ?? null,
      result.status === 'FAILED' ? retryAt(attempts, now) : null, message.id, scope.companyId]);
  await audit(db, scope, null, result.status.toLowerCase(), 'whatsapp_message', message.id, { notice_date: context.notice_date, actor_type: 'SYSTEM', simulated: true });
  return { message: await messageById(db, scope, message.id), simulated: true };
}

export async function getCustomerWhatsAppSequence({ scope, customerId, filters = {}, now = new Date() }, dbPool = pool) {
  customerId = operationId(customerId, 'customer_id');
  const day = filters.reference_date || bogotaDate(now);
  try { dateDay(day); } catch { throw operationError(400, 'Fecha de referencia inválida.'); }
  return transaction(scope, async (db, settings) => buildWhatsAppSequence(await automaticInput(db, scope, settings, customerId, day)), dbPool);
}
export async function excludeWhatsAppCustomer({ scope, actorId, customerId, body }, dbPool = pool) {
  customerId = operationId(customerId, 'customer_id');
  if (!body || Object.keys(body).some(key => key !== 'excluded') || typeof body.excluded !== 'boolean') throw operationError(400, 'Indica el estado de exclusión.');
  return transaction(scope, async (db, settings) => {
    const [[customer]] = await db.query('SELECT id FROM customers WHERE company_id=? AND id=? AND deleted_at IS NULL', [scope.companyId, customerId]);
    if (!customer) throw operationError(404, 'Cliente no encontrado.');
    settings.excluded_customers = { ...settings.excluded_customers };
    if (body.excluded) settings.excluded_customers[customerId] = { source: 'MANUAL', date: new Date().toISOString() };
    else delete settings.excluded_customers[customerId];
    await saveSettings(db, scope, actorId, settings, body.excluded ? 'customer_excluded' : 'customer_included');
    return { customer_id: customerId, excluded: body.excluded };
  }, dbPool);
}
