import { phoneKey, conversationOwner } from '../pages/Administracion/whatsappConversation.presentation';
import { automaticSelection, automaticNotices, automaticWindow, renderAutomaticNotice, buildWhatsAppSequence, validMobile, MERTEL_CONTACTS } from '../../../backend/src/services/whatsappSequence';
import { AxiosError } from 'axios';
import { simulationData, simulationSnapshot } from './store';
import { browserDay } from './dataset';
import { collectionView, dashboardView, invoiceView, money, openInvoices, paymentView, portfolioTotals, portfolioView, resolutionView, sumMoney } from './views';
import { renderMessageTemplate, messageTemplateVariableCatalog } from '../../../backend/src/utils/messageTemplate.js';
import { moneyCents } from '../../../backend/src/services/collectionMoney.js';
import { roleCatalog } from '../../../backend/src/config/permissions.js';
import { isApplicablePayment } from '../../../backend/src/utils/financialIntegrity.js';
import { requireMedia } from '../services/whatsappMedia.service';

const fail = (message, status = 409) => { throw Object.assign(new Error(message), { status }); };
const id = data => String(data.nextId++);
const now = () => new Date().toISOString();
const find = (rows, key) => rows.find(row => String(row.id) === String(key)) || fail('Registro de demostración no encontrado.', 404);
const resultCatalog = ['CONTACTED', 'WHATSAPP', 'PAID', 'PARTIAL_PAYMENT', 'PAYMENT_REPORTED', 'PROMISE', 'NO_RESPONSE', 'INCONSISTENCY', 'WRONG_NUMBER', 'OTHER']
  .map((key, index) => ({ key, label: ['Contactado', 'WhatsApp', 'Pago completo', 'Pago parcial', 'Pago reportado', 'Promesa de pago', 'Sin respuesta', 'Inconsistencia', 'Número incorrecto', 'Otro resultado'][index] }));
function event(data, type, customerId, description, metadata = {}) {
  const row = { id: id(data), type, action: type === 'financial' ? 'payment_registered' : 'result_registered', entity_type: type === 'promise' ? 'payment_promise' : 'collection_action',
    customer_id: customerId, customer_name: data.customers.find(customer => customer.id === customerId)?.name, title: 'Simulación · Evento de demostración', actor: 'Equipo DEMO', description: `Simulación: ${description || 'operación local'}`, occurred_at: now(), metadata };
  data.events.push(row); return row;
}
function history(data, params, customerId) {
  const matches = data.events.filter(row => (!customerId || row.customer_id === customerId) && (!params.type || params.type === 'all' || row.type === params.type) &&
    (!params.q || JSON.stringify(row).toLowerCase().includes(params.q.toLowerCase())) && (!params.date_from || row.occurred_at.slice(0, 10) >= params.date_from) && (!params.date_to || row.occurred_at.slice(0, 10) <= params.date_to));
  const page = Number(params.page || 1), limit = Number(params.limit || 20);
  return { events: [...matches].reverse().slice((page - 1) * limit, page * limit), pagination: { page, limit, total: matches.length, pages: Math.ceil(matches.length / limit), has_previous: page > 1, has_next: page * limit < matches.length } };
}
function context(data, customerId, referenceDate = browserDay()) {
  const customer = find(data.customers, customerId), collection = collectionView(data, referenceDate);
  return { customer, reference_date: referenceDate, total_balance: sumMoney(openInvoices(data).filter(row => row.customer_id === customerId)),
    collection_item: collection.customers.find(row => row.customer.id === customerId) || null, open_invoices: openInvoices(data).filter(row => row.customer_id === customerId),
    result_catalog: resultCatalog, reports: reportsView(data).filter(row => row.customer_id === customerId), notice: data.source ? 'Simulación: cartera del archivo en memoria. Los cambios y pagos son temporales; no se guardan en MySQL.' : 'Simulación: todas las operaciones y saldos son ficticios y temporales.' };
}
function reportsView(data) {
  return data.reports.map(row => ({ ...row, customer_name: find(data.customers, row.customer_id).name, nit: find(data.customers, row.customer_id).nit,
    invoice_number: find(data.invoices, row.invoice_id).invoice_number, current_balance: find(data.invoices, row.invoice_id).balance }));
}
function allocate(data, payment, allocations) {
  if (!isApplicablePayment(payment.status)) fail('El pago simulado debe estar confirmado.');
  const available = moneyCents(paymentView(data, payment).available_amount), keys = new Set();
  const checked = allocations.map(row => {
    const invoice = find(data.invoices, row.invoice_id), amount = moneyCents(row.amount);
    if (keys.has(invoice.id) || data.allocations.some(item => item.payment_id === payment.id && item.invoice_id === invoice.id && !item.deleted_at)) fail('Asignación simulada duplicada.');
    keys.add(invoice.id);
    if (invoice.customer_id !== payment.customer_id || amount <= 0n || amount > moneyCents(invoice.balance)) fail('Monto o cliente de la asignación simulada no válido.');
    return { invoice, amount };
  });
  if (checked.reduce((sum, row) => sum + row.amount, 0n) > available) fail('El monto supera el disponible del pago simulado.');
  return checked.map(({ invoice, amount }) => {
    const allocation = { id: id(data), payment_id: payment.id, invoice_id: invoice.id, amount: money(amount), created_at: now(), deleted_at: null };
    data.allocations.push(allocation); invoice.balance = money(moneyCents(invoice.balance) - amount);
    event(data, 'financial', payment.customer_id, 'Pago asignado únicamente en demostración', { invoice_id: invoice.id, amount: allocation.amount, payment_id: payment.id });
    return { ...allocation, invoice_balance: invoice.balance, payment_available: paymentView(data, payment).available_amount };
  });
}
function paymentPreview(data, customerId, body) {
  const customer = find(data.customers, customerId), amount = moneyCents(body.amount);
  if (amount <= 0n || !Array.isArray(body.allocations) || !body.allocations.length) fail('Selecciona monto y facturas para el pago simulado.');
  const keys = new Set();
  const invoices = body.allocations.map(row => {
    const invoice = find(data.invoices, row.invoice_id), allocation = moneyCents(row.amount);
    if (keys.has(invoice.id) || invoice.customer_id !== customer.id || allocation <= 0n || allocation > moneyCents(invoice.balance)) fail('Asignación simulada inválida.');
    keys.add(invoice.id); return { ...invoice, allocation_amount: money(allocation), resulting_balance: money(moneyCents(invoice.balance) - allocation) };
  });
  const total = invoices.reduce((sum, row) => sum + moneyCents(row.allocation_amount), 0n);
  if (total > amount) fail('Las asignaciones superan el monto recibido simulado.');
  const token = `simulation:${id(data)}`;
  const preview = { customer, invoices, payment: { ...body, amount: money(amount) }, unallocated_amount: money(amount - total), confirmation_token: token };
  data.confirmations[token] = structuredClone(preview); return preview;
}
function registerPayment(data, customerId, body) {
  if (body.idempotency_key && data.idempotency[body.idempotency_key]) return data.idempotency[body.idempotency_key];
  const preview = data.confirmations[body.confirmation_token];
  if (!preview || preview.customer.id !== customerId || moneyCents(preview.payment.amount) !== moneyCents(body.amount) || JSON.stringify(preview.payment.allocations) !== JSON.stringify(body.allocations)) fail('Revisa nuevamente el pago simulado antes de confirmar.');
  if (preview.invoices.some(row => find(data.invoices, row.id).balance !== row.balance)) fail('El saldo simulado cambió; genera otra vista previa.');
  const payment = { id: id(data), customer_id: customerId, amount: preview.payment.amount, payment_date: body.payment_date, payment_method: body.payment_method || 'Simulación', reference: body.reference || 'PAGO-DEMO', status: 'confirmed', created_at: now() };
  // Validate on a disposable copy first, then change the local ledger atomically.
  const trial = structuredClone(data); trial.payments.push(payment); allocate(trial, payment, body.allocations);
  data.payments.push(payment); const allocations = allocate(data, payment, body.allocations); delete data.confirmations[body.confirmation_token];
  const action = { id: id(data), customer_id: customerId, action_type: body.payment_kind === 'PARTIAL' ? 'PARTIAL_PAYMENT' : 'PAID', description: 'Simulación: pago registrado localmente.', status: 'completed', user_name: 'Equipo DEMO', action_date: now(), created_at: now() }; data.actions.push(action);
  const result = { payment: paymentView(data, payment), allocations, context: context(data, customerId, body.reference_date) };
  if (body.idempotency_key) data.idempotency[body.idempotency_key] = result;
  return result;
}
function messagePreview(data, customerId, templateId, prepared = false) {
  if (!customerId || customerId === 'undefined') fail('Selecciona un cliente para continuar.', 400);
  if (!templateId || templateId === 'undefined') fail('Selecciona una plantilla para continuar.', 400);
  const customer = find(data.customers, customerId), template = find(data.templates, templateId), collection = collectionView(data);
  const item = [...collection.customers, ...collection.non_overdue_pending.customers].find(row => row.customer.id === customer.id);
  if (template.status !== 'active' || template.channel !== 'whatsapp' || (template.stage && template.stage !== item?.stage)) fail('Plantilla no disponible para este cliente.', 404);
  const invoice = item?.main_invoice?.invoice;
  const balance = item ? new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(item.total_balance)) : null;
  const daysUntilDue = invoice ? Math.round((Date.parse(invoice.due_date) - Date.parse(browserDay())) / 86400000) : null;
  const values = { cliente_nombre: customer.name, nombre_cliente: customer.name, cliente: customer.name, nit: customer.nit, identificacion_cliente: customer.nit,
    telefono_cliente: customer.phone, numero_factura: invoice?.invoice_number, factura: invoice?.invoice_number, saldo: balance, saldo_pendiente: balance,
    fecha_emision: invoice?.issue_date, fecha_factura: invoice?.issue_date, fecha_vencimiento: invoice?.due_date,
    valor_factura: invoice ? new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(invoice.document_value)) : null,
    dias_mora: daysUntilDue == null ? null : Math.max(0, -daysUntilDue), dias_restantes: daysUntilDue == null ? null : Math.max(0, daysUntilDue),
    dias_para_vencimiento: daysUntilDue == null ? null : Math.max(0, daysUntilDue), etapa: item?.stage_label, etapa_cobranza: item?.stage_label,
    motivo_cobranza: item?.reason, empresa: 'MERTEL IMPORTACIONES S.A.S.' };
  const rendered = renderMessageTemplate(template.content, values);
  const phoneAvailable = typeof customer.phone === 'string' && Boolean(customer.phone.trim());
  if (template.attachment) requireMedia(template.attachment);
  const canPrepare = phoneAvailable && Boolean(template.content.trim() || template.attachment) && !rendered.missing_variables.length && !rendered.unsupported_variables.length && !rendered.malformed_variables;
  if (prepared && !canPrepare) fail('Falta información del cliente o de las variables para preparar el mensaje.');
  return { customer, template: { id: template.id, name: template.name }, attachment: template.attachment || null, content_type: template.content_type || 'text', stage: item?.stage, prepared, can_prepare: canPrepare,
    main_invoice: invoice ? { id: String(invoice.invoice_id ?? invoice.id), invoice_number: invoice.invoice_number } : null,
    phone_available: phoneAvailable, ...rendered };
}
function simulationSequenceInput(data, customerId, day) {
  return { customer: find(data.customers, customerId), invoices: data.invoices.filter(row => row.customer_id === customerId), templates: data.templates,
    messages: data.messages.filter(row => row.customer_id === customerId), rules: data.configuration, settings: data.whatsapp, actions: data.actions.filter(row => row.customer_id === customerId), referenceDate: day };
}
function evaluateSimulationWhatsApp(data, day) {
  const results = { queued: 0, sent: 0, cancelled: 0, skipped: 0, enabled: data.whatsapp.automations_enabled };
  if (!results.enabled) return results;
  const now = new Date(`${day}T15:00:00Z`);
  for (const customer of data.customers.filter(row => row.status === 'active' && !row.deleted_at)) {
    const input = simulationSequenceInput(data, customer.id, day), selected = automaticSelection(input);
    if (selected && !selected.message && validMobile(customer.phone)) {
      const schedule = automaticWindow(selected, input.rules, now, input.messages);
      const budgetDay = schedule ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(schedule) : null;
      const key = `automatic:${customer.id}:${selected.stage}:${selected.date}`;
      if (!data.idempotency[key] && !data.messages.some(row => row.customer_id === customer.id && row.message_mode === 'AUTOMATICO' && row.budget_date === budgetDay && row.status !== 'CANCELLED')) {
        let content; try { content = renderAutomaticNotice(selected, day); } catch { results.skipped++; continue; }
        const row = { id: id(data), customer_id: customer.id, customer_name: customer.name, invoice_id: selected.invoice.id, template_id: selected.template.id, template_name: selected.template.name,
          stage: selected.stage, content, message_mode: 'AUTOMATICO', direction: 'outbound', channel: 'whatsapp', provider: 'MOCK', status: schedule ? 'PENDING' : 'CANCELLED',
          attempts: 0, created_at: now.toISOString(), scheduled_at: schedule?.toISOString(), budget_date: budgetDay,
          automation_context: { notice_date: selected.date, expires_on: selected.expires_on, invoice_ids: selected.invoice_ids, reason: selected.description, cancellation_reason: schedule ? null : 'No hay día permitido dentro del plazo máximo.' } };
        data.messages.push(row); data.idempotency[key] = row.id; results.queued++;
      }
    }
    for (const message of data.messages.filter(row => row.customer_id === customer.id && row.message_mode === 'AUTOMATICO' && ['PENDING', 'FAILED'].includes(row.status) && !row.sent_at)) {
      const fresh = simulationSequenceInput(data, customer.id, day), notice = automaticNotices(fresh).find(row => row.stage === message.stage && row.date === message.automation_context.notice_date);
      if (!notice?.applicable || day > message.automation_context.expires_on) {
        message.status = 'CANCELLED'; message.automation_context.cancellation_reason = notice?.reason || 'Cartera pagada o aviso fuera de plazo.'; results.cancelled++; continue;
      }
      const winner = automaticSelection(fresh);
      if (winner && MERTEL_CONTACTS.findIndex(row => row.stage === winner.stage) > MERTEL_CONTACTS.findIndex(row => row.stage === notice.stage)) { message.status = 'CANCELLED'; message.automation_context.cancellation_reason = 'Se priorizó un aviso de mayor urgencia.'; results.cancelled++; continue; }
      const scheduled = automaticWindow(notice, fresh.rules, now, fresh.messages);
      if (!scheduled) { message.status = 'CANCELLED'; message.automation_context.cancellation_reason = 'No hay día permitido dentro del plazo máximo.'; results.cancelled++; continue; }
      if (scheduled > now) { message.scheduled_at = scheduled.toISOString(); continue; }
      if (data.messages.some(row => row.id !== message.id && row.customer_id === customer.id && row.message_mode === 'AUTOMATICO' && row.sent_at?.slice(0, 10) === day)) continue;
      const global = data.messages.filter(row => row.message_mode === 'AUTOMATICO' && row.sent_at?.slice(0, 10) === day);
      if (global.length >= data.whatsapp.global_daily_limit || global.filter(row => row.stage === notice.stage).length >= notice.rule.daily_limit) continue;
      try { message.content = renderAutomaticNotice(notice, day); } catch { results.skipped++; continue; }
      message.status = 'SENT'; message.sent_at = now.toISOString(); message.attempts++; message.provider_message_id = `demo:automatic:${message.id}`; message.budget_date = day; results.sent++;
      event(data, 'message', customer.id, 'Aviso automático enviado únicamente en simulación', { message_id: message.id, stage: message.stage });
    }
  }
  return results;
}
function authorize(path, method) {
  const operation = method === 'GET' ? 'view' : method === 'POST' ? 'create' : method === 'DELETE' ? 'delete' : 'update';
  let permission;
  if (/^\/(customers|invoices|payments)(\/|$)/.test(path)) permission = `${path.split('/')[1]}.${operation}`;
  if (path.includes('/allocations')) permission = `payment_allocations.${method === 'GET' ? 'view' : method === 'DELETE' ? 'reverse' : 'create'}`;
  if (path.startsWith('/portfolio')) permission = 'portfolio.view';
  if (path.startsWith('/collection')) permission = method === 'GET' ? 'collection.view' : 'collection.manage';
  if (path.startsWith('/collection/message-templates')) permission = 'message_templates.manage';
  if (path.startsWith('/whatsapp/customers/')) permission = 'collection.manage';
  if (path.startsWith('/admin')) permission = path.includes('/portfolio/') ? 'portfolio.import' : path === '/admin/roles' ? 'roles.view' : 'settings.manage';
  if (permission && !simulationSnapshot().display?.permissions.includes(permission)) fail('No tienes permiso para esta operación.', 403);
}

export function simulationRequest(config) {
  const data = simulationData(), method = (config.method || 'get').toUpperCase();
  const url = new URL(config.url, 'http://simulation.invalid'); const path = url.pathname.replace(/^\/api(?=\/)/, '');
  const params = { ...Object.fromEntries(url.searchParams), ...config.params };
  authorize(path, method);
  // Fail closed: files, real authentication and unknown requests NEVER fall through to the network.
  if (path.startsWith('/auth/')) fail('La autenticación real permanece fuera de la simulación.');
  if (method !== 'GET' && path.startsWith('/admin/portfolio/imports') && !/\/resolution\/[^/]+\/decision$/.test(path)) fail('Las importaciones y conciliaciones están deshabilitadas durante la simulación.');
  const body = typeof config.data === 'string' ? JSON.parse(config.data || '{}') : config.data || {};
  const ok = value => ({ success: true, data: structuredClone(value), simulation: true });
  let match;
  if ((match = path.match(/^\/(customers|invoices|payments)(?:\/([^/]+))?$/))) {
    const [, kind, key] = match, rows = data[kind], view = row => kind === 'invoices' ? invoiceView(data, row) : kind === 'payments' ? paymentView(data, row) : row;
    if (method === 'GET') return ok(key ? view(find(rows, key)) : rows.filter(row => !row.deleted_at).map(view));
    if (method === 'DELETE') { find(rows, key).deleted_at = now(); return ok({ message: 'Registro eliminado únicamente en simulación.' }); }
    if (kind === 'payments' && method !== 'POST' && data.allocations.some(row => row.payment_id === key && !row.deleted_at) && (body.customer_id !== find(rows, key).customer_id || moneyCents(body.amount) !== moneyCents(find(rows, key).amount))) fail('Revierte las asignaciones simuladas antes de cambiar monto o cliente.');
    const row = method === 'POST' ? { id: id(data), status: kind === 'customers' ? 'active' : kind === 'payments' ? 'confirmed' : 'pending', created_at: now() } : find(rows, key);
    const existingBalance = row.balance;
    Object.assign(row, body, { id: row.id, simulation: true, company_id: null, ...(body.customer_id ? { customer_id: String(body.customer_id) } : {}) });
    if (kind === 'invoices') { row.invoice_id = row.id; row.balance = method === 'POST' ? money(moneyCents(row.document_value)) : existingBalance; }
    if (kind === 'payments') row.amount = money(moneyCents(row.amount));
    if (method === 'POST') rows.push(row);
    event(data, kind === 'payments' ? 'financial' : 'action', row.customer_id || row.id, 'Registro de demostración actualizado'); return ok(view(row));
  }
  if ((match = path.match(/^\/payments\/([^/]+)\/allocations(?:\/([^/]+))?$/))) {
    const payment = find(data.payments, match[1]);
    if (method === 'GET') return ok(data.allocations.filter(row => row.payment_id === payment.id && !row.deleted_at).map(row => ({ ...row, invoice_number: find(data.invoices, row.invoice_id).invoice_number })));
    if (method === 'POST') return ok(allocate(data, payment, [{ ...body, invoice_id: String(body.invoice_id) }])[0]);
    const allocation = find(data.allocations, match[2]); if (allocation.deleted_at || allocation.payment_id !== payment.id) fail('Asignación simulada no disponible.');
    const invoice = find(data.invoices, allocation.invoice_id); allocation.deleted_at = now(); invoice.balance = money(moneyCents(invoice.balance) + moneyCents(allocation.amount));
    return ok({ ...allocation, invoice_balance: invoice.balance, payment_available: paymentView(data, payment).available_amount });
  }
  if (path === '/collection' && method === 'GET') return ok(collectionView(data, params.reference_date));
  if (path.startsWith('/portfolio') && method === 'GET') {
    const rows = portfolioView(data, params), totals = portfolioTotals(rows, params.reference_date || browserDay());
    if (path === '/portfolio/summary') return ok(totals);
    if (path === '/portfolio/reconciliation') return ok([]);
    if (path === '/portfolio/customers') return ok(data.customers.map(customer => ({ ...customer, customer_id: customer.id, customer_name: customer.name, customer_nit: customer.nit, ...portfolioTotals(rows.filter(row => row.customer_id === customer.id), params.reference_date || browserDay()) })));
    if ((match = path.match(/^\/portfolio\/customer\/([^/]+)$/))) return ok({ customer: { ...find(data.customers, match[1]), customer_id: match[1], customer_name: find(data.customers, match[1]).name }, totals: portfolioTotals(rows.filter(row => row.customer_id === match[1]), params.reference_date || browserDay()), invoices: rows.filter(row => row.customer_id === match[1]) });
    return ok(rows);
  }
  if (path === '/admin/dashboard') return ok(dashboardView(data, params));
  if (path === '/admin/collection/dashboard') {
    const dashboard = dashboardView(data, params); return ok({ reference_date: params.reference_date || browserDay(), portfolio: { total_balance: dashboard.summary.data.total_balance, customers_in_collection: dashboard.summary.data.stages.reduce((sum, stage) => sum + stage.customers, 0) },
      stages: dashboard.summary.data.stages, promises: dashboard.promises.data, activity: { activity_from: params.activity_from || browserDay(), activity_to: params.activity_to || browserDay(), actions_period: data.actions.length }, warnings: [], collection_status: 'ready' });
  }
  if (path === '/admin/collection/history/actors') return ok([{ id: 'SIMULATION', name: 'Equipo DEMO' }]);
  if (path === '/admin/collection/history') return ok(history(data, params));
  if ((match = path.match(/^\/collection\/customers\/([^/]+)\/(actions|promises|history|message-templates|messages\/(preview|prepare))$/))) {
    const customerId = match[1], kind = match[2]; find(data.customers, customerId);
    if (kind === 'history') return ok(history(data, params, customerId));
    if (kind === 'message-templates') {
      const item = [...collectionView(data).customers, ...collectionView(data).non_overdue_pending.customers].find(row => row.customer.id === customerId);
      return ok(data.templates.filter(row => row.status === 'active' && row.channel === 'whatsapp' && (!row.stage || row.stage === item?.stage)));
    }
    if (kind.startsWith('messages/')) return ok(messagePreview(data, customerId, String(body.template_id), match[3] === 'prepare'));
    if (method === 'GET') return ok(data[kind].filter(row => row.customer_id === customerId));
    const row = { ...body, id: id(data), customer_id: customerId, status: kind === 'promises' ? 'pending' : 'completed', user_name: 'Equipo DEMO', created_at: now(), action_date: now() }; data[kind].push(row);
    event(data, kind === 'promises' ? 'promise' : 'action', customerId, body.description || body.notes, body); return ok(row);
  }
  if ((match = path.match(/^\/collection\/results\/customers\/([^/]+)\/(context|result|payment-preview|payments)$/))) {
    const customerId = match[1], kind = match[2]; find(data.customers, customerId);
    if (kind === 'context') return ok(context(data, customerId, params.reference_date));
    if (kind === 'payment-preview') return ok(paymentPreview(data, customerId, body));
    if (kind === 'payments') {
      if (!simulationSnapshot().display.permissions.includes('payments.create') || !simulationSnapshot().display.permissions.includes('payment_allocations.create')) fail('No tienes permiso para registrar pagos.', 403);
      return ok(registerPayment(data, customerId, body));
    }
    if (body.idempotency_key && data.idempotency[body.idempotency_key]) return ok(data.idempotency[body.idempotency_key]);
    const action = { ...body, id: id(data), customer_id: customerId, action_type: body.result, status: 'completed', description: body.description, user_name: 'Equipo DEMO', created_at: now(), action_date: now() }; data.actions.push(action);
    if (body.result === 'PROMISE') data.promises.push({ ...body, id: id(data), customer_id: customerId, status: 'pending', created_at: now(), user_name: 'Equipo DEMO' });
    if (body.result === 'PAYMENT_REPORTED') data.reports.push({ ...body, id: id(data), customer_id: customerId, invoice_id: String(body.invoice_id), status: 'PENDING_REVIEW', reported_by: 'Equipo DEMO', reported_at: now() });
    event(data, body.result === 'PROMISE' ? 'promise' : 'action', customerId, body.description, { ...body, action_type: body.result });
    const result = { action, context: context(data, customerId, body.reference_date) }; if (body.idempotency_key) data.idempotency[body.idempotency_key] = result; return ok(result);
  }
  if (path === '/collection/results/reports') return ok({ reports: reportsView(data).filter(row => !params.status || row.status === params.status), page: 1, has_next: false });
  if ((match = path.match(/^\/collection\/results\/reports\/([^/]+)\/(payment-preview|review)$/))) {
    if (!simulationSnapshot().display.permissions.includes('settings.manage')) fail('No tienes permiso para revisar reportes.', 403);
    const report = find(data.reports, match[1]); if (match[2] === 'payment-preview') return ok(paymentPreview(data, report.customer_id, body));
    if (report.status !== 'PENDING_REVIEW') fail('El reporte simulado ya fue revisado.');
    if (body.decision === 'CONFIRMED') { const result = registerPayment(data, report.customer_id, body.payment); report.status = 'CONFIRMED'; report.confirmed_payment_id = result.payment.id; return ok(result); }
    report.status = 'REJECTED'; report.review_reason = body.reason; event(data, 'action', report.customer_id, body.reason); return ok(report);
  }
  if (path === '/collection/results/pipeline/refresh') return ok({ reference_date: body.reference_date, customers: (body.customers || []).map(row => ({ customer_id: row.customer_id || row.customer?.id, financial_source_ready: true, collection_item: collectionView(data, body.reference_date).customers.find(item => item.customer.id === (row.customer_id || row.customer?.id)) || null, pending_report_count: 0 })) });
  if (path === '/admin/roles') return ok(roleCatalog());
  if (path === '/admin/settings') {
    const stages = data.configuration.rules.map(rule => ({ key: rule.key, label: collectionView(data).stage_catalog.find(stage => stage.key === rule.key)?.label || rule.key, description: 'Etapa de demostración', type: 'boolean', value: rule.active, editable: true })); return ok({ configured: true, stages, settings: stages });
  }
  if (path === '/admin/settings/collection-rules') { for (const { key, active } of body.stages || []) { const rule = data.configuration.rules.find(row => row.key === key); if (rule && typeof active === 'boolean') rule.active = active; } event(data, 'configuration', null, 'Configuración local de demostración'); return simulationRequest({ ...config, method: 'get', url: '/admin/settings', data: undefined }); }
  if (path === '/admin/portfolio/imports/resolution/summary' || path === '/admin/portfolio/imports/resolution') return ok(resolutionView(data, params));
  if ((match = path.match(/^\/admin\/portfolio\/imports\/resolution\/([^/]+)\/decision$/))) {
    const row = find(data.resolution, match[1]);
    if (body.decision === 'create') { const customer = { ...data.customers[0], ...row.source_data, id: id(data), name: row.source_data.name, nit: row.source_data.nit, simulation: true }; data.customers.push(customer); row.customer_id = customer.id; row.status = 'RESOLVED'; }
    else if (body.decision === 'confirm_same') { row.customer_id = String(body.customer_id); find(data.customers, row.customer_id); row.status = 'RESOLVED'; }
    else if (body.decision === 'invalidate') row.status = 'INVALID'; else if (body.decision === 'correct') { Object.assign(row.source_data, body.corrections); row.status = 'NEW'; } else row.status = 'AMBIGUOUS';
    event(data, 'action', row.customer_id, 'Resolución de cliente de demostración'); return ok(resolutionView(data));
  }
  if (path === '/admin/portfolio/imports') return ok(data.imports || [{ id: 'DEMO', file_name: 'Cartera-ficticia-DEMO.xlsx', file_type: 'xlsx', total_rows: 6, successful_rows: 6, failed_rows: 0, error_count: 0, status: 'Importación simulada', created_at: now() }]);
  if (path.startsWith('/collection/message-templates')) {
    const match = path.match(/^\/collection\/message-templates(?:\/([^/]+))?(?:\/(activate|deactivate))?$/);
    if (method === 'GET') return ok({ templates: data.templates, stages: collectionView(data).stage_catalog, stage_catalog: collectionView(data).stage_catalog, variables: messageTemplateVariableCatalog() });
    const row = match?.[1] ? find(data.templates, match[1]) : { id: id(data), status: 'active', channel: 'whatsapp' };
    if (Object.hasOwn(body, 'attachment') && body.attachment) {
      requireMedia(body.attachment);
      if (body.content_type !== body.attachment.type) fail('El archivo no corresponde al tipo de plantilla.', 400);
    }
    if (Object.hasOwn(body, 'content_type')) {
      if (!['text', 'image', 'video', 'audio'].includes(body.content_type) || body.content_type !== 'text' && !body.attachment || body.content_type === 'text' && body.attachment) fail('Tipo de contenido y adjunto incompatibles.', 400);
      row.meta_template = null; // Internal MERTEL content does not imply Meta approval.
    }
    Object.assign(row, body); if (match?.[2]) row.status = match[2] === 'activate' ? 'active' : 'inactive'; if (!match?.[1]) data.templates.push(row); event(data, 'configuration', null, 'Plantilla de demostración actualizada'); return ok(row);
  }
  if (path.startsWith('/admin/whatsapp') || path.startsWith('/whatsapp/customers/')) {
    const suffix = path.replace('/admin/whatsapp', '');
    if (suffix === '' || suffix === '/settings' || suffix === '/test' || suffix === '/disconnect' || (suffix.startsWith('/automations/') && suffix !== '/automations/process')) {
      if (method !== 'GET') {
        if (body.credentials) fail('No introduzcas credenciales reales en la demostración.');
        if (suffix === '/settings') Object.assign(data.whatsapp, body, { provider: 'MOCK' });
        if (suffix === '/test') data.whatsapp.connection_status = body.fail ? 'ERROR' : 'CONNECTED';
        if (suffix === '/disconnect') data.whatsapp.connection_status = 'DISCONNECTED';
        if ((suffix.startsWith('/automations/') && suffix !== '/automations/process')) { data.whatsapp.rules = data.whatsapp.rules.filter(row => row.stage !== suffix.split('/').at(-1)); data.whatsapp.rules.push({ ...body, stage: suffix.split('/').at(-1) }); }
      }
      return ok({ settings: data.whatsapp, stage_catalog: collectionView(data).stage_catalog, customers: data.customers, metrics: {}, simulation: true });
    }
    if ((match = suffix.match(/^\/customers\/([^/]+)\/sequence$/))) return ok(buildWhatsAppSequence(simulationSequenceInput(data, match[1], params.reference_date || data.whatsapp_day || browserDay())));
    if ((match = suffix.match(/^\/customers\/([^/]+)\/exclusion$/))) {
      find(data.customers, match[1]); data.whatsapp.excluded_customers ||= {};
      if (body.excluded) data.whatsapp.excluded_customers[match[1]] = { source: 'MANUAL', date: now() }; else delete data.whatsapp.excluded_customers[match[1]];
      event(data, 'configuration', match[1], 'Exclusión automática actualizada en memoria'); return ok({ excluded: body.excluded });
    }
    if (suffix === '/automations/process') { const day = body.reference_date || browserDay(); data.whatsapp_day = day; return ok(evaluateSimulationWhatsApp(data, day)); }
    if (suffix === '/audit') return ok(history(data, {}).events.map(row => ({ ...row, created_at: row.occurred_at })));
    if (suffix === '/messages' && method === 'GET') {
      const filtered = data.messages.filter(row => (!params.status || row.status === params.status) && (!params.customer_id || String(row.customer_id) === String(params.customer_id)))
        .sort((a, b) => (new Date(b.created_at).getTime() || 0) - (new Date(a.created_at).getTime() || 0) || String(b.id).localeCompare(String(a.id), undefined, { numeric: true }));
      const page = Number(params.page || 1);
      return ok({ messages: filtered.slice((page - 1) * 50, page * 50), page, has_next: page * 50 < filtered.length });
    }
    if (suffix === '/test-configuration' || suffix === '/preview') return ok(messagePreview(data, String(body.customer_id), String(body.template_id)));
    if (suffix === '/messages/associate-local' && method === 'POST') {
      const customer = find(data.customers, String(body.customer_id));
      if (customer.status !== 'active' || customer.deleted_at || !Array.isArray(body.message_ids) || !body.message_ids.length) fail('Selecciona un cliente activo y una conversación.');
      const messages = body.message_ids.map(key => find(data.messages, String(key)));
      if (messages.some(row => row.customer_id != null || !phoneKey(row.recipient || row.phone) || phoneKey(row.recipient || row.phone) !== phoneKey(customer.phone))) fail('El cliente elegido no coincide con el teléfono de esta conversación o ya existe una asociación.');
      for (const row of messages) { row.customer_id = customer.id; row.customer_name = customer.name; }
      event(data, 'message', customer.id, 'Asociación explícita de conversación únicamente en memoria', { message_ids: body.message_ids });
      return ok({ customer_id: customer.id });
    }
    if (suffix === '/queue' && method === 'POST' && Object.hasOwn(body, 'content')) {
      const customer = find(data.customers, String(body.customer_id));
      if (customer.status !== 'active' || customer.deleted_at || !phoneKey(customer.phone)) fail('El cliente no tiene un número de WhatsApp válido.');
      if (body.mode !== 'MANUAL' || body.template_id != null || typeof body.content !== 'string' || !body.content.trim() && !body.attachment || body.content.length > 16000) fail('Revisa el mensaje manual de demostración.');
      if (body.attachment) requireMedia(body.attachment);
      const row = { id: id(data), customer_id: customer.id, customer_name: customer.name, recipient: customer.phone, content: body.content.trim(),
        ...(body.attachment ? { attachment: body.attachment, content_type: body.attachment.type, media_simulated: true } : {}),
        channel: 'whatsapp', direction: 'outbound', message_mode: 'MANUAL', template_id: null, status: 'PENDING', provider: 'MOCK',
        simulation: true, attempts: 0, created_at: now(), scheduled_at: now() };
      data.messages.push(row); return ok({ message: row, duplicate: false });
    }
    if (suffix === '/queue' || path.startsWith('/whatsapp/customers/')) {
      const customerId = String(body.customer_id || path.split('/')[3]), templateId = String(body.template_id || ''), preview = messagePreview(data, customerId, templateId, true);
      const row = { id: id(data), customer_id: customerId, customer_name: preview.customer.name, template_name: preview.template.name, template_id: templateId, content: preview.content, ...(preview.attachment ? { attachment: preview.attachment, content_type: preview.content_type, media_simulated: true } : {}), stage: preview.stage, direction: 'outbound', channel: 'whatsapp', status: 'PENDING', provider: 'MOCK', attempts: 0, created_at: now(), scheduled_at: now() }; data.messages.push(row); return ok({ message: row, duplicate: false });
    }
    if ((match = suffix.match(/^\/messages\/([^/]+)\/(mock-send|mock-delivery|cancel)$/))) {
      const row = find(data.messages, match[1]); row.status = match[2] === 'cancel' ? 'CANCELLED' : body.fail ? 'FAILED' : match[2] === 'mock-send' ? 'SENT' : body.status || 'DELIVERED';
      if (row.status === 'SENT') { row.sent_at = now(); row.provider_message_id = 'demo:envio-local'; row.attempts++; } if (row.status === 'DELIVERED') row.delivered_at = now(); if (row.status === 'READ') row.read_at = now();
      event(data, 'message', row.customer_id, `${row.status} únicamente en demostración`); return ok(match[2] === 'mock-send' ? { message: row, simulated: true } : row);
    }
    if (suffix === '/mock-incoming') {
      if (['BAJA', 'STOP', 'CANCELAR'].includes(String(body.content).trim().toUpperCase())) {
        const customer = data.customers.find(row => row.phone.replace(/\D/g, '') === String(body.phone).replace(/\D/g, ''));
        if (customer) { data.whatsapp.excluded_customers ||= {}; data.whatsapp.excluded_customers[customer.id] = { source: String(body.content).trim().toUpperCase(), date: now() }; }
      }
      const owner = conversationOwner({ phone: body.phone }, data.customers);
      const row = { ...body, id: id(data), customer_id: owner.customer?.id || null, customer_name: owner.customer?.name || null,
        recipient: body.phone, direction: 'inbound', channel: 'whatsapp', status: 'DELIVERED', provider: 'MOCK', content: body.content,
        received_at: body.received_at || now(), created_at: now() };
      data.messages.push(row); return ok(row); }

  }
  if (path.startsWith('/admin/users')) {
    if (method === 'GET') return ok({ users: data.users, roles: roleCatalog() });
    fail('La administración de cuentas está deshabilitada en la demostración.');
  }
  fail('Esta operación no está disponible en simulación. No se realizó ninguna solicitud real.');
}

export async function simulationAdapter(config) {
  try { return { data: simulationRequest(config), status: config.method === 'post' ? 201 : 200, statusText: 'Simulación local', headers: {}, config }; }
  catch (error) { const response = { data: { success: false, message: error.message, code: 'SIMULATION_LOCAL_ONLY' }, status: error.status || 409, headers: {}, config }; throw new AxiosError(error.message, 'ERR_BAD_REQUEST', config, undefined, response); }
}
