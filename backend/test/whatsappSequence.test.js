import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MERTEL_CONTACTS, contactDates, automaticNotices, automaticSelection, automaticContent, renderAutomaticNotice, automaticWindow, buildWhatsAppSequence, validMobile, colombianHolidays } from '../src/services/whatsappSequence.js';
const rules = JSON.parse(await readFile(new URL('../config/mertel-collection-rules.json', import.meta.url)));
const invoice = (extra = {}) => ({ id: '1', invoice_id: '1', customer_id: '1', invoice_number: 'DEMO-1', issue_date: '2026-09-29', due_date: '2026-11-03', document_value: '1190.00', base_value: '1000.00', balance: '1190.00', promo_18: '0.00', notes: '', ...extra });
const input = (invoices = [invoice()], referenceDate = '2026-10-08') => ({ customer: { id: '1', name: 'Cliente DEMO', nit: 'DEMO', phone: '+573001234567' }, invoices, rules, referenceDate, messages: [],
  templates: MERTEL_CONTACTS.map((step, index) => ({ id: String(index + 1), name: step.template_name, stage: step.stage, channel: 'whatsapp', status: 'active', content: 'Hola {{cliente_nombre}}.' })),
  settings: { automations_enabled: true, excluded_customers: {}, rules: MERTEL_CONTACTS.map((step, index) => ({ stage: step.stage, template_id: String(index + 1), enabled: true, mode: 'AUTOMATICO', weekdays: [1,2,3,4,5,6], start_time: '08:00', end_time: '18:00', daily_limit: 100, interval_hours: 1 })) } });

test('real schedule starts Saturday at 8, closes at 15 and skips Sunday and holiday', () => {
  const notice = { expires_on: '2026-10-13', rule: { weekdays: [1, 2, 3, 4, 5, 6], start_time: '07:00', end_time: '17:00' } };
  assert.equal(automaticWindow(notice, rules, new Date('2026-10-10T12:00:00Z'), [], true).toISOString(), '2026-10-10T13:00:00.000Z');
  assert.equal(automaticWindow(notice, rules, new Date('2026-10-10T20:00:00Z'), [], true).toISOString(), '2026-10-13T12:00:00.000Z');
});

test('pronto pago is day business 7, before calendar 10; it lists documents and only reminds the condition', () => {
  const source = input([invoice(), invoice({ id: '2', invoice_id: '2', invoice_number: 'DEMO-2', issue_date: '2026-09-30' })]);
  const copy = structuredClone(source), notice = automaticSelection(source), body = automaticContent(notice, source.referenceDate);
  assert.equal(notice.stage, 'prompt_payment'); assert.equal(notice.date, '2026-10-08');
  assert.match(body.content, /Factura DEMO-1/); assert.match(body.content, /Factura DEMO-2/);
  assert.match(body.content, /3% por pronto pago puede aplicar hasta el 2026-10-09/); assert.doesNotMatch(body.content, /\$2\.380|\$60|Total a pagar/); assert.deepEqual(source, copy);
});
test('PROMO 18 SI remains listed and does not create a pronto pago reminder for that invoice', () => {
  const source = input([invoice(), invoice({ id: '2', invoice_id: '2', invoice_number: 'PROMO-DEMO', promo_18: 'SI' })]);
  const body = automaticContent(automaticSelection(source), source.referenceDate);
  assert.match(body.content, /Factura PROMO-DEMO/); assert.match(body.content, /3% por pronto pago puede aplicar/); assert.doesNotMatch(body.content, /\$2\.350|\$30/);
});
test('all PROMO 18 invoices never produce pronto pago or a fictional discount', () => {
  const source = input([invoice({ promo_18: 'SI' }), invoice({ id: '2', promo_18: '18.00' })]);
  assert.equal(automaticSelection(source), null); assert.match(automaticNotices(source).find(row => row.stage === 'prompt_payment').reason, /Toda la cartera/);
});
test('low balances never trigger a discount calculation in the notice', () => {
  const source = input([invoice({ balance: '20.00' })]);
  const body = automaticContent(automaticSelection(source), source.referenceDate);
  assert.match(body.content, /Factura DEMO-1/); assert.doesNotMatch(body.content, /\$20|Total a pagar/);
});
for (const [stage, due, issue] of [['prompt_payment', '2026-11-03', '2026-09-29'], ['five_days_before_due', '2026-10-13', '2026-09-01'], ['due_today', '2026-10-08', '2026-09-01']]) {
  test(`${stage}: conditioned benefit is a 10% reminder within its 60-day validity`, () => {
    const source = input([invoice({ due_date: due, issue_date: issue, notes: 'DSCTO = CONDICIONADO' })]);
    const notice = automaticSelection(source); assert.equal(notice.stage, stage);
    const content = renderAutomaticNotice(notice, source.referenceDate); assert.match(content, /10% condicionado puede aplicar hasta/); assert.doesNotMatch(content, /Total a pagar/);
  });
}
test('reminder with one invoice lists only the matching due date', () => {
  const source = input([invoice({ issue_date: '2026-09-01', due_date: '2026-10-13' }), invoice({ id: '2', invoice_id: '2', invoice_number: 'NOT-IN-REMINDER', issue_date: '2026-09-01', due_date: '2026-11-01' })]);
  const notice = automaticSelection(source); assert.equal(notice.stage, 'five_days_before_due');
  assert.match(renderAutomaticNotice(notice, source.referenceDate), /Factura DEMO-1 · emisión 2026-09-01 · vence 2026-10-13/); assert.doesNotMatch(renderAutomaticNotice(notice, source.referenceDate), /NOT-IN-REMINDER/);
});
test('reminder and due-today list every applicable invoice without monetary interpretation', () => {
  for (const due of ['2026-10-13', '2026-10-08']) {
    const source = input([invoice({ issue_date: '2026-09-01', due_date: due, balance: '900.00' }), invoice({ id: '2', invoice_id: '2', invoice_number: 'DEMO-2', issue_date: '2026-09-01', due_date: due })]);
    const body = renderAutomaticNotice(automaticSelection(source), source.referenceDate);
    assert.match(body, /Factura DEMO-1/); assert.match(body, /Factura DEMO-2/); assert.doesNotMatch(body, /\$1\.190|saldo pendiente|abono|ajuste|pago parcial|diferencia/);
  }
});
test('mora lists overdue invoices and keeps the conditioned reminder without amounts', () => {
  const source = input([invoice({ issue_date: '2026-09-01', due_date: '2026-10-07', notes: 'DSCTO: CONDICIONADO' })]);
  const notice = automaticSelection(source); assert.equal(notice.stage, 'overdue');
  const body = renderAutomaticNotice(notice, source.referenceDate);
  assert.match(body, /Factura DEMO-1 · emisión 2026-09-01 · vence 2026-10-07/); assert.match(body, /10% condicionado puede aplicar hasta el 2026-10-31/); assert.doesNotMatch(body, /Total en mora|\$1\.190/);
});
test('daily priority is mora > due today > reminder > prompt payment', () => {
  const all = [invoice({ id: '1', due_date: '2026-10-07', issue_date: '2026-09-01' }), invoice({ id: '2', due_date: '2026-10-08', issue_date: '2026-09-01' }), invoice({ id: '3', due_date: '2026-10-13', issue_date: '2026-09-01' }), invoice({ id: '4' })];
  assert.equal(automaticSelection(input(all)).stage, 'overdue'); assert.equal(automaticSelection(input(all.slice(1))).stage, 'due_today'); assert.equal(automaticSelection(input(all.slice(2))).stage, 'five_days_before_due');
});
test('sent notice does not repeat after delivery failure, template editing or reruns', () => {
  const source = input(); source.messages.push({ message_mode: 'AUTOMATICO', stage: 'prompt_payment', sent_at: '2026-10-08T15:00:00Z', status: 'FAILED', automation_context: { notice_date: '2026-10-08' } });
  assert.equal(automaticSelection(source), null); source.templates[0].content = 'Changed'; assert.equal(automaticSelection(source), null);
});
test('changing the due date cannot repeat an already sent stage for the same invoice', () => {
  const source = input([invoice({ issue_date: '2026-09-01', due_date: '2026-10-13' })]);
  source.messages.push({ message_mode: 'AUTOMATICO', stage: 'five_days_before_due', sent_at: '2026-10-07T15:00:00Z', status: 'SENT', automation_context: { notice_date: '2026-10-07', invoice_ids: ['1'] } });
  assert.equal(automaticSelection(source), null);
  const changed = buildWhatsAppSequence(source).steps.filter(row => row.stage === 'five_days_before_due');
  assert.equal(changed.find(row => row.date === '2026-10-07').status, 'SENT');
  assert.equal(changed.find(row => row.date === '2026-10-08').status, 'NO APLICA');
});
test('Sunday and Colombian public holiday postpone to a permitted date and regenerate text from actual date', () => {
  const source = input([invoice({ issue_date: '2026-09-01', due_date: '2026-10-16' })], '2026-10-11');
  const notice = automaticSelection(source); assert.ok(colombianHolidays(2026).has('2026-10-12'));
  assert.equal(automaticWindow(notice, rules, new Date('2026-10-11T15:00:00Z')).toISOString(), '2026-10-13T13:00:00.000Z');
  const deferred = input(source.invoices, '2026-10-13'); assert.match(renderAutomaticNotice(automaticSelection(deferred), deferred.referenceDate), /Factura DEMO-1 · emisión 2026-09-01 · vence 2026-10-16/);
});
test('notice beyond three days and pronto pago beyond calendar ten are not eligible', () => {
  assert.equal(automaticSelection(input([invoice({ issue_date: '2026-09-01', due_date: '2026-10-16' })], '2026-10-15')), null);
  assert.equal(contactDates(invoice({ issue_date: '2026-10-02' }), rules)[0].applicable, false);
  assert.equal(automaticSelection(input([invoice()], '2026-10-10')), null);
});
test('configured holiday source shifts business counting and is respected', () => {
  const custom = structuredClone(rules); custom.prompt_payment.window.calendar = { working_weekdays: [1,2,3,4,5], holidays: ['2026-10-07'] };
  assert.equal(contactDates(invoice(), custom)[0].date, '2026-10-09');
});
test('manual exclusion, invalid mobile and paid portfolio are blocked before selection', () => {
  const source = input(); source.settings.excluded_customers['1'] = { source: 'MANUAL' }; assert.equal(automaticSelection(source), null);
  delete source.settings.excluded_customers['1']; source.customer.phone = '6011234567'; assert.equal(automaticSelection(source), null);
  source.customer.phone = '+573001234567'; source.invoices[0].balance = '0.00'; assert.equal(automaticSelection(source), null);
  assert.equal(validMobile('300 123 4567'), true); assert.equal(validMobile('TEL-DEMO'), false);
});
test('partial payment uses persistent balance and timeline shows actual dates/content with all four stages', () => {
  const source = input([invoice({ issue_date: '2026-09-01', due_date: '2026-10-13', balance: '500.00' })]);
  const timeline = buildWhatsAppSequence(source); assert.equal(timeline.total_balance, '500.00'); assert.equal(timeline.steps.length, 4);
  assert.equal(timeline.steps[1].date, '2026-10-08'); assert.match(timeline.steps[1].content, /Factura DEMO-1 · emisión 2026-09-01 · vence 2026-10-13/); assert.doesNotMatch(timeline.steps[1].content, /\$500/);
});
