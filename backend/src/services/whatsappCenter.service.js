import { createHash } from 'node:crypto';
import pool from '../config/database.js';
import {buildWhatsAppSequence,automaticSelection,automaticNotices,automaticContent,automaticDayAllowed,automaticHours,noticeContext,validMobile,automaticWindow,renderAutomaticNotice,MERTEL_CONTACTS} from './whatsappSequence.js';
import {dateDay,dateFromDay} from './promptPayment.service.js';
import { validCompanyId } from '../utils/companyScope.js';
import { operationError, operationId } from './collectionOperations.validation.js';
import { loadCompanyCollectionRules } from './companyCollection.service.js';
import { collectionStageCatalog } from './collectionPolicy.js';
import { collectionMessage } from './collectionMessages.service.js';
import { renderMessageTemplate } from '../utils/messageTemplate.js';
import { normalizePhone, whatsappProvider } from './whatsappProvider.service.js';
import { buildMertelInvoiceMessage, isMertelInvoiceTemplate, MERTEL_INVOICE_BODY, MERTEL_INVOICE_TEMPLATE } from './mertelInvoiceWhatsApp.js';
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
async function saveSettings(db, scope, actorId, settings, action, details = {}) {
  await db.query(`INSERT INTO settings (company_id,setting_key,setting_value,value_type,description) VALUES (?,?,?,'json','Centro WhatsApp MERTEL')
    ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)`, [scope.companyId, SETTING, JSON.stringify(settings)]);
  const [[row]] = await db.query('SELECT id FROM settings WHERE company_id=? AND setting_key=?', [scope.companyId, SETTING]);
  await audit(db, scope, actorId, action, 'whatsapp_setting', row.id, { ...publicWhatsAppSettings(settings), ...details });
}
async function stagesFor(db, scope) { return collectionStageCatalog(await loadCompanyCollectionRules(scope.companyId, db)); }
function connected(settings) {
  if (runtimeProvider(settings) !== 'MOCK' || settings.connection_status !== 'CONNECTED') throw operationError(409, 'Esta operación de prueba requiere una conexión MOCK.');
}

function runtimeProvider(settings) {
  const meta = String(process.env.WHATSAPP_PROVIDER || '').toLowerCase() === 'meta';
  if (process.env.NODE_ENV === 'production') return meta ? 'WHATSAPP_CLOUD_API' : null;
  if (process.env.WHATSAPP_TEST_MODE === 'false' && meta) return 'WHATSAPP_CLOUD_API';
  if (settings?.provider === 'MOCK') return 'MOCK';
  return meta ? 'WHATSAPP_CLOUD_API' : settings.provider;
}
function automationProvider(settings) {
  if (settings.connection_status !== 'CONNECTED') return null;
  const provider = runtimeProvider(settings);
  if (provider === 'MOCK') return provider;
  return provider === 'WHATSAPP_CLOUD_API' && process.env.WHATSAPP_TEST_MODE === 'false' ? provider : null;
}
function requireAutomationProvider(settings) {
  const provider = automationProvider(settings);
  if (!provider) throw operationError(409, 'Conecta WhatsApp Cloud API y habilita el envío real antes de automatizar.');
  return provider;
}
function hasWhatsAppConsent(settings, customer) {
  return validMobile(customer.phone) && settings.authorized_recipients?.[String(customer.id)]?.recipient === normalizePhone(customer.phone);
}
function collectionContactPhone(settings) {
  try { return settings.collection_contact_phone ? normalizePhone(settings.collection_contact_phone) : null; }
  catch { return null; }
}
function requireCollectionContactPhone(settings) {
  const phone = collectionContactPhone(settings);
  if (!phone) throw operationError(409, 'Configura el número de contacto de cobranza antes de activar o enviar avisos reales.');
  return phone;
}
async function hasSharedWhatsAppNumber(db, scope, customer) {
  const phone = normalizePhone(customer.phone);
  const [others] = await db.query("SELECT phone FROM customers WHERE company_id=? AND id<>? AND status='active' AND deleted_at IS NULL AND phone IS NOT NULL", [scope.companyId, customer.id]);
  return others.some(row => {
    try { return normalizePhone(row.phone) === phone; } catch { return false; }
  });
}
async function requireApprovedInvoiceTemplate() {
  const templates = await whatsappProvider('WHATSAPP_CLOUD_API').listMessageTemplates();
  if (!templates.some(isMertelInvoiceTemplate)) throw operationError(409, 'Meta todavía no tiene aprobada la plantilla de estado de facturas en español con el formato esperado.');
}

export async function getWhatsAppCenter({ scope }, dbPool = pool) {
  return transaction(scope, async (db, settings) => {
    const provider = runtimeProvider(settings);
    return {
      settings: publicWhatsAppSettings({ ...settings, provider }), stage_catalog: await stagesFor(db, scope), contact_rules: MERTEL_CONTACTS,
      ...(provider === 'WHATSAPP_CLOUD_API' ? { conversation_customers: settings.conversation_customers } : {}),
    };
  }, dbPool);
}

async function customersAtNumber(db, scope, recipient) {
  const [customers] = await db.query("SELECT CAST(id AS CHAR) id,phone FROM customers WHERE company_id=? AND status='active' AND deleted_at IS NULL AND phone IS NOT NULL", [scope.companyId]);
  return customers.filter(customer => { try { return normalizePhone(customer.phone) === recipient; } catch { return false; } });
}

async function metaConversationCustomer(db, scope, settings, recipient) {
  const matches = await customersAtNumber(db, scope, recipient);
  const confirmed = settings.conversation_customers?.[recipient];
  return matches.find(customer => customer.id === confirmed)?.id ?? (matches.length === 1 ? matches[0].id : null);
}

export async function associateMetaConversation({ scope, actorId, body }, dbPool = pool) {
  if (!body || Object.keys(body).some(key => !['recipient', 'customer_id'].includes(key))) throw operationError(400, 'Selecciona el número y el cliente.');
  const customerId = operationId(body.customer_id, 'customer_id');
  let recipient;
  try { recipient = normalizePhone(body.recipient); }
  catch { throw operationError(400, 'Número de WhatsApp inválido.'); }
  return transaction(scope, async (db, settings) => {
    if (automationProvider(settings) !== 'WHATSAPP_CLOUD_API') throw operationError(409, 'Conecta el canal real de WhatsApp.');
    const matches = await customersAtNumber(db, scope, recipient);
    if (!matches.some(customer => customer.id === customerId)) throw operationError(409, 'El número no corresponde a ese cliente activo.');
    const confirmed = settings.conversation_customers[recipient];
    if (confirmed !== customerId && matches.some(customer => customer.id === confirmed)) {
      throw operationError(409, 'Otro administrador ya vinculó esta conversación. Actualiza la bandeja.');
    }
    const [updated] = await db.query(`UPDATE messages SET customer_id=? WHERE company_id=? AND recipient=?
      AND channel='whatsapp' AND provider='WHATSAPP_CLOUD_API' AND customer_id IS NULL`, [customerId, scope.companyId, recipient]);
    if (confirmed !== customerId || updated.affectedRows) {
      settings.conversation_customers[recipient] = customerId;
      await saveSettings(db, scope, actorId, settings, 'conversation_associated',
        { recipient, customer_id: customerId, messages_linked: updated.affectedRows });
    }
    return { customer_id: customerId, recipient, messages_linked: updated.affectedRows };
  }, dbPool);
}
function requireContactTemplate(rule,template,provider){
  const expected=MERTEL_CONTACTS.find(step=>step.stage===rule.stage);
  const name = provider === 'WHATSAPP_CLOUD_API' ? MERTEL_INVOICE_TEMPLATE : expected?.template_name;
  if(rule.mode==='AUTOMATICO'&&(!expected||template.name!==name))throw operationError(409,'Selecciona la plantilla MERTEL correspondiente a esta regla automática.');
}
export async function updateWhatsAppSettings({ scope, actorId, body }, dbPool = pool) {
  const allowed = ['provider', 'number', 'phone_number_id', 'business_account_id', 'collection_contact_phone', 'credentials', 'global_daily_limit', 'customer_daily_limit', 'automations_enabled'];
  if (!body || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) throw operationError(400, 'Campos de configuración inválidos.');
  return transaction(scope, async (db, settings) => {
    let changedConnection = false;
    for (const key of ['provider', 'number', 'phone_number_id', 'business_account_id']) {
      if (!Object.hasOwn(body, key)) continue;
      if (key === 'provider' ? ![null, 'MOCK', 'WHATSAPP_CLOUD_API'].includes(body[key]) : typeof body[key] !== 'string' || body[key].length > 100) throw operationError(400, 'Proveedor o identificador inválido.');
      if (key === 'provider' && body[key] === 'MOCK' &&
          (process.env.NODE_ENV === 'production' || runtimeProvider(settings) === 'WHATSAPP_CLOUD_API' && process.env.WHATSAPP_TEST_MODE === 'false')) {
        throw operationError(409, 'El servidor está configurado para el canal real de WhatsApp.');
      }
      if (key === 'number' && body[key]) { try { body[key] = normalizePhone(body[key]); } catch { throw operationError(400, 'Número inválido.'); } }
      if (settings[key] !== body[key]) changedConnection = true;
      settings[key] = body[key];
    }
    if (Object.hasOwn(body, 'collection_contact_phone')) {
      if (typeof body.collection_contact_phone !== 'string' || !body.collection_contact_phone.trim()) throw operationError(400, 'Número de contacto de cobranza inválido.');
      try { settings.collection_contact_phone = normalizePhone(body.collection_contact_phone); }
      catch { throw operationError(400, 'Número de contacto de cobranza inválido.'); }
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
        const provider = requireAutomationProvider(settings);
        const configuredLimit = provider === 'WHATSAPP_CLOUD_API'
          ? settings.automatic_daily_limit ?? settings.global_daily_limit
          : settings.global_daily_limit && settings.customer_daily_limit;
        if (!configuredLimit || !settings.rules.some(rule => rule.enabled && rule.mode === 'AUTOMATICO')) throw operationError(409, 'Define el cupo y una regla automática activa antes de activar automatizaciones.');
        const stages = await stagesFor(db, scope);
        for (const rule of settings.rules.filter(item => item.enabled && item.mode === 'AUTOMATICO')) {
          validateRule(rule, stages);
          const [[template]] = await db.query("SELECT name,stage,status,content FROM message_templates WHERE id=? AND company_id=? AND channel='whatsapp'", [rule.template_id, scope.companyId]);
          if (!template || template.status !== 'active' || (template.stage && template.stage !== rule.stage)) throw operationError(409, 'La automatización requiere una plantilla activa y compatible.');
          validateTemplateContent(template.content);
          requireContactTemplate(rule,template,provider);
        }
        if (provider === 'WHATSAPP_CLOUD_API') { requireCollectionContactPhone(settings); await requireApprovedInvoiceTemplate(); }
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
    if (rule.enabled) {
      if (rule.mode === 'AUTOMATICO') requireAutomationProvider(settings);
      else connected(settings);
    }
    if (rule.enabled) validateTemplateContent(template.content);
    requireContactTemplate(rule,template,runtimeProvider(settings));
    settings.rules = [...settings.rules.filter(item => item.stage !== stage), rule];
    await saveSettings(db, scope, actorId, settings, 'automation_update'); return rule;
  }, dbPool);
}
export async function getMetaAutomationLimit({ scope }, dbPool = pool) {
  await transaction(scope, async (db, settings) => {
    if (runtimeProvider(settings) !== 'WHATSAPP_CLOUD_API') throw operationError(409, 'WhatsApp Cloud API no está configurada.');
  }, dbPool);
  try {
    return { meta_limit: await whatsappProvider('WHATSAPP_CLOUD_API').getMessagingLimit() };
  } catch (error) {
    throw operationError(409, error.message || 'No se pudo consultar el cupo de Meta.');
  }
}
export async function configureAutomaticSchedule({ scope, actorId, body }, dbPool = pool) {
  if (!body || Object.keys(body).some(key => key !== 'daily_limit')) throw operationError(400, 'Indica el cupo diario.');
  const dailyLimit = positiveLimit(body.daily_limit, 'Cupo diario', false);
  const { meta_limit: metaLimit } = await getMetaAutomationLimit({ scope }, dbPool);
  if (metaLimit !== null && dailyLimit > metaLimit) throw operationError(400, `El cupo de MERTEL debe ser de máximo ${metaLimit}, según el límite actual del portafolio Meta.`);
  return transaction(scope, async (db, settings) => {
    if (requireAutomationProvider(settings) !== 'WHATSAPP_CLOUD_API') throw operationError(409, 'Conecta el canal real de WhatsApp.');
    requireCollectionContactPhone(settings);
    const stages = await stagesFor(db, scope);
    const [[template]] = await db.query(`SELECT CAST(id AS CHAR) id,content FROM message_templates WHERE company_id=? AND
      channel='whatsapp' AND name=? AND status='active' AND stage IS NULL ORDER BY id LIMIT 1`, [scope.companyId, MERTEL_INVOICE_TEMPLATE]);
    if (!template) throw operationError(409, 'Activa la plantilla general de estado de facturas en MERTEL.');
    validateTemplateContent(template.content);
    const rules = MERTEL_CONTACTS.filter(step => stages.some(stage => stage.key === step.stage)).map(step =>
      validateRule({ stage: step.stage, mode: 'AUTOMATICO', enabled: true, template_id: template.id,
        start_time: '07:00', end_time: '17:00', weekdays: [1, 2, 3, 4, 5, 6], daily_limit: dailyLimit, interval_hours: 1 }, stages));
    if (!rules.length) throw operationError(409, 'Activa al menos una etapa en las reglas de cobranza.');
    settings.automatic_daily_limit = dailyLimit;
    settings.rules = [...settings.rules.filter(rule => !rules.some(item => item.stage === rule.stage)), ...rules];
    await saveSettings(db, scope, actorId, settings, 'automatic_schedule_configured');
    return { ...publicWhatsAppSettings(settings), meta_limit: metaLimit };
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
    if (runtimeProvider(settings) !== 'MOCK') throw operationError(409, 'Esta validación requiere el proveedor de pruebas local.');
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
  if (process.env.WHATSAPP_TEST_MODE !== 'true') throw operationError(409, 'El modo de pruebas está desactivado.');
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
  if (process.env.WHATSAPP_TEST_MODE !== 'true') throw operationError(409, 'El modo de pruebas está desactivado.');
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
  return deliverMetaText({ scope, actorId, message: claimed.message, now, testMode: true }, dbPool);
}

async function deliverMetaText({ scope, actorId, message, now, testMode, template, sendBefore, clock, attachment }, dbPool) {
  const { id, recipient, content } = message;
  let result;
  try {
    const provider = whatsappProvider('WHATSAPP_CLOUD_API');
    if (template) {
      result = await provider.sendTemplateMessage({ recipient, manual: message.message_mode !== 'AUTOMATICO', template, expectedBody: MERTEL_INVOICE_BODY,
        callbackId: `mertel-invoice:${id}`, sendBefore, clock });
    } else if (attachment) {
      const mediaId = await provider.uploadMedia(attachment);
      if (Date.now() >= sendBefore.getTime()) throw operationError(409, 'La ventana de respuesta terminó durante la carga del archivo.');
      const media = { id: mediaId, ...(attachment.type === 'document' ? { filename: attachment.name } : {}),
        ...(attachment.caption ? { caption: attachment.caption } : {}) };
      result = await provider.sendMessage({ recipient, manual: true, payload: {
        type: attachment.type, [attachment.type]: media, biz_opaque_callback_data: `mertel-media:${id}`,
      } });
    } else {
      result = await provider.sendMessage({ recipient, manual: true, payload: { type: 'text', text: { preview_url: false, body: content } } });
    }
  } catch (error) {
    return transaction(scope, async db => {
      const code = String(error?.code || 'META_SEND_FAILED').slice(0, 100);
      const retry = message.message_mode === 'AUTOMATICO' && (error.httpStatus === 429 || code === 'META_SCHEDULE_CLOSED')
        ? retryAt(Number(message.attempts), now) : null;
      const [updated] = await db.query("UPDATE messages SET status='FAILED',error_code=?,error_message=?,next_attempt_at=? WHERE id=? AND company_id=? AND status='PROCESSING'", [code, String(error?.message || 'Meta rechazó el envío.').slice(0, 500), retry, id, scope.companyId]);
      if (updated.affectedRows) await audit(db, scope, actorId, 'meta_failed', 'whatsapp_message', id, { error_code: code, test_mode: testMode });
      const saved = await messageById(db, scope, id);
      return { message: saved, accepted: ['SENT', 'DELIVERED', 'READ'].includes(saved.status) };
    }, dbPool);
  }
  return transaction(scope, async db => {
    const [updated] = await db.query("UPDATE messages SET status='SENT',provider_message_id=?,sent_at=?,error_code=NULL,error_message=NULL,next_attempt_at=NULL WHERE id=? AND company_id=? AND status='PROCESSING'", [result.provider_message_id, now, id, scope.companyId]);
    if (updated.affectedRows) await audit(db, scope, actorId, 'meta_accepted', 'whatsapp_message', id, { provider_message_id: result.provider_message_id, accepted_at: now, test_mode: testMode });
    const saved = await messageById(db, scope, id);
    return { message: saved, accepted: ['SENT', 'DELIVERED', 'READ'].includes(saved.status) };
  }, dbPool);
}

export async function replyToMetaConversation({ scope, actorId, body, now = new Date(), attachment }, dbPool = pool) {
  if (process.env.WHATSAPP_TEST_MODE !== 'false') throw operationError(409, 'El envío normal de WhatsApp está desactivado.');
  if (!body || Object.keys(body).some(key => !['recipient', 'content', 'customer_id'].includes(key)) ||
      typeof body.content !== 'string' || (!attachment && !body.content.trim()) ||
      body.content.length > (attachment ? 1024 : 4096) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(body.content)) {
    throw operationError(400, attachment ? 'Escribe un texto de hasta 1.024 caracteres para el adjunto.' : 'Escribe un mensaje de hasta 4.096 caracteres.');
  }
  let recipient;
  try { recipient = normalizePhone(body.recipient); }
  catch { throw operationError(400, 'Número de WhatsApp inválido.'); }
  const selectedCustomer = body.customer_id === undefined ? null : operationId(body.customer_id, 'customer_id');
  const content = body.content.trim();
  if (attachment?.type === 'audio' && content) throw operationError(400, 'Envía el texto y el audio en mensajes separados.');
  const day = bogotaDate(now);
  const claimed = await transaction(scope, async (db, settings) => {
    if (runtimeProvider(settings) !== 'WHATSAPP_CLOUD_API' || settings.connection_status !== 'CONNECTED') {
      throw operationError(409, 'WhatsApp Cloud API no está conectada.');
    }
    const [[incoming]] = await db.query(`SELECT CAST(m.id AS CHAR) id,m.received_at FROM messages m
      WHERE company_id=? AND channel='whatsapp' AND provider='WHATSAPP_CLOUD_API' AND direction='inbound'
      AND recipient=? AND received_at>? AND received_at<=? ORDER BY m.received_at DESC,m.id DESC LIMIT 1`,
    [scope.companyId, recipient, new Date(now.getTime() - 86_400_000), now]);
    if (!incoming) throw operationError(409, 'La ventana de respuesta de 24 horas está cerrada.');
    const customerId = await metaConversationCustomer(db, scope, settings, recipient);
    if (selectedCustomer && customerId !== selectedCustomer) throw operationError(409, 'El número no está vinculado al cliente seleccionado. Actualiza la bandeja.');
    const keyParts = ['meta-reply', scope.companyId, recipient, content, incoming.id, now.toISOString().slice(0, 16)];
    if (attachment) keyParts.push(attachment.name, createHash('sha256').update(attachment.buffer).digest('hex'));
    const key = createHash('sha256').update(JSON.stringify(keyParts)).digest('hex');
    const [[duplicate]] = await db.query('SELECT CAST(id AS CHAR) id FROM messages WHERE company_id=? AND idempotency_key=?', [scope.companyId, key]);
    if (duplicate) return { message: await messageById(db, scope, duplicate.id), duplicate: true };
    const [[counts]] = await db.query(`SELECT COUNT(*) AS total, COALESCE(SUM(recipient=?),0) AS per_number
      FROM messages WHERE company_id=? AND direction='outbound' AND budget_date=? AND UPPER(status)<>'CANCELLED'`, [recipient, scope.companyId, day]);
    if ((settings.global_daily_limit && Number(counts.total) >= settings.global_daily_limit) ||
        (settings.customer_daily_limit && Number(counts.per_number) >= settings.customer_daily_limit)) {
      throw operationError(429, 'Límite diario alcanzado.');
    }
    const historyText = attachment ? `[Adjunto] ${attachment.name}${content ? '\n' + content : ''}` : content;
    const [inserted] = await db.query(`INSERT INTO messages(company_id,customer_id,created_by,channel,recipient,subject,content,status,provider,direction,message_mode,idempotency_key,scheduled_at,budget_date,attempts,last_attempt_at)
      VALUES (?,?,?,'whatsapp',?,?,?,'PROCESSING','WHATSAPP_CLOUD_API','outbound','MANUAL',?,?,?,1,?)`,
    [scope.companyId, customerId, actorId, recipient, attachment?.name ?? null, historyText, key, now, day, now]);
    const id = String(inserted.insertId);
    await audit(db, scope, actorId, 'meta_request', 'whatsapp_message', id, { recipient, attempts: 1, test_mode: false,
      ...(attachment ? { attachment_type: attachment.type, attachment_size: attachment.buffer.length } : {}) });
    return { message: { id, recipient, content }, sendBefore: new Date(new Date(incoming.received_at).getTime() + 86_400_000) };
  }, dbPool);
  if (claimed.duplicate) return { ...claimed, accepted: ['SENT', 'DELIVERED', 'READ'].includes(claimed.message.status) };
  return deliverMetaText({ scope, actorId, message: claimed.message, now, testMode: false, sendBefore: claimed.sendBefore,
    attachment: attachment ? { ...attachment, caption: content } : null }, dbPool);
}

export async function listMetaMessageTemplates({ scope }, dbPool = pool) {
  return transaction(scope, async (db, settings) => {
    if (runtimeProvider(settings) !== 'WHATSAPP_CLOUD_API') throw operationError(409, 'Meta Cloud API no está configurada en el backend.');
    const templates = await whatsappProvider('WHATSAPP_CLOUD_API').listMessageTemplates();
    return { templates };
  }, dbPool);
}

export async function sendMetaInvoiceNotice({ scope, actorId, body, now = new Date() }, dbPool = pool) {
  if (!body || Object.keys(body).some(key => !['customer_id', 'invoice_ids', 'preview_token'].includes(key)) ||
      !Array.isArray(body.invoice_ids) || !body.invoice_ids.length || body.invoice_ids.length > 25 ||
      (body.preview_token !== undefined && !/^[a-f0-9]{64}$/.test(body.preview_token))) {
    throw operationError(400, 'Selecciona entre 1 y 25 facturas y revisa el aviso.');
  }
  const customerId = operationId(body.customer_id, 'customer_id');
  const invoiceIds = [...new Set(body.invoice_ids.map(id => operationId(id, 'invoice_id')))].sort();
  const day = bogotaDate(now);
  const claimed = await transaction(scope, async (db, settings) => {
    if (requireAutomationProvider(settings) !== 'WHATSAPP_CLOUD_API') throw operationError(409, 'El canal real de WhatsApp no está activo.');
    const input = await automaticInput(db, scope, settings, customerId, day);
    if (!input.contactAuthorized || settings.excluded_customers?.[customerId]) throw operationError(409, 'El cliente no está habilitado para recibir avisos por WhatsApp.');
    if (await hasSharedWhatsAppNumber(db, scope, input.customer)) throw operationError(409, 'El teléfono está asociado a más de un cliente.');
    const invoices = input.invoices.filter(invoice => invoiceIds.includes(String(invoice.id)) && Number(invoice.balance) > 0);
    if (invoices.length !== invoiceIds.length) throw operationError(409, 'Una factura seleccionada ya no tiene saldo o no pertenece al cliente.');
    const prepared = buildMertelInvoiceMessage(input.customer, invoices, { referenceDate: day, contactPhone: requireCollectionContactPhone(settings) });
    const recipient = normalizePhone(input.customer.phone);
    const previewToken = createHash('sha256').update(JSON.stringify([String(scope.companyId), customerId, recipient, invoiceIds, prepared.content])).digest('hex');
    if (!body.preview_token) return { content: prepared.content, preview_token: previewToken };
    if (previewToken !== body.preview_token) throw operationError(409, 'La cartera cambió. Vuelve a revisar el aviso antes de enviarlo.');
    const local = input.templates.find(row => row.name === MERTEL_INVOICE_TEMPLATE && row.status === 'active');
    if (!local) throw operationError(409, 'Activa la plantilla de estado de facturas en MERTEL.');
    const key = createHash('sha256').update(JSON.stringify(['meta-invoice-manual', day, previewToken])).digest('hex');
    const [[duplicate]] = await db.query('SELECT CAST(id AS CHAR) id FROM messages WHERE company_id=? AND idempotency_key=?', [scope.companyId, key]);
    if (duplicate) return { message: await messageById(db, scope, duplicate.id), duplicate: true };
    await requireApprovedInvoiceTemplate();
    const [[counts]] = await db.query(`SELECT COUNT(*) AS total, COALESCE(SUM(recipient=?),0) AS per_number
      FROM messages WHERE company_id=? AND direction='outbound' AND budget_date=? AND UPPER(status)<>'CANCELLED'`, [recipient, scope.companyId, day]);
    if ((settings.global_daily_limit && Number(counts.total) >= settings.global_daily_limit) ||
        (settings.customer_daily_limit && Number(counts.per_number) >= settings.customer_daily_limit)) throw operationError(429, 'Límite diario alcanzado.');
    const [inserted] = await db.query(`INSERT INTO messages(company_id,customer_id,invoice_id,template_id,created_by,channel,recipient,content,status,provider,direction,message_mode,idempotency_key,scheduled_at,budget_date,attempts,last_attempt_at)
      VALUES (?,?,?,?,?,'whatsapp',?,?,'PROCESSING','WHATSAPP_CLOUD_API','outbound','MANUAL',?,?,?,1,?)`,
    [scope.companyId, customerId, invoices.length === 1 ? invoices[0].id : null, local.id, actorId, recipient, prepared.content, key, now, day, now]);
    const id = String(inserted.insertId);
    await audit(db, scope, actorId, 'meta_request', 'whatsapp_message', id, { recipient, invoice_ids: invoiceIds, attempts: 1, test_mode: false });
    return { message: { id, recipient, content: prepared.content }, template: prepared.template };
  }, dbPool);
  if (!claimed.message) return claimed;
  if (claimed.duplicate) return { ...claimed, accepted: ['SENT', 'DELIVERED', 'READ'].includes(claimed.message.status) };
  return deliverMetaText({ scope, actorId, message: claimed.message, now, testMode: false, template: claimed.template }, dbPool);
}

export async function receiveMetaWebhook({ events }, dbPool = pool) {
  if (!Array.isArray(events)) throw new Error('Eventos Meta inválidos.');
  const db = await dbPool.getConnection();
  try {
    await db.beginTransaction();
    const [companies] = await db.query("SELECT id FROM companies WHERE status='active' AND deleted_at IS NULL ORDER BY id LIMIT 2 FOR UPDATE");
    if (companies.length !== 1) throw new Error('El webhook requiere una única compañía activa de MERTEL.');
    const scope = { companyId: String(companies[0].id), actorId: null };
    let settings;
    let hasStoredSettings;
    for (const event of events) {
      if (event.kind === 'status') {
        let [[message]] = await db.query("SELECT CAST(id AS CHAR) id,UPPER(status) status FROM messages WHERE company_id=? AND provider='WHATSAPP_CLOUD_API' AND provider_message_id=? FOR UPDATE", [scope.companyId, event.provider_message_id]);
        if (!message && event.callback_id && event.recipient) {
          // A signed receipt can arrive before the HTTP response or after an ambiguous network failure.
          [[message]] = await db.query(`SELECT CAST(id AS CHAR) id FROM messages WHERE company_id=? AND id=? AND recipient=?
            AND provider='WHATSAPP_CLOUD_API' AND direction='outbound' AND provider_message_id IS NULL
            AND ((? AND subject IS NOT NULL AND template_id IS NULL) OR (NOT ? AND template_id IS NOT NULL))
            AND status IN ('PROCESSING','FAILED') FOR UPDATE`,
          [scope.companyId, event.callback_id, event.recipient, Boolean(event.callback_media), Boolean(event.callback_media)]);
          if (message) {
            await db.query("UPDATE messages SET status='SENT',provider_message_id=?,sent_at=COALESCE(last_attempt_at,?),error_code=NULL,error_message=NULL,next_attempt_at=NULL WHERE company_id=? AND id=?",
              [event.provider_message_id, event.timestamp, scope.companyId, message.id]);
            await audit(db, scope, null, 'meta_accepted', 'whatsapp_message', message.id, { provider_message_id: event.provider_message_id, webhook_at: event.timestamp });
            message.status = 'SENT';
          }
        }
        if (!message) continue;
        if (event.status === 'SENT' || message.status === event.status || !deliveryTransition(message.status, event.status)) continue;
        const column = event.status === 'READ' ? 'read_at' : event.status === 'DELIVERED' ? 'delivered_at' : 'updated_at';
        const error = event.errors?.[0];
        await db.query(`UPDATE messages SET status=?,${column}=?,error_code=?,error_message=?,next_attempt_at=NULL WHERE id=? AND company_id=?`, [event.status, event.timestamp, error?.code || null, error?.message || error?.title || null, message.id, scope.companyId]);
        await audit(db, scope, null, `meta_${event.status.toLowerCase()}`, 'whatsapp_message', message.id, { provider_message_id: event.provider_message_id, status: event.status, webhook_at: event.timestamp });
      } else if (event.kind === 'message') {
        const [[duplicate]] = await db.query("SELECT id FROM messages WHERE company_id=? AND provider='WHATSAPP_CLOUD_API' AND provider_message_id=?", [scope.companyId, event.provider_message_id]);
        if (duplicate) continue;
        if (!settings) {
          const [[stored]] = await db.query('SELECT setting_value FROM settings WHERE company_id=? AND setting_key=?', [scope.companyId, SETTING]);
          hasStoredSettings = Boolean(stored);
          settings = { ...defaultWhatsAppSettings(), ...(stored ? JSON.parse(stored.setting_value) : {}) };
        }
        const customerId = await metaConversationCustomer(db, scope, settings, event.phone);
        const content = event.content || `[${event.type || 'media'} recibido · id ${event.media?.id || 'sin identificador'}]`;
        const [result] = await db.query("INSERT INTO messages(company_id,customer_id,channel,recipient,content,status,provider,provider_message_id,direction,received_at) VALUES (?,?,'whatsapp',? ,?,'DELIVERED','WHATSAPP_CLOUD_API',?,'inbound',?)", [scope.companyId, customerId, event.phone, content.slice(0, 16000), event.provider_message_id, event.timestamp]);
        await audit(db, scope, null, 'meta_incoming', 'whatsapp_message', result.insertId, { provider_message_id: event.provider_message_id, type: event.type, linked_customer: Boolean(customerId) });
        if (hasStoredSettings && ['BAJA', 'STOP', 'CANCELAR'].includes(String(event.content || '').trim().toUpperCase())) {
          for (const [id, contact] of Object.entries(settings.authorized_recipients)) {
            if (contact.recipient !== event.phone) continue;
            delete settings.authorized_recipients[id];
            await audit(db, scope, null, 'whatsapp_opt_out', 'customer', id, { recipient: event.phone, provider_message_id: event.provider_message_id });
          }
          await saveSettings(db, scope, null, settings, 'customer_opt_out');
        }
      }
    }
    await db.commit();
  } catch (error) { try { await db.rollback(); } catch { /* preserve original */ } throw error; }
  finally { db.release(); }
}
export async function enqueueWhatsApp({ scope, actorId, body, now = new Date(), metaLimit }, dbPool = pool) {
  if (!body || Object.keys(body).some(key => !['customer_id', 'template_id', 'mode'].includes(key)) || !['MANUAL', 'AUTOMATICO'].includes(body.mode)) throw operationError(400, 'Modo o campos de mensaje inválidos.');
  const customerId = operationId(body.customer_id, 'customer_id');
  return transaction(scope, async (db, settings) => {
    if (body.mode === 'AUTOMATICO') return enqueueAutomatic(db, { ...scope, actorId: null }, settings, customerId, now, metaLimit);
    if (runtimeProvider(settings) === 'WHATSAPP_CLOUD_API') throw operationError(409, 'Para un aviso de facturas real, usa Enviar aviso de facturas en el chat del cliente.');
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
    if (message.message_mode === 'AUTOMATICO') {
      if (message.provider !== 'MOCK') throw operationError(409, 'El aviso real lo procesa el motor de WhatsApp.');
      return dispatchAutomatic(db, { ...scope, actorId: null }, settings, message, now, fail);
    }
    if (message.direction !== 'outbound' || !['MOCK', 'WHATSAPP_CLOUD_API'].includes(message.provider) || !['PENDING', 'FAILED'].includes(message.status)) throw operationError(409, 'El mensaje no puede procesarse.');
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
    const provider = message.provider === 'WHATSAPP_CLOUD_API' ? whatsappProvider('WHATSAPP_CLOUD_API') : whatsappProvider('MOCK');
    const result = message.provider === 'WHATSAPP_CLOUD_API'
      ? await provider.sendTemplateMessage({ recipient: message.recipient, manual: true, template: { name: message.template_name, language: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'es' } })
      : await provider.sendTemplateMessage({ content: message.content, recipient: message.recipient, fail });
    await db.query(`UPDATE messages SET status=?,provider_message_id=?,sent_at=?,error_code=?,error_message=?,next_attempt_at=? WHERE id=? AND company_id=?`,
      [result.status, result.provider_message_id ?? null, result.status === 'SENT' ? now : null, result.error_code ?? null,
        result.error_message ?? null, result.status === 'FAILED' ? retryAt(attempts, now) : null, id, scope.companyId]);
    await audit(db, scope, actorId, result.status.toLowerCase(), 'whatsapp_message', id, { status: result.status, simulated: message.provider === 'MOCK', attempts });
    return { message: await messageById(db, scope, id), ...(message.provider === 'MOCK' ? { simulated: true } : { accepted: true }) };
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
  if (process.env.NODE_ENV === 'production') throw operationError(409, 'La entrega real se registra desde Meta.');
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
    if (process.env.NODE_ENV === 'production' || runtimeProvider(settings) === 'WHATSAPP_CLOUD_API') throw operationError(409, 'Las respuestas reales se reciben desde WhatsApp.');
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

export async function processWhatsAppAutomations({ scope, actorId, now, clock = () => now || new Date() }, dbPool = pool) {
  const systemScope={...scope,actorId:null};
  const provider=await transaction(systemScope,async(db,settings)=>settings.automations_enabled && automationProvider(settings),dbPool);
  if(!provider)return {queued:0,sent:0,cancelled:0,skipped:0,enabled:false};
  const metaLimit = provider === 'WHATSAPP_CLOUD_API' ? (await getMetaAutomationLimit({ scope }, dbPool)).meta_limit : null;
  const result={queued:0,sent:0,cancelled:0,skipped:0,enabled:true};
  const [customers]=await dbPool.query("SELECT CAST(id AS CHAR) id FROM customers WHERE company_id=? AND status='active' AND deleted_at IS NULL ORDER BY id",[scope.companyId]);
  for(const customer of customers){
    try{const value=await enqueueWhatsApp({scope:systemScope,body:{customer_id:customer.id,mode:'AUTOMATICO'},now:clock(),metaLimit},dbPool);if(!value.duplicate)result.queued++;}
    catch(error){if(![400,403,404,409].includes(error.status))throw error;result.skipped++;}
  }
  const [messages]=await dbPool.query(`SELECT CAST(id AS CHAR) id FROM messages WHERE company_id=? AND provider=? AND message_mode='AUTOMATICO'
    AND attempts<3 AND (UPPER(status)='PENDING' OR (UPPER(status)='FAILED' AND next_attempt_at<=?))
    AND (scheduled_at IS NULL OR scheduled_at<=?) ORDER BY scheduled_at,id`,[scope.companyId,provider,clock(),clock()]);
  for(const message of messages){
    try {
      const args = { scope: systemScope, messageId: message.id, now: clock(), metaLimit, clock };
      const value = provider === 'MOCK' ? await mockSendWhatsApp(args,dbPool) : await sendAutomaticMeta(args,dbPool);
      if(!value.duplicate && ['SENT', 'DELIVERED', 'READ'].includes(value.message.status))result.sent++;
      if(value.cancelled)result.cancelled++;
    }
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
    FROM invoices WHERE company_id=? AND customer_id=? AND deleted_at IS NULL AND LOWER(status) NOT IN ('cancelled','inactive','void','paid')
    ORDER BY due_date,id FOR UPDATE`, [scope.companyId, customerId]);
  const [templates] = await db.query("SELECT CAST(id AS CHAR) id,name,stage,status,channel,content FROM message_templates WHERE company_id=? AND channel='whatsapp'", [scope.companyId]);
  const [messages] = await db.query(`SELECT ${messageColumns} FROM messages m JOIN customers c ON c.id=m.customer_id AND c.company_id=m.company_id
    LEFT JOIN message_templates t ON t.id=m.template_id AND t.company_id=m.company_id WHERE m.company_id=? AND m.customer_id=? ORDER BY m.id DESC`, [scope.companyId, customerId]);
  const rules = await loadCompanyCollectionRules(scope.companyId, db);
  const real = runtimeProvider(settings) === 'WHATSAPP_CLOUD_API';
  return { customer, invoices, templates, messages: real ? messages.filter(row => row.provider !== 'MOCK') : messages, rules, settings,
    referenceDate: day, realTemplateName: real ? MERTEL_INVOICE_TEMPLATE : null, contactAuthorized: !real || hasWhatsAppConsent(settings, customer) };
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
async function realAutomaticSlot(db, scope, input, notice, now, { message = null, metaLimit = null } = {}) {
  const { settings, customer } = input;
  const configuredLimit = settings.automatic_daily_limit ?? settings.global_daily_limit;
  if (!configuredLimit) throw operationError(409, 'Configura el cupo diario antes de programar avisos.');
  const dailyLimit = Math.min(configuredLimit, metaLimit ?? Infinity);
  const recipient = normalizePhone(customer.phone);
  const today = bogotaDate(now);
  let cursor = new Date(Math.max(now.getTime(), message?.scheduled_at ? new Date(message.scheduled_at).getTime() : 0));
  for (;;) {
    const slot = automaticWindow(notice, input.rules, cursor, input.messages, true);
    if (!slot) return null;
    const date = bogotaDate(slot);
    const { start, end } = automaticHours(notice, date, true);
    const midnight = new Date(`${date}T00:00:00-05:00`);
    const tomorrow = new Date(midnight.getTime() + 86_400_000);
    // During reservation, count future work. During today's dispatch, count only claims already made.
    const reserve = !message || date !== today;
    const [[usage]] = await db.query(`SELECT COUNT(CASE WHEN message_mode='AUTOMATICO' THEN 1 END) AS total,
      COALESCE(SUM(recipient=?),0) AS recipient_count, COALESCE(SUM(stage=?),0) AS stage_count,
      MAX(CASE WHEN message_mode='AUTOMATICO' THEN
        CASE WHEN last_attempt_at>=? AND last_attempt_at<? THEN last_attempt_at ELSE scheduled_at END END) AS last_slot
      FROM messages WHERE company_id=? AND provider='WHATSAPP_CLOUD_API' AND direction='outbound' AND template_id IS NOT NULL
      AND (? IS NULL OR id<>?) AND UPPER(status)<>'CANCELLED'
      AND ((last_attempt_at>=? AND last_attempt_at<?) OR
        (? AND budget_date=? AND (UPPER(status)='PENDING' OR (UPPER(status)='FAILED' AND next_attempt_at IS NOT NULL))))`,
    [recipient, notice.stage, midnight, tomorrow, scope.companyId, message?.id ?? null, message?.id ?? null, midnight, tomorrow, reserve, date]);
    if (Number(usage.total) >= dailyLimit || Number(usage.recipient_count) >= 1 || Number(usage.stage_count) >= notice.rule.daily_limit) {
      cursor = tomorrow;
      continue;
    }
    // The worker ticks each minute, so align the spacing to complete minutes.
    const spacing = Math.max(1, Math.floor((end - start) / (dailyLimit * 60_000))) * 60_000;
    const planned = new Date(Math.max(slot.getTime(), usage.last_slot ? new Date(usage.last_slot).getTime() + spacing : 0));
    if (planned >= end) {
      cursor = tomorrow;
      continue;
    }
    if (message && metaLimit !== null && date === today) {
      const [[rolling]] = await db.query(`SELECT COUNT(*) AS recipients, MIN(last_contact) AS earliest FROM (
        SELECT recipient, MAX(COALESCE(sent_at,last_attempt_at)) AS last_contact FROM messages
        WHERE company_id=? AND provider='WHATSAPP_CLOUD_API' AND direction='outbound' AND template_id IS NOT NULL
        AND recipient<>? AND COALESCE(sent_at,last_attempt_at)>? AND COALESCE(sent_at,last_attempt_at)<=?
        AND (sent_at IS NOT NULL OR UPPER(status)='PROCESSING' OR (UPPER(status)='FAILED' AND next_attempt_at IS NULL))
        GROUP BY recipient) AS recent`, [scope.companyId, recipient, new Date(planned.getTime() - 86_400_000), planned]);
      if (Number(rolling.recipients) >= metaLimit) {
        cursor = new Date(new Date(rolling.earliest).getTime() + 86_400_000);
        continue;
      }
    }
    return planned;
  }
}
async function enqueueAutomatic(db, scope, settings, customerId, now, metaLimit) {
  const provider = requireAutomationProvider(settings);
  if (!settings.automations_enabled) throw operationError(409, 'Automatizaciones desactivadas.');
  const input = await automaticInput(db, scope, settings, customerId, bogotaDate(now));
  if (settings.excluded_customers?.[customerId]) throw operationError(409, 'Cliente excluido de mensajes automáticos.');
  if (!validMobile(input.customer.phone)) throw operationError(409, 'Cliente sin celular válido; no consume cupo.');
  if (!input.contactAuthorized) throw operationError(409, 'El cliente no tiene autorización registrada para avisos por WhatsApp.');
  const notice = automaticSelection(input);
  if (!notice) throw operationError(409, 'No hay un aviso automático vigente pendiente de envío.');
  if (notice.message) return { message: notice.message, duplicate: true };
  const key = createHash('sha256').update(JSON.stringify([String(scope.companyId), customerId, provider === 'MOCK' ? 'AVISO_MERTEL' : 'AVISO_MERTEL_META', notice.stage, notice.date])).digest('hex');
  const [[duplicate]] = await db.query('SELECT CAST(id AS CHAR) id FROM messages WHERE company_id=? AND idempotency_key=?', [scope.companyId, key]);
  if (duplicate) return { message: await messageById(db, scope, duplicate.id), duplicate: true };
  const scheduled = provider === 'MOCK' ? automaticWindow(notice, input.rules, now, input.messages)
    : await realAutomaticSlot(db, scope, input, notice, now, { metaLimit });
  const context = { notice_date: notice.date, expires_on: notice.expires_on, invoice_ids: notice.invoice_ids, reason: notice.description,
    cancellation_reason: scheduled ? null : 'No hay horario o cupo disponible dentro del plazo máximo del aviso.' };
  const content = provider === 'MOCK' ? renderAutomatic(notice, input.referenceDate) : realAutomaticMessage(notice, input.referenceDate, settings).content;
  if (scheduled && provider === 'MOCK') {
    await oneAutomaticPerDay(db, scope, customerId, bogotaDate(scheduled));
    await enforceLimits(db, scope, settings, notice.rule, customerId, bogotaDate(scheduled));
  }
  const [inserted] = await db.query(`INSERT INTO messages(company_id,customer_id,invoice_id,template_id,channel,recipient,content,status,provider,stage,direction,message_mode,idempotency_key,scheduled_at,budget_date,automation_context)
    VALUES (?,?,?,?,'whatsapp',?,?,?,? ,?,'outbound','AUTOMATICO',?,?,?,?)`,
    [scope.companyId, customerId, notice.invoice.id ?? notice.invoice.invoice_id, notice.template.id, normalizePhone(input.customer.phone), content,
      scheduled ? 'PENDING' : 'CANCELLED', provider, notice.stage, key, scheduled, scheduled ? bogotaDate(scheduled) : null, JSON.stringify(context)]);
  await audit(db, scope, null, scheduled ? 'queued' : 'cancelled', 'whatsapp_message', inserted.insertId, { ...context, actor_type: 'SYSTEM' });
  return { message: await messageById(db, scope, inserted.insertId), duplicate: false };
}
async function dispatchAutomatic(db, scope, settings, message, now, fail, metaLimit) {
  const simulated = message.provider === 'MOCK';
  if (message.sent_at || ['SENT', 'DELIVERED', 'READ'].includes(message.status)) return { message, duplicate: true, simulated };
  if (!['PENDING', 'FAILED'].includes(message.status)) throw operationError(409, 'El mensaje automático no puede enviarse.');
  const context = noticeContext(message), day = bogotaDate(now);
  const input = await automaticInput(db, scope, settings, message.customer_id, day);
  const cancel = async reason => {
    await db.query("UPDATE messages SET status='CANCELLED',next_attempt_at=NULL,automation_context=? WHERE id=? AND company_id=?", [JSON.stringify({ ...context, cancellation_reason: reason }), message.id, scope.companyId]);
    await audit(db, scope, null, 'cancelled', 'whatsapp_message', message.id, { reason, actor_type: 'SYSTEM' });
    return { message: await messageById(db, scope, message.id), cancelled: true, simulated };
  };
  if (!context) return cancel('Aviso anterior sin identidad permanente; requiere revisión.');
  if (day > context.expires_on) return cancel('Aviso descartado: superó su ventana máxima de 3 días o el día calendario 10.');
  if (!settings.automations_enabled || settings.excluded_customers?.[message.customer_id]) return cancel('Automatización desactivada o cliente excluido.');
  if (!validMobile(input.customer.phone)) return cancel('Cliente sin celular válido; no consume cupo.');
  if (!input.contactAuthorized) return cancel('El número ya no tiene autorización para avisos por WhatsApp.');
  if (!simulated && await hasSharedWhatsAppNumber(db, scope, input.customer)) return cancel('El teléfono está asociado a más de un cliente.');
  const notice = automaticNotices(input).find(row => row.stage === message.stage && row.date === context.notice_date);
  if (!notice?.applicable) return cancel(notice?.reason || 'La cartera aplicable ya fue pagada o el aviso dejó de aplicar.');
  const winner = automaticSelection(input);
  if (winner && MERTEL_CONTACTS.findIndex(row => row.stage === winner.stage) > MERTEL_CONTACTS.findIndex(row => row.stage === notice.stage)) return cancel('Se priorizó un aviso de mayor urgencia.');
  if (message.attempts >= RETRY_POLICY.max_attempts) return cancel('Se agotaron los intentos del aviso.');
  if (message.next_attempt_at && new Date(message.next_attempt_at) > now) return { message, simulated };
  const scheduled = simulated ? automaticWindow(notice, input.rules, now, input.messages)
    : await realAutomaticSlot(db, scope, input, notice, now, { message, metaLimit });
  if (!scheduled) return cancel('No hay horario o cupo disponible dentro del plazo máximo.');
  const prepared = simulated ? null : realAutomaticMessage(notice, day, settings);
  const content = prepared?.content ?? renderAutomatic(notice, day), recipient = normalizePhone(input.customer.phone);
  if (simulated) {
    await oneAutomaticPerDay(db, scope, message.customer_id, bogotaDate(scheduled), message.id);
    await enforceLimits(db, scope, settings, notice.rule, message.customer_id, bogotaDate(scheduled), message.id);
  }
  if (scheduled > now) {
    await db.query('UPDATE messages SET scheduled_at=?,budget_date=?,content=?,recipient=? WHERE id=? AND company_id=?', [scheduled, bogotaDate(scheduled), content, recipient, message.id, scope.companyId]);
    return { message: await messageById(db, scope, message.id), scheduled: true, simulated };
  }
  const attempts = Number(message.attempts) + 1;
  await db.query("UPDATE messages SET status='PROCESSING',content=?,recipient=?,attempts=?,last_attempt_at=?,budget_date=? WHERE id=? AND company_id=?", [content, recipient, attempts, now, day, message.id, scope.companyId]);
  if (prepared) {
    await audit(db, scope, null, 'meta_request', 'whatsapp_message', message.id, { notice_date: context.notice_date, attempts, test_mode: false });
    return { message: { ...message, recipient, content, attempts }, template: prepared.template, sendBefore: automaticHours(notice, day, true).end };
  }
  const result = await whatsappProvider(settings.provider).sendTemplateMessage({ content, recipient, fail });
  await db.query('UPDATE messages SET status=?,provider_message_id=?,sent_at=?,error_code=?,error_message=?,next_attempt_at=? WHERE id=? AND company_id=?',
    [result.status, result.provider_message_id ?? null, result.status === 'SENT' ? now : null, result.error_code ?? null, result.error_message ?? null,
      result.status === 'FAILED' ? retryAt(attempts, now) : null, message.id, scope.companyId]);
  await audit(db, scope, null, result.status.toLowerCase(), 'whatsapp_message', message.id, { notice_date: context.notice_date, actor_type: 'SYSTEM', simulated: true });
  return { message: await messageById(db, scope, message.id), simulated: true };
}

function realAutomaticMessage(notice, day, settings) {
  return buildMertelInvoiceMessage(notice.current.evaluated.customer, notice.matched, { referenceDate: day, contactPhone: requireCollectionContactPhone(settings) });
}

async function sendAutomaticMeta({ scope, messageId, now, metaLimit, clock }, dbPool) {
  const claimed = await transaction(scope, async (db, settings) => {
    if (requireAutomationProvider(settings) !== 'WHATSAPP_CLOUD_API') throw operationError(409, 'El canal real de WhatsApp no está activo.');
    const message = await messageById(db, scope, messageId, true);
    if (message.provider !== 'WHATSAPP_CLOUD_API' || message.direction !== 'outbound' || message.message_mode !== 'AUTOMATICO' ||
        (message.status === 'FAILED' && !message.next_attempt_at)) throw operationError(409, 'El aviso no está pendiente de envío real.');
    return dispatchAutomatic(db, scope, settings, message, now, false, metaLimit);
  }, dbPool);
  if (!claimed.template) return claimed;
  return deliverMetaText({ scope, message: claimed.message, now, testMode: false, template: claimed.template, sendBefore: claimed.sendBefore, clock }, dbPool);
}

export async function getCustomerWhatsAppSequence({ scope, customerId, filters = {}, now = new Date() }, dbPool = pool) {
  customerId = operationId(customerId, 'customer_id');
  const day = filters.reference_date || bogotaDate(now);
  try { dateDay(day); } catch { throw operationError(400, 'Fecha de referencia inválida.'); }
  return transaction(scope, async (db, settings) => {
    const input = await automaticInput(db, scope, settings, customerId, day);
    const result = buildWhatsAppSequence(input, input.realTemplateName ? (notice, date) => realAutomaticMessage(notice, date, settings).content : undefined);
    return input.realTemplateName ? { ...result, real_provider: true, contact_authorized: input.contactAuthorized } : result;
  }, dbPool);
}
export async function setWhatsAppCustomerConsent({ scope, actorId, customerId, body }, dbPool = pool) {
  customerId = operationId(customerId, 'customer_id');
  if (!body || Object.keys(body).some(key => !['authorized', 'source'].includes(key)) || typeof body.authorized !== 'boolean' ||
      (body.authorized && (typeof body.source !== 'string' || !body.source.trim() || body.source.length > 200))) {
    throw operationError(400, 'Indica si el cliente autorizó el contacto y dónde quedó registrado su consentimiento.');
  }
  return transaction(scope, async (db, settings) => {
    if (runtimeProvider(settings) !== 'WHATSAPP_CLOUD_API') throw operationError(409, 'Configura WhatsApp Cloud API antes de registrar autorizaciones.');
    const [[customer]] = await db.query("SELECT CAST(id AS CHAR) id,phone FROM customers WHERE company_id=? AND id=? AND status='active' AND deleted_at IS NULL FOR UPDATE", [scope.companyId, customerId]);
    if (!customer) throw operationError(404, 'Cliente no encontrado.');
    let recipient = settings.authorized_recipients[customerId]?.recipient ?? null;
    if (body.authorized) {
      if (!validMobile(customer.phone) || await hasSharedWhatsAppNumber(db, scope, customer)) throw operationError(409, 'Registra un celular válido asociado únicamente a este cliente.');
      recipient = normalizePhone(customer.phone);
      settings.authorized_recipients[customerId] = { recipient, source: body.source.trim(), recorded_at: new Date().toISOString() };
    } else delete settings.authorized_recipients[customerId];
    await saveSettings(db, scope, actorId, settings, 'customer_contact_permission');
    await audit(db, scope, actorId, body.authorized ? 'whatsapp_opt_in' : 'whatsapp_opt_out', 'customer', customerId,
      { recipient, ...(body.authorized ? { source: body.source.trim() } : {}) });
    return { contact_authorized: body.authorized };
  }, dbPool);
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
