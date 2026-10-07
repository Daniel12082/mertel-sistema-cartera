import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { operationError } from './collectionOperations.validation.js';

export const CONNECTION_STATES = ['NOT_CONFIGURED', 'CONFIGURED', 'CONNECTED', 'DISCONNECTED', 'ERROR'];
export const MESSAGE_STATES = ['PENDING', 'PROCESSING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'CANCELLED'];
export const RETRY_POLICY = Object.freeze({ max_attempts: 3, delay_minutes: 15 });
export const defaultWhatsAppSettings = () => ({ provider: null, number: '', phone_number_id: '', business_account_id: '',
  connection_status: 'NOT_CONFIGURED', automations_enabled: false, global_daily_limit: null,
  customer_daily_limit: null, rules: [], retry: { ...RETRY_POLICY } });
export function publicWhatsAppSettings(settings) {
  const { encrypted_credentials, ...safe } = settings;
  return { ...safe, credentials_configured: Boolean(encrypted_credentials), real_sending_enabled: false,
    notice: 'Solo MOCK. No se realizan envíos reales.' };
}
export function encryptCredentials(input, keyValue = process.env.WHATSAPP_ENCRYPTION_KEY) {
  if (!keyValue || !/^[a-f\d]{64}$/i.test(keyValue)) throw operationError(409, 'Configura WHATSAPP_ENCRYPTION_KEY en el servidor antes de guardar credenciales.');
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyValue, 'hex'), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(input), 'utf8'), cipher.final()]);
  return { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}
// Server-only, for the future adapter. No API returns decrypted credentials.
export function decryptCredentials(encrypted, keyValue = process.env.WHATSAPP_ENCRYPTION_KEY) {
  try {
    if (encrypted?.version !== 1 || !/^[a-f\d]{64}$/i.test(keyValue || '')) throw new Error('Invalid credential envelope');
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyValue, 'hex'), Buffer.from(encrypted.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted.data, 'base64')), decipher.final()]).toString('utf8'));
  } catch { throw operationError(409, 'No se pudo acceder a la credencial segura. Revisa la clave del servidor.'); }
}
export function positiveLimit(value, label, nullable = true) {
  if (nullable && value === null) return null;
  if (!Number.isSafeInteger(value) || value < 1 || value > 1000000) throw operationError(400, `${label} debe ser un entero positivo.`);
  return value;
}
export function validateRule(body, stages) {
  const fields = ['stage', 'enabled', 'template_id', 'start_time', 'end_time', 'weekdays', 'daily_limit', 'interval_hours', 'mode'];
  if (!body || Object.keys(body).some(key => !fields.includes(key)) || !stages.some(stage => stage.key === body.stage)) throw operationError(400, 'Etapa o campos de regla inválidos.');
  if (typeof body.enabled !== 'boolean' || !['MANUAL', 'AUTOMATICO'].includes(body.mode)) throw operationError(400, 'Estado o modo inválido.');
  const time = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  if (!time(body.start_time) || !time(body.end_time) || body.start_time >= body.end_time) throw operationError(400, 'Horario inválido: inicio debe ser anterior al fin.');
  if (!Array.isArray(body.weekdays) || !body.weekdays.length || new Set(body.weekdays).size !== body.weekdays.length || body.weekdays.some(day => !Number.isInteger(day) || day < 1 || day > 7)) throw operationError(400, 'Selecciona días válidos sin duplicados.');
  if (!/^[1-9]\d{0,19}$/.test(String(body.template_id))) throw operationError(400, 'Selecciona una plantilla.');
  positiveLimit(body.daily_limit, 'Límite por etapa', false);
  positiveLimit(body.interval_hours, 'Intervalo', false);
  if (body.interval_hours > 8760) throw operationError(400, 'Intervalo máximo: un año.');
  return { ...body, template_id: String(body.template_id) };
}
export function bogotaDate(now = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
export function nextWindow(rule, now = new Date()) {
  const day = bogotaDate(now);
  for (let offset = 0; offset < 8; offset++) {
    const date = new Date(`${day}T00:00:00-05:00`); date.setUTCDate(date.getUTCDate() + offset);
    const dateKey = bogotaDate(date); const weekday = date.getUTCDay() || 7;
    if (!rule.weekdays.includes(weekday)) continue;
    const start = new Date(`${dateKey}T${rule.start_time}:00-05:00`);
    const end = new Date(`${dateKey}T${rule.end_time}:00-05:00`);
    if (now < end) return new Date(Math.max(now.getTime(), start.getTime()));
  }
  throw operationError(400, 'No hay horario disponible.');
}
export function idempotencyKey({ companyId, customerId, stage, templateId, day, mode }) {
  return createHash('sha256').update(JSON.stringify([String(companyId), String(customerId), stage, String(templateId), day, mode])).digest('hex');
}
export function retryAt(attempts, now = new Date()) { return attempts < RETRY_POLICY.max_attempts ? new Date(now.getTime() + RETRY_POLICY.delay_minutes * 60000) : null; }
export function deliveryTransition(current, target) {
  if (current === target) return false;
  return ({ SENT: ['DELIVERED', 'READ', 'FAILED'], DELIVERED: ['READ'], READ: [] })[current]?.includes(target) === true;
}
