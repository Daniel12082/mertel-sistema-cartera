import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MERTEL_CONTACTS, contactDates, automaticNotices, automaticSelection, automaticContent, renderAutomaticNotice, automaticWindow, buildWhatsAppSequence, validMobile, colombianHolidays } from '../src/services/whatsappSequence.js';
const rules = JSON.parse(await readFile(new URL('../config/mertel-collection-rules.json', import.meta.url)));
const invoice = (extra = {}) => ({ id: '1', invoice_id: '1', customer_id: '1', invoice_number: 'DEMO-1', issue_date: '2026-09-29', due_date: '2026-11-03', document_value: '1190.00', base_value: '1000.00', balance: '1190.00', promo_18: '0.00', notes: '', ...extra });
const input = (invoices = [invoice()], referenceDate = '2026-10-08') => ({ customer: { id: '1', name: 'Cliente DEMO', nit: 'DEMO', phone: '+573001234567' }, invoices, rules, referenceDate, messages: [],
  templates: MERTEL_CONTACTS.map((step, index) => ({ id: String(index + 1), name: step.template_name, stage: step.stage, channel: 'whatsapp', status: 'active', content: 'Hola {{cliente_nombre}}.' })),
  settings: { automations_enabled: true, excluded_customers: {}, rules: MERTEL_CONTACTS.map((step, index) => ({ stage: step.stage, template_id: String(index + 1), enabled: true, mode: 'AUTOMATICO', weekdays: [1,2,3,4,5,6], start_time: '08:00', end_time: '18:00', daily_limit: 100, interval_hours: 1 })) } });

test('pronto pago is day business 7, before calendar 10; uses complete portfolio and only base before VAT', () => {
  const source = input([invoice(), invoice({ id: '2', invoice_id: '2', invoice_number: 'DEMO-2', issue_date: '2026-09-30' })]);
  const copy = structuredClone(source), notice = automaticSelection(source), body = automaticContent(notice, source.referenceDate);
  assert.equal(notice.stage, 'prompt_payment'); assert.equal(notice.date, '2026-10-08');
  assert.equal(body.values.total_cartera, '$2.380'); assert.equal(body.values.base_antes_iva, '$2.000'); assert.equal(body.values.descuento_pronto_pago, '$60'); assert.equal(body.values.total_pronto_pago, '$2.320');
  assert.match(body.content, /DEMO-1/); assert.match(body.content, /DEMO-2/); assert.deepEqual(source, copy);
});
test('PROMO 18 SI stays in listing at full balance without contributing to discount', () => {
  const source = input([invoice(), invoice({ id: '2', invoice_id: '2', invoice_number: 'PROMO-DEMO', promo_18: 'SI' })]);
  const body = automaticContent(automaticSelection(source), source.referenceDate);
  assert.equal(body.values.descuento_pronto_pago, '$30'); assert.equal(body.values.total_pronto_pago, '$2.350'); assert.match(body.content, /PROMO-DEMO.*sin descuento/);
});
test('all PROMO 18 invoices never produce pronto pago or a fictional discount', () => {
  const source = input([invoice({ promo_18: 'SI' }), invoice({ id: '2', promo_18: '18.00' })]);
  assert.equal(automaticSelection(source), null); assert.match(automaticNotices(source).find(row => row.stage === 'prompt_payment').reason, /Toda la cartera/);
});
test('backend discount cannot exceed actual collectible value and never uses balance as its base', () => {
  const source = input([invoice({ balance: '20.00' })]);
  assert.throws(() => automaticContent(automaticSelection(source), source.referenceDate), /supera el valor/);
});
for (const [stage, due, issue] of [['prompt_payment', '2026-11-03', '2026-09-29'], ['five_days_before_due', '2026-10-13', '2026-09-01'], ['due_today', '2026-10-08', '2026-09-01']]) {
  test(`${stage}: conditioned benefit is explicit, conditional on timely payment and has no invented percentage`, () => {
    const source = input([invoice({ due_date: due, issue_date: issue, notes: 'DSCTO = CONDICIONADO' })]);
    const notice = automaticSelection(source); assert.equal(notice.stage, stage);
    const content = renderAutomaticNotice(notice, source.referenceDate); assert.match(content, /solamente si paga a tiempo/); assert.doesNotMatch(content, /10%/);
  });
}
test('reminder with one invoice lists only the matching due date', () => {
  const source = input([invoice({ issue_date: '2026-09-01', due_date: '2026-10-13' }), invoice({ id: '2', invoice_id: '2', invoice_number: 'NOT-IN-REMINDER', issue_date: '2026-09-01', due_date: '2026-11-01' })]);
  const notice = automaticSelection(source); assert.equal(notice.stage, 'five_days_before_due');
  assert.match(renderAutomaticNotice(notice, source.referenceDate), /Su factura vence el 2026-10-13/); assert.doesNotMatch(renderAutomaticNotice(notice, source.referenceDate), /NOT-IN-REMINDER/);
});
test('reminder and due-today dynamically count multiple invoices and show original value and balance without interpretation', () => {
  for (const due of ['2026-10-13', '2026-10-08']) {
    const source = input([invoice({ issue_date: '2026-09-01', due_date: due, balance: '900.00' }), invoice({ id: '2', invoice_id: '2', invoice_number: 'DEMO-2', issue_date: '2026-09-01', due_date: due })]);
    const body = renderAutomaticNotice(automaticSelection(source), source.referenceDate);
    assert.match(body, /Sus 2 facturas vencen/); assert.match(body, /valor \$1\.190 · saldo pendiente \$900/); assert.doesNotMatch(body, /abono|ajuste|pago parcial|diferencia/);
  }
});
test('mora lists overdue invoices, total, credit days, overdue days and loss of conditioned discount', () => {
  const source = input([invoice({ issue_date: '2026-09-01', due_date: '2026-10-07', notes: 'DSCTO: CONDICIONADO' })]);
  const notice = automaticSelection(source); assert.equal(notice.stage, 'overdue');
  const body = renderAutomaticNotice(notice, source.referenceDate);
  assert.match(body, /Total en mora \$1\.190/); assert.match(body, /Le pedimos ponerse al día para no afectar su cupo de crédito/); assert.match(body, /perdió el descuento condicionado · 36 días de crédito · 1 días vencida/); assert.doesNotMatch(body, /10%/);
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
  const deferred = input(source.invoices, '2026-10-13'); assert.match(renderAutomaticNotice(automaticSelection(deferred), deferred.referenceDate), /vence el 2026-10-16/);
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
  assert.equal(timeline.steps[1].date, '2026-10-08'); assert.match(timeline.steps[1].content, /saldo pendiente \$500/);
});
