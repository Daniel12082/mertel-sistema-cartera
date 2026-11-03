import { evaluateCollectionCase, compareCollectionCustomers } from '../../../backend/src/services/collectionEngine.service.js';
import { collectionStageCatalog } from '../../../backend/src/services/collectionPolicy.js';
import { calculatePortfolioState } from '../../../backend/src/services/portfolio.calculation.js';
import { moneyCents } from '../../../backend/src/services/collectionMoney.js';
import { browserDay } from './dataset';

export const money = cents => `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
export const sumMoney = (rows, field = 'balance') => money(rows.reduce((total, row) => total + moneyCents(row[field] ?? '0.00'), 0n));
export const openInvoices = data => data.invoices.filter(row => !row.deleted_at && moneyCents(row.balance) > 0n && data.customers.some(customer => customer.id === row.customer_id && !customer.deleted_at && customer.status === 'active'));
export function invoiceView(data, invoice) {
  const customer = data.customers.find(row => row.id === invoice.customer_id);
  return { ...invoice, customer_name: customer?.name, customer_nit: customer?.nit };
}
export function paymentView(data, payment) {
  const customer = data.customers.find(row => row.id === payment.customer_id);
  const total = sumMoney(data.allocations.filter(row => row.payment_id === payment.id && !row.deleted_at), 'amount');
  return { ...payment, customer_name: customer?.name, customer_nit: customer?.nit, total_allocated: total, available_amount: money(moneyCents(payment.amount) - moneyCents(total)) };
}
export function collectionView(data, referenceDate = browserDay()) {
  const catalog = collectionStageCatalog(data.configuration), source = openInvoices(data);
  const customers = [], pendingCustomers = [], nonOverdue = [];
  const stages = Object.fromEntries(catalog.map(stage => [stage.key, { customers: 0, invoices: 0, eligible_balance: '0.00' }]));
  const view = item => ({ invoice: invoiceView(data, item.invoice), stage: item.stage, stage_label: catalog.find(stage => stage.key === item.stage)?.label || 'No elegible',
    priority: item.priority, eligible: item.eligible, reason: item.reason, stage_candidates: item.stageCandidates, prompt_payment: item.promptPayment, conditional_discount: item.conditionalDiscount, benefits: item.benefits });
  for (const customer of data.customers.filter(row => !row.deleted_at && row.status === 'active')) {
    const invoices = source.filter(row => row.customer_id === customer.id);
    if (!invoices.length) continue;
    const evaluated = evaluateCollectionCase({ customer, invoices, referenceDate, rules: data.configuration });
    const eligible = evaluated.classifiedInvoices.filter(item => item.eligible);
    const primary = evaluated.primaryInvoice;
    const primaryRow = primary ? eligible.find(row => String(row.invoiceId) === String(primary.invoice_id ?? primary.id)) : null;
    if (primary && !primaryRow) throw new Error('No se pudo identificar el documento principal de demostración.');
    const item = { customer, stage: evaluated.stage, stage_label: catalog.find(stage => stage.key === evaluated.stage)?.label || 'Facturas no vencidas', priority: evaluated.priority, reason: evaluated.reason,
      main_invoice: primaryRow ? view(primaryRow) : null,
      invoices: evaluated.classifiedInvoices.map(view), total_balance: sumMoney(invoices), eligible_balance: sumMoney(eligible.map(row => row.invoice)) };
    const pending = item.invoices.filter(row => !row.eligible && row.invoice.due_date > referenceDate);
    nonOverdue.push(...pending.map(row => ({ ...row, customer, operational_group: 'non_overdue_pending' })));
    if (!eligible.length) { if (pending.length) pendingCustomers.push(item); continue; }
    customers.push(item);
    stages[item.stage].customers++; stages[item.stage].invoices += eligible.length;
    stages[item.stage].eligible_balance = money(moneyCents(stages[item.stage].eligible_balance) + moneyCents(item.eligible_balance));
  }
  customers.sort((left, right) => compareCollectionCustomers(left, right, referenceDate));
  return { reference_date: referenceDate, status: 'ready', rules_configured: true, stage_catalog: catalog, priority_basis: 'stage_order_ordinal', configuration_warnings: [],
    summary: { total_customers: customers.length, total_balance: sumMoney(source), eligible_balance: sumMoney(customers, 'eligible_balance'), stages }, customers,
    non_overdue_pending: { label: 'Facturas no vencidas', total_invoices: nonOverdue.length, total_customers: new Set(nonOverdue.map(row => row.customer.id)).size, total_balance: sumMoney(nonOverdue.map(row => row.invoice)), invoices: nonOverdue, customers: pendingCustomers } };
}
export function portfolioView(data, params = {}) {
  const referenceDate = params.reference_date || browserDay();
  return openInvoices(data).map(row => ({ ...invoiceView(data, row), ...calculatePortfolioState({ dueDate: row.due_date, balance: row.balance, referenceDate }) }))
    .filter(row => (!params.customer_id || row.customer_id === String(params.customer_id)) && (!params.status || row.portfolio_status === params.status) &&
      (!params.overdue || params.overdue !== 'true' || row.portfolio_status === 'overdue') && (!params.due_from || row.due_date >= params.due_from) && (!params.due_to || row.due_date <= params.due_to));
}
export function portfolioTotals(rows, referenceDate) {
  return { total_document_value: sumMoney(rows, 'document_value'), total_balance: sumMoney(rows), total_overdue_balance: sumMoney(rows.filter(row => row.due_date < referenceDate)),
    total_current_balance: sumMoney(rows.filter(row => row.due_date >= referenceDate)), total_no_due_date_balance: sumMoney(rows.filter(row => !row.due_date)) };
}
export function resolutionView(data, params = {}) {
  const counts = Object.fromEntries(['SEARCHING', 'FOUND', 'NEW', 'AMBIGUOUS', 'INVALID', 'PERSISTENT', 'RESOLVED'].map(status => [status, data.resolution.filter(row => row.status === status).length]));
  const pending = counts.SEARCHING + counts.NEW + counts.AMBIGUOUS + counts.INVALID;
  return { counts, pending, ready_for_pipeline: pending === 0, batch_id: 'DEMO', batches: pending ? [{ id: 'DEMO', file_name: 'Cartera-ficticia-DEMO.xlsx' }] : [],
    rows: data.resolution.filter(row => (!params.status || params.status === 'ALL' || row.status === params.status) && (!params.search || JSON.stringify(row.source_data).toLowerCase().includes(params.search.toLowerCase()))) };
}
export function dashboardView(data, params = {}) {
  const referenceDate = params.reference_date || browserDay(), collection = collectionView(data, referenceDate), source = openInvoices(data);
  const ok = value => ({ status: 'ok', data: value });
  const stages = collection.stage_catalog.map(stage => ({ ...stage, customers: collection.summary.stages[stage.key]?.customers || 0,
    documents: collection.customers.filter(row => row.stage === stage.key).reduce((count, row) => count + row.invoices.length, 0), balance: sumMoney(collection.customers.filter(row => row.stage === stage.key), 'total_balance') }));
  const ranks = collection.customers.map(row => ({ id: row.customer.id, name: row.customer.name, nit: row.customer.nit, balance: row.total_balance, invoices_count: row.invoices.length, stage: row.stage_label, priority: row.priority,
    invoice: row.main_invoice?.invoice.invoice_number, due_date: row.main_invoice?.invoice.due_date }));
  const recovery = { payments_count: data.payments.length, payments_amount: sumMoney(data.payments, 'amount'), allocations_amount: sumMoney(data.allocations.filter(row => !row.deleted_at), 'amount'), allocations_count: data.allocations.filter(row => !row.deleted_at).length,
    settled_invoices: data.invoices.filter(row => moneyCents(row.balance) === 0n).length, confirmed_reports: data.reports.filter(row => row.status === 'CONFIRMED').length };
  const promises = { pending_count: data.promises.filter(row => row.status === 'pending').length, pending_amount: sumMoney(data.promises.filter(row => row.status === 'pending'), 'promised_amount'),
    active: data.promises.filter(row => row.status === 'pending' && row.promised_date >= referenceDate).length, overdue: data.promises.filter(row => row.status === 'pending' && row.promised_date < referenceDate).length,
    upcoming: data.promises.filter(row => row.status === 'pending' && row.promised_date >= referenceDate).length, fulfilled_period: data.promises.filter(row => row.status === 'fulfilled').length };
  const activity = { actions_count: data.actions.length, managed_customers: new Set(data.actions.map(row => row.customer_id)).size, contacts: data.actions.filter(row => row.action_type === 'CONTACTED').length,
    no_response: data.actions.filter(row => row.action_type === 'NO_RESPONSE').length, partial_payments: data.actions.filter(row => row.action_type === 'PARTIAL_PAYMENT').length, full_payments: data.actions.filter(row => row.action_type === 'PAID').length };
  const trend = new Map();
  for (const [rows, field] of [[data.actions, 'gestions'], [data.payments, 'payments'], [data.promises, 'promises']]) for (const row of rows) { const day = String(row.created_at).slice(0, 10); if (!trend.has(day)) trend.set(day, { day, gestions: 0, payments: 0, promises: 0 }); trend.get(day)[field]++; }
  return { updated_at: new Date().toISOString(), period: { reference_date: referenceDate, from: params.from || referenceDate.slice(0, 8) + '01', to: params.to || referenceDate, label: 'Demostración' },
    overview: ok({ total_customers: data.customers.filter(row => !row.deleted_at).length, customers_with_balance: new Set(source.map(row => row.customer_id)).size, pending_invoices: source.length, overdue_invoices: source.filter(row => row.due_date < referenceDate).length,
      invoiced_value: sumMoney(data.invoices, 'document_value'), sent_messages: data.messages.filter(row => ['SENT', 'DELIVERED', 'READ'].includes(row.status)).length }),
    summary: ok({ total_balance: sumMoney(source), customers_in_collection: collection.customers.length, unclassified_balance: collection.non_overdue_pending.total_balance, stages, warnings: [data.source ? 'Cartera temporal del archivo; ningún cambio se aplica a MySQL.' : 'Datos de demostración; ningún beneficio ni operación se aplica a MERTEL.'] }),
    collection: ok(activity), recovery: ok(recovery), reported_payments: ok({ count: data.reports.filter(row => row.status === 'PENDING_REVIEW').length, amount: sumMoney(data.reports.filter(row => row.status === 'PENDING_REVIEW'), 'reported_amount') }),
    promises: ok(promises), resolution: ok(resolutionView(data)), whatsapp: ok({ ...data.whatsapp, pending: data.messages.filter(row => row.status === 'PENDING').length, failed_current: 0, failed: 0, sent: data.messages.filter(row => row.status === 'SENT').length,
      delivered: data.messages.filter(row => row.status === 'DELIVERED').length, read_count: data.messages.filter(row => row.status === 'READ').length }),
    top_customers: ok([...ranks].sort((a, b) => Number(b.balance) - Number(a.balance))), priority_customers: ok(ranks), recent_activity: ok([...data.events].reverse().map(row => ({ ...row, actor: 'Equipo DEMO', customer_name: data.customers.find(customer => customer.id === row.customer_id)?.name }))),
    activity_trend: ok([...trend.values()].sort((a, b) => a.day.localeCompare(b.day))) };
}
