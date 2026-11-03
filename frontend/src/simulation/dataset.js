import { MERTEL_CONTACTS } from '../../../backend/src/services/whatsappSequence';
import configuration from '../../../backend/config/mertel-collection-rules.json';
import { dateDay, dateFromDay } from '../../../backend/src/services/promptPayment.service.js';

export function browserDay() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export const shiftDay = (date, days) => dateFromDay(dateDay(date) + days);

// Entirely invented presentation records. No seed, API, employee or operational data is read.
export function createSimulationDataset(referenceDate = browserDay()) {
  const names = ['Distribuciones Andinas DEMO S.A.S.', 'Repuestos Horizonte DEMO', 'Moto Partes Aurora DEMO', 'Comercial Ruta Norte DEMO', 'Suministros Boreal DEMO'];
  const customers = names.map((name, index) => ({ id: String(91001 + index), company_id: null, simulation: true, name,
    nit: `DEMO-NIT-00${index + 1}`, phone: `+57300000000${index + 1}`, email: `cliente${index + 1}@example.invalid`,
    address: 'Dirección ficticia de demostración', city: 'Ciudad DEMO', status: 'active', credit_limit: '10000000.00', available_credit: '5000000.00', notes: 'Dato ficticio · Simulación' }));
  const invoice = (index, customerIndex, dueOffset, issueOffset, amount, balance = amount) => ({ id: String(92001 + index), invoice_id: String(92001 + index),
    customer_id: customers[customerIndex].id, company_id: null, simulation: true, invoice_number: `FV-DEMO-${String(index + 1).padStart(3, '0')}`,
    issue_date: shiftDay(referenceDate, issueOffset), due_date: shiftDay(referenceDate, dueOffset), document_value: amount, base_value: amount,
    iva_value: '0.00', promo_18: null, discount: null, balance, status: 'pending', notes: 'Documento ficticio · Simulación' });
  const invoices = [invoice(0, 0, -35, -80, '1500000.00', '1000000.00'), invoice(1, 0, 20, -25, '800000.00'),
    invoice(2, 1, 0, -30, '650000.00'), invoice(3, 2, 5, -25, '900000.00'), invoice(4, 3, 25, -2, '450000.00'), invoice(5, 4, 20, -20, '300000.00')];
  const timestamp = `${referenceDate}T15:00:00.000Z`;
  const actions = [{ id: '94001', customer_id: customers[0].id, invoice_id: invoices[0].id, action_type: 'CONTACTED', description: 'Simulación: contacto de demostración, sin llamada real.', user_name: 'Equipo DEMO', user_id: 'SIMULATION', status: 'completed', action_date: timestamp, created_at: timestamp }];
  for (let index = 1; index <= 6; index++) {
    const time = `${shiftDay(referenceDate, -index)}T15:00:00.000Z`;
    actions.push({ ...actions[0], id: String(94001 + index), customer_id: customers[index % customers.length].id, invoice_id: null, action_type: index % 2 ? 'CONTACTED' : 'NO_RESPONSE', action_date: time, created_at: time });
  }
  const promises = [{ id: '95001', customer_id: customers[0].id, invoice_id: invoices[0].id, promised_date: shiftDay(referenceDate, 3), promised_amount: '500000.00', status: 'pending', notes: 'Promesa de demostración', created_at: timestamp, user_name: 'Equipo DEMO' }];
  const templates = [{ id: '96001', name: 'Recordatorio de demostración', description: 'Plantilla ficticia', channel: 'whatsapp', content: 'Hola {{cliente_nombre}}, te recordamos que tienes pendiente la factura {{numero_factura}} por {{saldo}}.', stage: null, status: 'active' }];
  templates.push(...MERTEL_CONTACTS.map((step, index) => ({ id: String(96002 + index), name: step.template_name, description: 'DEMO · solo memoria local', channel: 'whatsapp', stage: step.stage, status: 'active', content: 'Hola {{cliente_nombre}}.' })));
  const chatTimestamp = `${shiftDay(referenceDate, -1)}T15:00:00.000Z`;
  const messages = [{ id: '97001', customer_id: customers[0].id, customer_name: customers[0].name, template_id: templates[0].id, template_name: templates[0].name,
    direction: 'outbound', channel: 'whatsapp', stage: 'overdue', status: 'PENDING', content: 'Buenos días. Estamos disponibles para ayudarte con tus facturas pendientes.', provider: 'MOCK', provider_message_id: 'demo:local', created_at: chatTimestamp, scheduled_at: chatTimestamp, attempts: 0 }];
  for (const [index, status] of ['SENT', 'DELIVERED', 'READ'].entries()) messages.push({ ...messages[0], id: String(97002 + index), customer_id: customers[index + 1].id, customer_name: customers[index + 1].name, status, attempts: 1, sent_at: chatTimestamp });
  messages.push({ id: '97005', customer_id: customers[0].id, customer_name: customers[0].name, recipient: customers[0].phone,
    channel: 'whatsapp', direction: 'inbound', status: 'DELIVERED', content: 'Buenos días. ¿Me compartes las facturas pendientes?',
    provider: 'MOCK', simulation: true, received_at: chatTimestamp, created_at: chatTimestamp });
  const reports = [{ id: '98001', customer_id: customers[1].id, invoice_id: invoices[2].id, reported_amount: '200000.00', reported_payment_date: referenceDate,
    status: 'PENDING_REVIEW', reported_at: timestamp, reported_by: 'Equipo DEMO', description: 'Simulación: soporte de pago ficticio pendiente de revisión.' }];
  const resolution = [{ id: '99001', status: 'NEW', nit_normalized: 'DEMO-NIT-NUEVO', source_rows: [2], source_data: { name: 'Almacén Ficticio DEMO', nit: 'DEMO-NIT-NUEVO', city: 'Ciudad DEMO' }, candidates: [], differences: [], customer_id: null },
    { id: '99002', status: 'AMBIGUOUS', nit_normalized: customers[0].nit, source_rows: [3], source_data: { name: 'Distribuciones Andinas DEMO (revisar)', nit: customers[0].nit }, candidates: [customers[0]], differences: [], customer_id: customers[0].id }];
  return { referenceDate, customers, invoices, actions, promises, templates, messages, reports, resolution,
    payments: [{ id: '93001', customer_id: customers[0].id, amount: '500000.00', payment_date: referenceDate, reference: 'PAGO-DEMO-001', payment_method: 'Transferencia simulada', status: 'confirmed', created_at: timestamp }],
    allocations: [{ id: '93501', payment_id: '93001', invoice_id: invoices[0].id, amount: '500000.00', created_at: timestamp, deleted_at: null }],
    events: actions.map(item => ({ id: item.id, type: 'action', action: 'result_registered', entity_type: 'collection_action', title: 'Simulación · Gestión registrada', actor: 'Equipo DEMO', customer_id: item.customer_id, customer_name: customers.find(customer => customer.id === item.customer_id)?.name, occurred_at: item.created_at, description: item.description, metadata: { action_type: item.action_type } })),
    configuration: structuredClone(configuration), users: [{ id: 'SIMULATION', name: 'Equipo de demostración', first_name: 'Equipo DEMO', email: 'presentacion@example.invalid', status: 'active', roles: [] }],
    whatsapp: { provider: 'MOCK', connection_status: 'CONNECTED', number: 'NÚMERO-DEMO-SIN-ENVÍO', credentials_present: false, automations_enabled: false, rules: [], excluded_customers: {}, global_daily_limit: 100, customer_daily_limit: 1 }, confirmations: {}, idempotency: {}, nextId: 100001 };
}
