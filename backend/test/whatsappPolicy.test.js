import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultWhatsAppSettings, publicWhatsAppSettings, encryptCredentials, decryptCredentials, validateRule, nextWindow,
  bogotaDate, idempotencyKey, retryAt, deliveryTransition, CONNECTION_STATES } from '../src/services/whatsappPolicy.js';
import { MetaWhatsAppProvider, MockWhatsAppProvider, normalizePhone, whatsappProvider } from '../src/services/whatsappProvider.service.js';
import { renderMessageTemplate } from '../src/utils/messageTemplate.js';

const rule = { stage: 'overdue', enabled: false, template_id: '1', start_time: '08:00', end_time: '17:00', weekdays: [1,2,3,4,5], daily_limit: 1, interval_hours: 24, mode: 'AUTOMATICO' };
test('default configuration is disconnected, without invented commercial limits', () => {
  const value = defaultWhatsAppSettings(); assert.equal(value.connection_status, 'NOT_CONFIGURED');
  assert.equal(value.automations_enabled, false); assert.equal(value.global_daily_limit, null); assert.equal(value.customer_daily_limit, null);
  assert.deepEqual(CONNECTION_STATES, ['NOT_CONFIGURED', 'CONFIGURED', 'CONNECTED', 'DISCONNECTED', 'ERROR']);
});
test('credentials require a server key, are encrypted and are absent from public settings', () => {
  assert.throws(() => encryptCredentials({ access_token: 'secret' }, ''), /WHATSAPP_ENCRYPTION_KEY/);
  const encrypted = encryptCredentials({ access_token: 'secret-access', webhook_verification_token: 'secret-hook' }, 'ab'.repeat(32));
  assert.equal(JSON.stringify(encrypted).includes('secret-access'), false);
  assert.equal(decryptCredentials(encrypted, 'ab'.repeat(32)).access_token, 'secret-access');
  assert.throws(() => decryptCredentials(encrypted, 'cd'.repeat(32)), /credencial segura/);
  const publicValue = publicWhatsAppSettings({ ...defaultWhatsAppSettings(), encrypted_credentials: encrypted });
  assert.equal(publicValue.credentials_configured, true); assert.equal(Object.hasOwn(publicValue, 'encrypted_credentials'), false);
});
test('variables reject unknown/missing data and preserve literal replacement', () => {
  const rendered = renderMessageTemplate('{{cliente_nombre}} {{nit}} {{vendedor}} {{empresa}} {{cliente_nombree}}', { cliente_nombre: '{{saldo}}', nit: '1', empresa: 'MERTEL' });
  assert.deepEqual(rendered.missing_variables, ['vendedor']); assert.deepEqual(rendered.unsupported_variables, ['cliente_nombree']);
  assert.ok(rendered.content.startsWith('{{saldo}}')); assert.equal(renderMessageTemplate('{{cliente_nombre', {}).malformed_variables, true);
});
test('rule validation requires existing stages, explicit limits, days and times', () => {
  assert.deepEqual(validateRule(rule, [{ key: 'overdue' }]), rule);
  for (const extra of [{ daily_limit: 0 }, { interval_hours: 0 }, { weekdays: [] }, { weekdays: [1,1] }, { start_time: '18:00' }, { template_id: null }, { mode: 'AUTO' }, { enabled: 1 }, { injected: true }]) {
    assert.throws(() => validateRule({ ...rule, ...extra }, [{ key: 'overdue' }]));
  }
});
test('hours use Bogota, end is exclusive, weekends schedule PENDING instead of errors', () => {
  assert.equal(bogotaDate(new Date('2026-10-08T01:00:00Z')), '2026-10-07');
  assert.equal(nextWindow(rule, new Date('2026-10-09T22:00:00Z')).toISOString(), '2026-10-12T13:00:00.000Z');
  assert.equal(nextWindow(rule, new Date('2026-10-07T12:00:00Z')).toISOString(), '2026-10-07T13:00:00.000Z');
  assert.equal(nextWindow(rule, new Date('2026-10-07T15:00:00Z')).toISOString(), '2026-10-07T15:00:00.000Z');
});
test('idempotency includes company, customer, engine stage, template, date and mode', () => {
  const context = { companyId: '1', customerId: '2', stage: 'overdue', templateId: '3', day: '2026-10-07', mode: 'MANUAL' };
  assert.equal(idempotencyKey(context), idempotencyKey({ ...context }));
  for (const [key, value] of Object.entries(context)) assert.notEqual(idempotencyKey(context), idempotencyKey({ ...context, [key]: value + 'x' }));
});
test('retries stop after three attempts and deliveries never regress', () => {
  assert.equal(retryAt(1, new Date('2026-10-07T13:00:00Z')).toISOString(), '2026-10-07T13:15:00.000Z');
  assert.equal(retryAt(3), null); assert.equal(deliveryTransition('SENT', 'DELIVERED'), true);
  assert.equal(deliveryTransition('SENT', 'READ'), true); assert.equal(deliveryTransition('READ', 'DELIVERED'), false);
  assert.equal(deliveryTransition('DELIVERED', 'FAILED'), false);
});
test('provider MOCK simulates connection, send, failure, incoming and delivery without fetch', async () => {
  const originalFetch = globalThis.fetch; globalThis.fetch = () => { throw new Error('External IO forbidden'); };
  try {
    const provider = new MockWhatsAppProvider();
    assert.equal((await provider.validateConnection()).status, 'CONNECTED'); assert.equal((await provider.validateConnection({ fail: true })).status, 'ERROR');
    assert.equal((await provider.sendMessage()).status, 'SENT'); assert.equal((await provider.sendTemplateMessage({ fail: true })).status, 'FAILED');
    assert.equal(provider.handleDeliveryStatus({ status: 'READ' }).status, 'READ');
    const dto = provider.handleIncomingWebhook({ phone: '300 000 0000', content: 'Respuesta DEMO', provider_message_id: 'mock:reply', received_at: '2026-10-07T13:00:00Z' });
    assert.equal(dto.phone, '+573000000000'); assert.equal(dto.direction, 'inbound'); assert.equal(dto.provider, 'MOCK');
    assert.throws(() => whatsappProvider('WHATSAPP_CLOUD_API'), /WHATSAPP_PROVIDER=meta/); assert.throws(() => normalizePhone('bad'));
    assert.throws(() => provider.handleIncomingWebhook({ ...dto, received_at: 'bad' }));
  } finally { globalThis.fetch = originalFetch; }
});
test('Meta provider uses server env, restricts the test recipient and normalizes signed webhook events', async () => {
  const env = { WHATSAPP_PROVIDER: 'meta', WHATSAPP_PHONE_NUMBER_ID: '1323761864160570', WHATSAPP_BUSINESS_ACCOUNT_ID: '947108348473688',
    WHATSAPP_APP_ID: '28358688863754131', WHATSAPP_BUSINESS_ID: '586633450175509', WHATSAPP_ACCESS_TOKEN: 'not-logged-token', WHATSAPP_API_VERSION: 'v99.0',
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'verify-secret', WHATSAPP_APP_SECRET: 'app-secret', WHATSAPP_TEST_MODE: 'true', WHATSAPP_TEST_ALLOWED_RECIPIENTS: '+573173697659' };
  const calls = [];
  const provider = new MetaWhatsAppProvider({ env, fetchImpl: async (url, init) => {
    calls.push({ url, init }); return new Response(JSON.stringify({ messaging_product: 'whatsapp', contacts: [{ wa_id: '573173697659' }], messages: [{ id: 'wamid.test-message' }] }), { status: 200 });
  } });
  const result = await provider.sendMessage({ recipient: '3173697659', manual: true, payload: { type: 'text', text: { body: 'Prueba' } } });
  assert.equal(result.status, 'SENT'); assert.match(calls[0].url, /\/v99\.0\/1323761864160570\/messages$/);
  assert.equal(JSON.parse(calls[0].init.body).to, '573173697659'); assert.equal(calls[0].init.headers.Authorization.includes(env.WHATSAPP_ACCESS_TOKEN), true);
  await assert.rejects(provider.sendMessage({ recipient: '+573001234567', manual: true, payload: { type: 'text', text: { body: 'No' } } }), /solo permite/);
  await assert.rejects(provider.sendMessage({ recipient: '+573173697659', manual: false, payload: { type: 'text', text: { body: 'No' } } }), /solo permite/);
  const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { messages: [{ from: '573173697659', id: 'wamid.inbound', type: 'text', text: { body: 'Hola' }, timestamp: '1760000000' }], statuses: [{ id: 'wamid.test-message', status: 'delivered', recipient_id: '573173697659', timestamp: '1760000001' }] } }] }] });
  const signature = `sha256=${(await import('node:crypto')).createHmac('sha256', env.WHATSAPP_APP_SECRET).update(payload).digest('hex')}`;
  assert.equal(provider.verifyWebhookSignature(Buffer.from(payload), signature), true); assert.equal(provider.verifyWebhookSignature(Buffer.from(payload), 'sha256=0'.padEnd(71, '0')), false);
  assert.equal(provider.verifyWebhookChallenge('subscribe', env.WHATSAPP_WEBHOOK_VERIFY_TOKEN, 'challenge'), 'challenge');
  const events = provider.handleIncomingWebhook(JSON.parse(payload)); assert.equal(events.length, 2); assert.equal(events[0].content, 'Hola'); assert.equal(events[1].status, 'DELIVERED');
  const authFailure = new MetaWhatsAppProvider({ env, fetchImpl: async () => new Response(JSON.stringify({ error: { code: 190 } }), { status: 401 }) });
  await assert.rejects(authFailure.validateConnection(), error => error.code === '190' && error.httpStatus === 401);
});
