import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { loadAuthConfig } from '../src/config/auth.js';
import { applyAuthMigrations } from '../src/services/authMigrations.service.js';
import { applyWhatsAppMigration } from '../src/services/whatsappMigration.service.js';
dotenv.config({ path: new URL('../.env', import.meta.url), quiet: true });

describe('WhatsApp center HTTP / MySQL, no real sends', { skip: !(process.env.DB_HOST && process.env.DB_USER) }, () => {
  const schema = `mertel_wa_test_${randomUUID().replaceAll('-', '')}`; const originalDatabase = process.env.DB_NAME;
  const keyBefore = process.env.WHATSAPP_ENCRYPTION_KEY;
  const config = loadAuthConfig({ JWT_SECRET: randomBytes(48).toString('base64url'), FRONTEND_URL: 'http://localhost:5173', AUTH_COOKIE_SAME_SITE: 'lax', NODE_ENV: 'test', AUTH_RATE_LIMIT_MAX: '1000' });
  let db, pool, server, root, companyId, customerId, customer2, admin, collector, templateId, services, financialBefore;
  before(async () => {
    db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD, multipleStatements: true });
    await db.query(`CREATE DATABASE \`${schema}\``); await db.query(`USE \`${schema}\``);
    const initial = await readFile(new URL('../../database/migrations/001_initial_schema.sql', import.meta.url), 'utf8');
    const tables = new Set(['companies', 'roles', 'users', 'user_roles', 'customers', 'invoices', 'payments', 'payment_allocations', 'collection_actions', 'payment_promises', 'message_templates', 'messages', 'settings', 'audit_logs', 'import_batches']);
    for (const match of initial.matchAll(/CREATE TABLE (\w+) \([\s\S]*?;/g)) if (tables.has(match[1])) await db.query(match[0]);
    await applyAuthMigrations(db); assert.equal((await applyWhatsAppMigration(db)).applied, true); assert.equal((await applyWhatsAppMigration(db)).applied, false);
    const [company] = await db.query("INSERT INTO companies(name) VALUES ('MERTEL IMPORTACIONES')"); companyId = String(company.insertId);
    const rules = await readFile(new URL('../config/mertel-collection-rules.json', import.meta.url), 'utf8');
    await db.query("INSERT INTO settings(company_id,setting_key,setting_value,value_type) VALUES (?,'collection_rules',?,'json'),(?,'daily_message_limit','250','number')", [companyId, rules, companyId]);
    for (let n = 1; n <= 2; n++) {
      const [customer] = await db.query("INSERT INTO customers(company_id,nit,name,phone) VALUES (?,?,?,?)", [companyId, `WA-${n}`, `Cliente DEMO ${n}`, `300000000${n}`]);
      if (n === 1) customerId = String(customer.insertId); else customer2 = String(customer.insertId);
      await db.query("INSERT INTO invoices(company_id,customer_id,invoice_number,issue_date,due_date,document_value,base_value,iva_value,balance) VALUES (?,?,?,'2020-01-01','2020-02-01',119,100,19,119)", [companyId, customer.insertId, `WA-INV-${n}`]);
    }
    await db.query("INSERT INTO roles(name) VALUES ('admin'),('collector')");
    process.env.DB_NAME = schema; process.env.WHATSAPP_ENCRYPTION_KEY = 'ab'.repeat(32);
    ({ default: pool } = await import('../src/config/database.js')); services = await import('../src/services/whatsappCenter.service.js');
    const { issueAccessToken } = await import('../src/services/auth.service.js');
    async function actor(role) {
      const [user] = await db.query("INSERT INTO users(company_id,first_name,email,password_hash) VALUES (?,'DEMO',?,'unusable-fixture')", [companyId, `${randomUUID()}@example.test`]);
      await db.query('INSERT INTO user_roles(user_id,role_id) SELECT ?,id FROM roles WHERE name=?', [user.insertId, role]);
      return { id: String(user.insertId), token: issueAccessToken(String(user.insertId), config) };
    }
    admin = await actor('admin'); collector = await actor('collector');
    const { createApp } = await import('../src/app.js'); server = await new Promise(resolve => { const listener = createApp(config).listen(0, '127.0.0.1', () => resolve(listener)); });
    root = `http://127.0.0.1:${server.address().port}/api`; financialBefore = await financialSnapshot();
  });
  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve)); if (pool) await pool.end();
    if (db) { assert.match(schema, /^mertel_wa_test_[a-f0-9]{32}$/); assert.notEqual(schema, originalDatabase); await db.query(`DROP DATABASE IF EXISTS \`${schema}\``); await db.end(); }
    if (originalDatabase === undefined) delete process.env.DB_NAME; else process.env.DB_NAME = originalDatabase;
    if (keyBefore === undefined) delete process.env.WHATSAPP_ENCRYPTION_KEY; else process.env.WHATSAPP_ENCRYPTION_KEY = keyBefore;
  });
  async function financialSnapshot() {
    const result = {};
    for (const table of ['invoices', 'payments', 'payment_allocations']) result[table] = (await db.query(`SELECT * FROM ${table} ORDER BY id`))[0];
    return result;
  }
  async function request(method, path, body, actor = admin) {
    const response = await fetch(root + path, { method, headers: { 'Content-Type': 'application/json', ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }
  const scope = () => ({ companyId, companyName: 'MERTEL IMPORTACIONES', actorId: admin.id });
  const settingsPath = '/admin/whatsapp/settings';
  const fullRule = extra => ({ stage: 'overdue', enabled: true, template_id: templateId, start_time: '00:00', end_time: '23:59', weekdays: [1,2,3,4,5,6,7], daily_limit: 100, interval_hours: 1, mode: 'MANUAL', ...extra });
  test('permission boundaries and default disconnected state, existing daily limit reused', async () => {
    assert.equal((await request('GET', '/admin/whatsapp', undefined, null)).status, 401);
    assert.equal((await request('GET', '/admin/whatsapp', undefined, collector)).status, 403);
    const response = await request('GET', '/admin/whatsapp'); assert.equal(response.status, 200);
    assert.equal(response.body.data.settings.connection_status, 'NOT_CONFIGURED'); assert.equal(response.body.data.settings.global_daily_limit, 250);
    assert.equal((await request('PATCH', settingsPath, { provider: 'MOCK' }, collector)).status, 403);
    assert.equal((await request('POST', `/whatsapp/customers/${customerId}/queue`, { mode: 'AUTOMATICO', template_id: '1' }, collector)).status, 403);
    assert.equal((await request('GET', '/admin/whatsapp?company_id=999')).status, 403);
  });
  test('configuration, connection failure/success, secrets redaction and no direct status forgery', async () => {
    assert.equal((await request('PATCH', settingsPath, { connection_status: 'CONNECTED' })).status, 400);
    assert.equal((await request('PATCH', settingsPath, { provider: 'MOCK', global_daily_limit: 100, customer_daily_limit: 10 })).body.data.connection_status, 'CONFIGURED');
    assert.equal((await request('POST', '/admin/whatsapp/test', { fail: true })).body.data.connection_status, 'ERROR');
    assert.equal((await request('POST', '/admin/whatsapp/test', {})).body.data.connection_status, 'CONNECTED');
    const result = await request('PATCH', settingsPath, { credentials: { access_token: 'secret-access', webhook_verification_token: 'secret-webhook' } });
    assert.equal(result.status, 200); assert.equal(result.body.data.credentials_configured, true); assert.equal(JSON.stringify(result).includes('secret-access'), false);
    const [stored] = await db.query("SELECT setting_value FROM settings WHERE setting_key='whatsapp_center'"); assert.equal(JSON.stringify(stored).includes('secret-access'), false);
    const [audits] = await db.query('SELECT new_values FROM audit_logs'); assert.equal(JSON.stringify(audits).includes('secret-access'), false);
    await request('POST', '/admin/whatsapp/test', {});
  });
  test('existing template API creates, edits, activates, audits and validates new variables', async () => {
    const body = { name: 'DEMO / BORRADOR WhatsApp', description: 'Solo pruebas técnicas', channel: 'whatsapp', stage: 'overdue', status: 'inactive', content: '{{cliente_nombre}} {{nit}} {{saldo}} {{empresa}}' };
    const created = await request('POST', '/collection/message-templates', body); assert.equal(created.status, 201); templateId = created.body.data.id;
    const edited = await request('PUT', `/collection/message-templates/${templateId}`, { ...body, status: undefined, content: '{{cliente_nombre}} {{numero_factura}} {{saldo}} {{empresa}}' }); assert.equal(edited.status, 200);
    assert.equal((await request('POST', `/collection/message-templates/${templateId}/activate`, {})).status, 200);
    assert.equal((await request('POST', '/collection/message-templates', { ...body, content: '{{cliente_nombree}}' })).status, 400);
    const preview = await request('POST', '/admin/whatsapp/preview', { customer_id: customerId, template_id: templateId }); assert.equal(preview.status, 200);
    assert.equal(preview.body.data.stage, 'overdue'); assert.equal(preview.body.data.can_prepare, true); assert.match(preview.body.data.content, /Cliente DEMO 1/);
  });
  test('valid rules, PENDING queue and concurrent backend idempotency', async () => {
    assert.equal((await request('PUT', '/admin/whatsapp/automations/overdue', fullRule({ weekdays: [] }))).status, 400);
    assert.equal((await request('PUT', '/admin/whatsapp/automations/overdue', fullRule())).status, 200);
    const requests = await Promise.all(Array.from({ length: 4 }, () => request('POST', `/whatsapp/customers/${customerId}/queue`, { template_id: templateId }, collector)));
    for (const result of requests) assert.equal(result.status, 200, JSON.stringify(result));
    assert.equal(new Set(requests.map(result => result.body.data.message.id)).size, 1);
    assert.equal(requests.filter(result => !result.body.data.duplicate).length, 1); assert.equal(requests[0].body.data.message.status, 'PENDING');
  });
  test('MOCK SENT is distinct from delivery/read, transitions monotonic and history integrated', async () => {
    const queued = await request('GET', `/admin/whatsapp/messages?customer_id=${customerId}`); const id = queued.body.data.messages[0].id;
    const now = new Date('2026-10-07T15:00:00Z'); await db.query('UPDATE messages SET scheduled_at=? WHERE id=?', [new Date('2026-10-07T14:00:00Z'), id]);
    const sent = await services.mockSendWhatsApp({ scope: scope(), actorId: admin.id, messageId: id, now });
    assert.equal(sent.message.status, 'SENT'); assert.equal(sent.message.delivered_at, null); assert.equal(sent.message.read_at, null); assert.match(sent.message.provider_message_id, /^mock:/);
    assert.equal((await request('POST', `/admin/whatsapp/messages/${id}/mock-delivery`, { status: 'DELIVERED' })).body.data.status, 'DELIVERED');
    assert.equal((await request('POST', `/admin/whatsapp/messages/${id}/mock-delivery`, { status: 'READ' })).body.data.status, 'READ');
    assert.equal((await request('POST', `/admin/whatsapp/messages/${id}/mock-delivery`, { status: 'DELIVERED' })).status, 409);
    const history = await request('GET', `/collection/customers/${customerId}/history?type=message`, undefined, collector);
    assert.equal(history.status, 200); assert.ok(history.body.data.events.some(event => event.title === 'Mensaje leído'));
  });
  test('FAILED captures error, retries are finite and respect backoff', async () => {
    const now = new Date('2026-10-07T15:00:00Z');
    const queued = await services.enqueueWhatsApp({ scope: scope(), actorId: admin.id, body: { customer_id: customer2, template_id: templateId, mode: 'MANUAL' }, now });
    const id = queued.message.id;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const current = new Date(now.getTime() + (attempt - 1) * 16 * 60000);
      const result = await services.mockSendWhatsApp({ scope: scope(), actorId: admin.id, messageId: id, fail: true, now: current });
      assert.equal(result.message.status, 'FAILED'); assert.equal(result.message.attempts, attempt); assert.equal(result.message.error_code, 'MOCK_SEND_FAILED');
      if (attempt === 1) await assert.rejects(services.mockSendWhatsApp({ scope: scope(), messageId: id, now: current }), /todavía/);
      if (attempt === 3) assert.equal(result.message.next_attempt_at, null);
    }
    await assert.rejects(services.mockSendWhatsApp({ scope: scope(), messageId: id, now: new Date('2026-10-07T16:00:00Z') }), /Máximo/);
  });
  test('manual limits, scheduling and activation safety', async () => {
    await request('PUT', '/admin/whatsapp/automations/overdue', fullRule({ mode: 'MANUAL', start_time: '08:00', end_time: '17:00', weekdays: [1,2,3,4,5] }));
    assert.equal((await request('PATCH', settingsPath, { automations_enabled: true })).status, 409);
    await db.query("UPDATE messages SET created_at='2026-01-01',budget_date='2030-10-10'");
    await request('PATCH', settingsPath, { customer_daily_limit: 1 });
    const attempt = () => services.enqueueWhatsApp({ scope: scope(), actorId: admin.id, body: { customer_id: customerId, template_id: templateId, mode: 'MANUAL' }, now: new Date('2030-10-10T17:00:00Z') });
    await assert.rejects(attempt(), /Límite/);
    await request('PATCH', settingsPath, { customer_daily_limit: 10 });
    await request('PATCH', settingsPath, { global_daily_limit: 1 }); await assert.rejects(attempt(), /Límite/);
    await request('PATCH', settingsPath, { global_daily_limit: 100 });
    await request('PUT', '/admin/whatsapp/automations/overdue', fullRule({ mode: 'MANUAL', daily_limit: 1 })); await assert.rejects(attempt(), /Límite/);
    await request('PUT', '/admin/whatsapp/automations/overdue', fullRule({ mode: 'MANUAL', start_time: '08:00', end_time: '17:00', weekdays: [1,2,3,4,5] }));
    const scheduled = await services.enqueueWhatsApp({ scope: scope(), actorId: admin.id, body: { customer_id: customerId, template_id: templateId, mode: 'MANUAL' }, now: new Date('2030-10-11T23:00:00Z') });
    assert.equal(scheduled.message.status, 'PENDING'); assert.ok(new Date(scheduled.message.scheduled_at) > new Date('2030-10-11T23:00:00Z'));
    const deferred = await services.mockSendWhatsApp({ scope: scope(), messageId: scheduled.message.id, now: new Date('2030-10-11T23:00:00Z') }); assert.equal(deferred.scheduled, true);
    await request('POST', '/admin/whatsapp/disconnect', {});
    assert.equal((await request('PATCH', settingsPath, { automations_enabled: true })).status, 409);
    assert.equal((await request('POST', '/admin/whatsapp/test', {})).status, 200);
  });
  test('incoming normalized and idempotent, filters, audit and finance are unchanged', async () => {
    const incoming = { phone: '+57 300 000 0001', content: 'Respuesta técnica DEMO', received_at: '2026-10-07T15:00:00Z', provider_message_id: 'mock:incoming-fixture' };
    const result = await request('POST', '/admin/whatsapp/mock-incoming', incoming); assert.equal(result.status, 200); assert.equal(result.body.data.message.direction, 'inbound');
    assert.equal((await request('POST', '/admin/whatsapp/mock-incoming', incoming)).body.data.duplicate, true);
    assert.equal((await request('POST', '/admin/whatsapp/mock-incoming', incoming, collector)).status, 403);
    const filtered = await request('GET', `/admin/whatsapp/messages?customer_id=${customer2}&status=FAILED`); assert.equal(filtered.body.data.messages.length, 1);
    const audit = await request('GET', '/admin/whatsapp/audit'); assert.ok(audit.body.data.some(event => event.action === 'incoming')); assert.ok(audit.body.data.some(event => event.entity_type === 'message_template'));
    assert.deepEqual(await financialSnapshot(), financialBefore);
    assert.equal((await request('POST', '/webhook/whatsapp', incoming, null)).status, 404);
  });
  test('Meta allows three manual test messages per Bogota day and deduplicates concurrent requests', async () => {
    const env = {
      WHATSAPP_PROVIDER: 'meta', WHATSAPP_TEST_MODE: 'true', WHATSAPP_TEST_ALLOWED_RECIPIENTS: '+573173697659',
      WHATSAPP_PHONE_NUMBER_ID: '12345678', WHATSAPP_BUSINESS_ACCOUNT_ID: '12345678',
      WHATSAPP_APP_ID: '12345678', WHATSAPP_BUSINESS_ID: '12345678', WHATSAPP_ACCESS_TOKEN: 'fixture',
      WHATSAPP_API_VERSION: 'v27.0', WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'fixture', WHATSAPP_APP_SECRET: 'fixture',
    };
    const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
    Object.assign(process.env, env);
    const realFetch = globalThis.fetch;
    try {
      await db.query("UPDATE settings SET setting_value=JSON_SET(setting_value,'$.provider','WHATSAPP_CLOUD_API') WHERE company_id=? AND setting_key='whatsapp_center'", [companyId]);
      const path = '/admin/whatsapp/meta/test-messages';
      const queue = content => request('POST', path, { recipient: env.WHATSAPP_TEST_ALLOWED_RECIPIENTS, content, confirmed: true });
      const first = await queue('Primera prueba');
      assert.equal(first.status, 200);
      const copies = await Promise.all([queue('Primera prueba'), queue('Segunda prueba'), queue('Tercera prueba'), queue('Cuarta prueba')]);
      assert.equal(copies[0].body.data.message.id, first.body.data.message.id);
      assert.equal(copies[0].body.data.duplicate, true);
      assert.deepEqual(copies.slice(1).map(result => result.status).sort(), [200, 200, 429]);

      const replyPath = '/admin/whatsapp/meta/replies';
      const recipient = '+573000000001';
      const reply = { recipient, content: 'Respuesta a un cliente' };
      assert.equal((await request('POST', replyPath, reply)).status, 409);
      process.env.WHATSAPP_TEST_MODE = 'false';
      assert.equal((await queue('Prueba desactivada')).status, 409);
      assert.equal((await request('POST', replyPath, reply, collector)).status, 403);
      assert.equal((await request('POST', replyPath, reply)).status, 409);

      const receivedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
      await services.receiveMetaWebhook({ events: [{ kind: 'message', phone: recipient, provider_message_id: 'wamid.incoming-reply', content: 'Hola', timestamp: receivedAt }] });
      let providerCalls = 0;
      globalThis.fetch = (url, options) => {
        if (!String(url).startsWith('https://graph.facebook.com/')) return realFetch(url, options);
        providerCalls += 1;
        const payload = JSON.parse(options.body);
        assert.equal(payload.to, recipient.slice(1));
        assert.equal(payload.text.body, reply.content);
        return Promise.resolve(new Response(JSON.stringify({ messages: [{ id: `wamid.real-reply-fixture-${providerCalls}` }] })));
      };
      const results = await Promise.all([request('POST', replyPath, reply), request('POST', replyPath, reply)]);
      assert.ok(results.every(result => result.status === 200), JSON.stringify(results));
      assert.equal(providerCalls, 1);
      const accepted = results.find(result => result.body.data.accepted).body.data.message;
      assert.equal(accepted.customer_id, customerId);
      assert.equal(accepted.status, 'SENT');
      await services.receiveMetaWebhook({ events: [{ kind: 'status', provider_message_id: accepted.provider_message_id, status: 'DELIVERED', timestamp: new Date() }] });
      assert.equal((await request('GET', `/admin/whatsapp/messages?customer_id=${customerId}`)).body.data.messages.find(row => row.id === accepted.id).status, 'DELIVERED');

      await db.query("UPDATE customers SET phone='3000000001' WHERE id=?", [customer2]);
      const receive = id => services.receiveMetaWebhook({ events: [{ kind: 'message', phone: recipient, provider_message_id: id, content: 'Hola', timestamp: receivedAt }] });
      await receive('wamid.shared-before');
      const assocPath = '/admin/whatsapp/meta/conversations/association';
      const association = { recipient, customer_id: customer2 };
      assert.equal((await request('PUT', assocPath, association, collector)).status, 403);
      const linked = await request('PUT', assocPath, association);
      assert.equal(linked.status, 200);
      assert.equal(linked.body.data.messages_linked, 1);
      assert.equal((await request('PUT', assocPath, association)).body.data.messages_linked, 0);
      assert.equal((await request('PUT', assocPath, { ...association, customer_id: customerId })).status, 409);
      await receive('wamid.shared-after');
      const [inbound] = await db.query("SELECT CAST(customer_id AS CHAR) AS customer_id FROM messages WHERE provider_message_id IN ('wamid.incoming-reply','wamid.shared-before','wamid.shared-after') ORDER BY id");
      assert.deepEqual(inbound.map(row => row.customer_id), [customerId, customer2, customer2]);
      assert.equal((await request('POST', replyPath, { ...reply, customer_id: customerId })).status, 409);
      const newReply = await request('POST', replyPath, { ...reply, customer_id: customer2 });
      assert.equal(newReply.body.data.message.customer_id, customer2);
      const [events] = await db.query("SELECT CAST(user_id AS CHAR) AS actor, JSON_UNQUOTE(JSON_EXTRACT(new_values,'$.customer_id')) AS customer FROM audit_logs WHERE action='conversation_associated'");
      assert.deepEqual(events, [{ actor: admin.id, customer: customer2 }]);
    } finally {
      globalThis.fetch = realFetch;
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
