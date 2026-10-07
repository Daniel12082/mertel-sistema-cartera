import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { moneyCents } from './collectionMoney.js';
import { operationError, operationId } from './collectionOperations.validation.js';
import { dateDay } from './promptPayment.service.js';

export const RESULT_CATALOG = Object.freeze([
  ['CONTACTED', 'Contacté al cliente'], ['WHATSAPP', 'Envié WhatsApp'], ['PROMISE', 'Promesa de pago'],
  ['PAID', 'Cliente pagó'], ['PARTIAL_PAYMENT', 'Pago parcial'], ['PAYMENT_REPORTED', 'Reportar pago'],
  ['NO_RESPONSE', 'Cliente no responde'], ['INCONSISTENCY', 'Cliente reporta inconsistencia'],
  ['WRONG_NUMBER', 'Número incorrecto'], ['OTHER', 'Otra gestión'],
].map(([key, label]) => ({ key, label })));
export function fields(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) throw operationError(400, 'Campos de operación no válidos.');
}
export function resultText(value, label, max = 4000, required = false) {
  if (value == null && !required) return null;
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw operationError(400, `${label} no válido.`);
  return value.trim() || null;
}
export function resultDate(value) {
  try { if (typeof value !== 'string') throw new Error(); dateDay(value); if (Number(value.slice(0,4)) < 1000) throw new Error(); return value; }
  catch { throw operationError(400, 'Fecha de pago inválida.'); }
}
export const centsMoney = value => `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
export function positiveMoney(value) {
  try { const cents = moneyCents(value); if (cents <= 0n) throw new Error(); return centsMoney(cents); }
  catch { throw operationError(400, 'El monto debe ser positivo y tener máximo dos decimales.'); }
}
export function operationKey(value, scope, customerId, type = 'payment') {
  if (typeof value !== 'string' || !/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value)) throw operationError(400, 'La clave idempotente debe ser un UUID v4.');
  return createHash('sha256').update(JSON.stringify([String(scope.companyId), String(customerId), type, value.toLowerCase()])).digest('hex');
}
export const payloadHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function parseCollectionPayment(body) {
  fields(body, ['amount', 'payment_date', 'payment_method', 'reference', 'notes', 'allocations', 'payment_kind', 'idempotency_key', 'confirmation_token', 'reference_date']);
  if (!['TOTAL', 'PARTIAL', 'MULTIPLE'].includes(body.payment_kind)) throw operationError(400, 'Tipo de pago inválido.');
  if (!Array.isArray(body.allocations) || !body.allocations.length || body.allocations.length > 50) throw operationError(400, 'Selecciona entre una y 50 facturas.');
  const allocations = body.allocations.map(item => {
    fields(item, ['invoice_id', 'amount']); return { invoice_id: operationId(item.invoice_id, 'invoice_id'), amount: positiveMoney(item.amount) };
  }).sort((a,b) => BigInt(a.invoice_id) < BigInt(b.invoice_id) ? -1 : 1);
  if (new Set(allocations.map(item => item.invoice_id)).size !== allocations.length) throw operationError(400, 'No repitas facturas en las asignaciones.');
  if (body.payment_kind !== 'MULTIPLE' && allocations.length !== 1) throw operationError(400, 'Selecciona una factura para pago total o parcial.');
  const amount = positiveMoney(body.amount);
  if (allocations.reduce((sum, item) => sum + moneyCents(item.amount), 0n) > moneyCents(amount)) throw operationError(409, 'Las asignaciones superan el monto recibido.');
  return { amount, payment_date: resultDate(body.payment_date), payment_method: resultText(body.payment_method, 'Método', 50),
    reference: resultText(body.reference, 'Referencia', 150), notes: resultText(body.notes, 'Observación'), allocations, payment_kind: body.payment_kind };
}
export function signPaymentPreview(claims, secret = process.env.JWT_SECRET) {
  if (!secret) throw operationError(503, 'No hay clave de confirmación configurada en el servidor.');
  const encoded = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${encoded}.${createHmac('sha256', secret).update(encoded).digest('base64url')}`;
}
export function verifyPaymentPreview(token, { scope, customerId, hash, key }, secret = process.env.JWT_SECRET) {
  try {
    if (!secret || typeof token !== 'string' || token.length > 20000) throw new Error();
    const [encoded, signature, extra] = token.split('.'); if (extra || !encoded || !signature) throw new Error();
    const actual = Buffer.from(signature, 'base64url'); const expected = createHmac('sha256', secret).update(encoded).digest();
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error();
    const claims = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (claims.company_id !== String(scope.companyId) || claims.customer_id !== String(customerId) || claims.actor_id !== String(scope.actorId) || claims.hash !== hash || claims.key !== key || !Number.isSafeInteger(claims.expires_at) || claims.expires_at < Date.now()) throw new Error();
    return claims;
  } catch { throw operationError(409, 'La confirmación no es válida o expiró. Genera nuevamente el resumen.'); }
}
