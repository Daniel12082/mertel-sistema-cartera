import { before, beforeEach, afterEach, after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { applyWhatsAppMigration } from '../src/services/whatsappMigration.service.js';
import * as service from '../src/services/whatsappCenter.service.js';
import { MERTEL_CONTACTS } from '../src/services/whatsappSequence.js';
import { startWhatsAppAutomationRunner } from '../src/services/whatsappAutomationRunner.js';
dotenv.config({ path: new URL('../.env', import.meta.url), quiet: true });

describe('MERTEL automation authority on an isolated MySQL schema', { skip: !(process.env.DB_HOST && process.env.DB_USER) }, () => {
  const schema = `mertel_auto_test_${randomUUID().replaceAll('-', '')}`, scope = { companyId: '1', actorId: null };
  let db, pool, originalFinances;
  const now = new Date('2026-10-08T15:00:00Z');
  const ruleData = MERTEL_CONTACTS.map((step, index) => ({ stage: step.stage, mode: 'AUTOMATICO', enabled: true, template_id: String(index + 1), weekdays: [1,2,3,4,5,6], start_time: '08:00', end_time: '18:00', daily_limit: 100, interval_hours: 1 }));
  const defaults = { provider: 'MOCK', connection_status: 'CONNECTED', automations_enabled: true, global_daily_limit: 100, customer_daily_limit: 10, rules: ruleData, excluded_customers: {} };
  before(async () => {
    db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD, multipleStatements: true });
    await db.query(`CREATE DATABASE \`${schema}\``); await db.query(`USE \`${schema}\``);
    const sql = await readFile(new URL('../../database/migrations/001_initial_schema.sql', import.meta.url), 'utf8');
    const names = new Set(['companies','users','roles','customers','invoices','payments','payment_allocations','collection_actions','payment_promises','message_templates','messages','settings','audit_logs']);
    for (const match of sql.matchAll(/CREATE TABLE (\w+) \([\s\S]*?;/g)) if (names.has(match[1])) await db.query(match[0]);
    await applyWhatsAppMigration(db); assert.equal((await applyWhatsAppMigration(db)).applied, false);
    await db.query("INSERT INTO companies(id,name) VALUES (1,'MERTEL IMPORTACIONES')");
    await db.query("INSERT INTO customers(id,company_id,nit,name,phone) VALUES (1,1,'DEMO-AUTO','Cliente automatización DEMO','3001234567')");
    for (const [index, step] of MERTEL_CONTACTS.entries()) await db.query("INSERT INTO message_templates(id,company_id,name,channel,stage,content,status) VALUES (?,1,?,'whatsapp',?,'Hola {{cliente_nombre}}.','active')", [index + 1, step.template_name, step.stage]);
    const rules = await readFile(new URL('../config/mertel-collection-rules.json', import.meta.url), 'utf8');
    await db.query("INSERT INTO settings(company_id,setting_key,setting_value,value_type) VALUES (1,'collection_rules',?,'json'),(1,'whatsapp_center',?,'json')", [rules, JSON.stringify(defaults)]);
    pool = mysql.createPool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: schema, connectionLimit: 6 });
  });
  after(async () => { if (pool) await pool.end(); if (db) { assert.match(schema, /^mertel_auto_test_[a-f0-9]{32}$/); assert.notEqual(schema, process.env.DB_NAME); await db.query(`DROP DATABASE IF EXISTS \`${schema}\``); await db.end(); } });
  async function financial() {
    const result = {};
    for (const table of ['invoices','payments','payment_allocations']) result[table] = (await db.query(`SELECT * FROM ${table} ORDER BY id`))[0];
    return result;
  }
  async function freeze() { originalFinances = await financial(); }
  async function invoices(rows) {
    await db.query('DELETE FROM invoices');
    for (const [index, row] of rows.entries()) await db.query(`INSERT INTO invoices(id,company_id,customer_id,invoice_number,issue_date,due_date,document_value,base_value,iva_value,balance,promo_18,notes)
      VALUES (?,1,1,?,?,?,?,?,190,?,?,?)`, [index + 1, `AUTO-DEMO-${index + 1}`, row.issue || '2026-09-01', row.due || '2026-10-13', row.value || '1190.00', row.base || '1000.00', row.balance ?? '1190.00', row.promo || '0.00', row.notes || '']);
    await freeze();
  }
  beforeEach(async () => {
    await db.query('DELETE FROM messages'); await db.query('DELETE FROM audit_logs');
    await db.query("UPDATE customers SET phone='3001234567' WHERE id=1");
    await db.query("UPDATE settings SET setting_value=? WHERE setting_key='whatsapp_center'", [JSON.stringify(defaults)]);
    await invoices([{}]);
  });
  afterEach(async () => assert.deepEqual(await financial(), originalFinances, 'Automating messages must not modify financial tables'));
  const enqueue = (day = now) => service.enqueueWhatsApp({ scope, body: { customer_id: '1', mode: 'AUTOMATICO' }, now: day }, pool);
  const dispatch = (id, day = now, extra = {}) => service.mockSendWhatsApp({ scope, messageId: id, now: day, ...extra }, pool);

  test('concurrent queue and dispatch calls produce one effective operation, permanent idempotency and one daily slot', async () => {
    const queued = await Promise.all([enqueue(), enqueue(), enqueue()]);
    assert.equal(new Set(queued.map(row => row.message.id)).size, 1); assert.equal(queued.filter(row => !row.duplicate).length, 1);
    const sent = await Promise.all([dispatch(queued[0].message.id), dispatch(queued[0].message.id)]);
    assert.equal(sent[0].message.status, 'SENT'); assert.equal(sent[1].duplicate, true);
    assert.equal((await db.query("SELECT COUNT(*) count FROM messages WHERE direction='outbound'"))[0][0].count, 1);
    await assert.rejects(enqueue(), /No hay un aviso/);
    await db.query("UPDATE message_templates SET content='Plantilla editada {{cliente_nombre}}.' WHERE id=2");
    await assert.rejects(enqueue(), /No hay un aviso/);
  });
  test('multiple invoices and stages only send MORA, even when the configured customer limit is ten', async () => {
    await invoices([{ due: '2026-10-07' }, { due: '2026-10-08' }, { due: '2026-10-13' }, { issue: '2026-09-29', due: '2026-11-03' }]);
    const message = (await enqueue()).message; assert.equal(message.stage, 'overdue');
    assert.equal((await dispatch(message.id)).message.status, 'SENT');
    await assert.rejects(enqueue(), /Máximo un mensaje automático/);
    assert.equal((await db.query("SELECT COUNT(*) count FROM messages WHERE status='SENT'"))[0][0].count, 1);
  });
  test('Sunday and holiday defer at most three days; dispatch rereads actual financial balances and wording', async () => {
    await invoices([{ due: '2026-10-16' }]);
    const sunday = new Date('2026-10-11T15:00:00Z'), tuesday = new Date('2026-10-13T15:00:00Z');
    const queued = (await enqueue(sunday)).message;
    assert.equal(new Date(queued.scheduled_at).toISOString(), '2026-10-13T13:00:00.000Z');
    assert.equal((await dispatch(queued.id, sunday)).scheduled, true);
    assert.equal((await dispatch(queued.id, new Date('2026-10-12T15:00:00Z'))).scheduled, true);
    await db.query('UPDATE invoices SET balance=900 WHERE id=1'); await freeze();
    const sent = (await dispatch(queued.id, tuesday)).message;
    assert.equal(sent.status, 'SENT'); assert.match(sent.content, /valor \$1\.190 · saldo pendiente \$900/);
    assert.match(sent.content, /vence el 2026-10-16/); assert.equal(sent.attempts, 1);
  });
  test('past expiry is cancelled, does not dispatch and never regenerates', async () => {
    await invoices([{ due: '2026-10-16' }]); const queued = (await enqueue(new Date('2026-10-11T15:00:00Z'))).message;
    const expired = await dispatch(queued.id, new Date('2026-10-15T15:00:00Z'));
    assert.equal(expired.message.status, 'CANCELLED'); assert.equal(expired.message.attempts, 0);
    assert.match(JSON.stringify(expired.message.automation_context), /ventana máxima/);
    await assert.rejects(enqueue(new Date('2026-10-15T15:00:00Z')), /No hay un aviso/);
  });
  for (const keyword of ['BAJA','STOP','CANCELAR']) test(`${keyword} received via provider excludes the client before automatic queueing`, async () => {
    await service.mockIncomingWhatsApp({ scope, body: { phone: '+573001234567', content: ` ${keyword.toLowerCase()} `, provider_message_id: `mock:optout-${keyword.toLowerCase()}`, received_at: now.toISOString() } }, pool);
    await assert.rejects(enqueue(), /excluido/);
    assert.equal((await db.query("SELECT COUNT(*) count FROM messages WHERE direction='outbound'"))[0][0].count, 0);
  });
  test('manual exclusion and no valid phone never consume daily budget; pending exclusion is rechecked at dispatch', async () => {
    const queued = (await enqueue()).message;
    await service.excludeWhatsAppCustomer({ scope, customerId: '1', body: { excluded: true } }, pool);
    assert.equal((await dispatch(queued.id)).message.status, 'CANCELLED');
    await service.excludeWhatsAppCustomer({ scope, customerId: '1', body: { excluded: false } }, pool);
    await db.query("UPDATE customers SET phone='6011234567' WHERE id=1");
    await assert.rejects(enqueue(), /celular válido/);
    assert.equal((await db.query("SELECT COUNT(*) count FROM messages WHERE status<>'CANCELLED' AND direction='outbound'"))[0][0].count, 0);
  });
  test('complete payment suppresses notices and cancels queued messages without changing the ledger', async () => {
    const queued = (await enqueue()).message; await db.query('UPDATE invoices SET balance=0'); await freeze();
    assert.equal((await dispatch(queued.id)).message.status, 'CANCELLED'); await assert.rejects(enqueue(), /No hay un aviso/);
  });
  test('pronto pago base, PROMO exclusion and conditioned benefit are constructed authoritatively', async () => {
    await invoices([{ issue: '2026-09-29', due: '2026-11-03', notes: 'DSCTO = CONDICIONADO' }, { issue: '2026-09-29', due: '2026-11-03', promo: '18.00' }]);
    const queued = (await enqueue()).message; assert.equal(queued.stage, 'prompt_payment');
    assert.match(queued.content, /Total cartera \$2\.380/); assert.match(queued.content, /3% de descuento sobre esa base \$30/); assert.match(queued.content, /\$2\.350/); assert.match(queued.content, /sin descuento/); assert.match(queued.content, /solamente si paga a tiempo/);
    assert.equal((await dispatch(queued.id)).message.status, 'SENT');
  });
  test('all PROMO, missing base and excessive discount fail before reserving budget', async () => {
    await invoices([{ issue: '2026-09-29', due: '2026-11-03', promo: '18.00' }]); await assert.rejects(enqueue(), /No hay un aviso/);
    await invoices([{ issue: '2026-09-29', due: '2026-11-03', balance: '20.00' }]); await assert.rejects(enqueue(), /supera el valor/);
    assert.equal((await db.query('SELECT COUNT(*) count FROM messages'))[0][0].count, 0);
  });
  test('runner processes enabled context and timeline records actual sent dates and reasons', async () => {
    const runner = startWhatsAppAutomationRunner({ dbPool: pool, clock: () => now, report: (...args) => assert.fail(JSON.stringify(args)) });
    try { await runner.tick(); } finally { runner.stop(); }
    const sequence = await service.getCustomerWhatsAppSequence({ scope, customerId: '1', filters: { reference_date: '2026-10-08' } }, pool);
    assert.equal(sequence.steps[1].message.status, 'SENT'); assert.equal(sequence.last_contact.message.stage, 'five_days_before_due');
    assert.equal((await db.query("SELECT COUNT(*) count FROM audit_logs WHERE action='sent'"))[0][0].count, 1);
  });
});
