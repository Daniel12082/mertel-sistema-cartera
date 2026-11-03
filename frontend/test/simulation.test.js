import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import api from '../src/services/api';
import { enterSimulation, leaveSimulation, resetSimulation, simulationData, simulationSnapshot, MODE_KEY } from '../src/simulation/store';
import { permissionsForRoles } from '../../backend/src/config/permissions.js';

const identity = { id: 7, name: 'Nombre real que no se debe copiar', roles: [{ name: 'admin' }], permissions: permissionsForRoles([{ name: 'admin' }]) };
let network;
beforeEach(() => { leaveSimulation(); network = vi.fn(async config => ({ data: { success: true, data: [{ name: 'REAL-SENTINEL' }] }, status: 200, config, headers: {} })); api.defaults.adapter = network; });
afterEach(() => { leaveSimulation(); vi.restoreAllMocks(); });
const request = async (method, url, data, params) => (await api.request({ method, url, data, params })).data.data;

describe('central simulation isolation', () => {
  it('real mode continues to use the existing adapter; simulated reads never consult it', async () => {
    expect((await request('get', '/customers'))[0].name).toBe('REAL-SENTINEL'); expect(network).toHaveBeenCalledTimes(1);
    network.mockClear(); enterSimulation(identity);
    expect((await request('get', '/customers'))[0].name).toContain('DEMO');
    expect(JSON.stringify(simulationSnapshot().display)).not.toContain(identity.name);
    expect(network).not.toHaveBeenCalled();
  });
  it('all real financial, administrative, authentication and unknown writes are blocked or local, even with a custom request adapter', async () => {
    enterSimulation(identity);
    for (const url of ['/unknown-writer', '/auth/login', '/auth/refresh', '/auth/logout', '/admin/portfolio/imports/analyze', '/admin/portfolio/imports/reconcile', '/admin/portfolio/imports/pipeline', '/admin/users', '/provider/whatsapp']) {
      await expect(api.post(url, {}, { adapter: network })).rejects.toMatchObject({ response: { status: 409 } });
    }
    await expect(request('get', '/unexpected-sensitive-reader')).rejects.toMatchObject({ response: { status: 409 } });
    expect(network).not.toHaveBeenCalled();
  });
  it('rejects stale real reads and refuses entering simulation while a real mutation is in flight', async () => {
    let resolveRead;
    api.defaults.adapter = config => new Promise(resolve => { resolveRead = () => resolve({ data: { data: 'REAL-SECRET' }, status: 200, config, headers: {} }); });
    const pending = api.get('/customers'); await vi.waitFor(() => expect(resolveRead).toBeTypeOf('function'));
    enterSimulation(identity); resolveRead(); await expect(pending).rejects.toMatchObject({ code: 'ERR_CANCELED' });
    leaveSimulation(); let resolveWrite;
    api.defaults.adapter = config => new Promise(resolve => { resolveWrite = () => resolve({ data: {}, status: 200, config, headers: {} }); });
    const writing = api.post('/customers', {}); await vi.waitFor(() => expect(resolveWrite).toBeTypeOf('function'));
    expect(() => enterSimulation(identity)).toThrow(/Espera/); resolveWrite(); await writing;
  });
  it('reset restores every table; exit drops data and only simulation session keys', async () => {
    enterSimulation(identity); const original = structuredClone(simulationData());
    await request('post', '/collection/customers/91001/actions', { description: 'Gestión local' });
    await request('post', '/collection/customers/91001/promises', { promised_date: '2030-01-01', promised_amount: '100.00' });
    resetSimulation(); expect(simulationData()).toEqual(original);
    expect(sessionStorage.getItem(MODE_KEY)).toBe('true'); expect(sessionStorage.getItem('mertel_simulation_display')).not.toContain(identity.name);
    leaveSimulation(); expect(() => simulationData()).toThrow(); expect(sessionStorage.getItem(MODE_KEY)).toBeNull(); expect(sessionStorage.getItem('mertel_simulation_display')).toBeNull();
    await request('get', '/customers'); expect(network).toHaveBeenCalledTimes(1);
  });
});

describe('existing workflows on an invented local ledger', () => {
  beforeEach(() => enterSimulation(identity));
  it('reuses the engine for all four stages, not-overdue invoices and dashboard charts', async () => {
    const pipeline = await request('get', '/collection');
    expect(pipeline.customers.map(row => row.stage)).toEqual(['overdue', 'due_today', 'five_days_before_due', 'prompt_payment']);
    expect(pipeline.non_overdue_pending.customers).toHaveLength(1);
    const dashboard = await request('get', '/admin/dashboard');
    expect(dashboard.overview.data.pending_invoices).toBe(6); expect(dashboard.summary.data.stages).toHaveLength(4); expect(dashboard.priority_customers.data).toHaveLength(4);
    expect(network).not.toHaveBeenCalled();
  });
  it('management, promises, customer/invoice edits and audit change only the local store', async () => {
    await request('post', '/collection/results/customers/91001/result', { result: 'CONTACTED', description: 'Contacto de prueba local', idempotency_key: 'demo-action' });
    await request('post', '/collection/results/customers/91001/result', { result: 'PROMISE', promised_date: '2030-01-01', promised_amount: '500000.00', description: 'Promesa ficticia' });
    await request('put', '/customers/91001', { name: 'Cliente Editado DEMO' });
    await request('put', '/invoices/92001', { notes: 'Nota local', balance: '1.00' });
    expect(simulationData().invoices[0].balance).toBe('1000000.00');
    expect(simulationData().customers[0].name).toBe('Cliente Editado DEMO');
    expect(simulationData().promises).toHaveLength(2);
    expect((await request('get', '/collection/customers/91001/history')).events.some(row => row.description.includes('Promesa ficticia'))).toBe(true);
    expect(network).not.toHaveBeenCalled();
  });
  it('a local partial payment updates balance, allocations and dashboard; confirmation is idempotent', async () => {
    const body = { amount: '500000.00', payment_date: simulationData().referenceDate, payment_kind: 'PARTIAL', allocations: [{ invoice_id: '92001', amount: '500000.00' }], idempotency_key: 'demo-partial' };
    const preview = await request('post', '/collection/results/customers/91001/payment-preview', body);
    const payment = { ...body, confirmation_token: preview.confirmation_token };
    await request('post', '/collection/results/customers/91001/payments', payment);
    await request('post', '/collection/results/customers/91001/payments', payment);
    expect(simulationData().invoices[0].balance).toBe('500000.00'); expect(simulationData().payments).toHaveLength(2); expect(simulationData().allocations).toHaveLength(2);
    expect((await request('get', '/admin/dashboard')).recovery.data.payments_amount).toBe('1000000.00'); expect(network).not.toHaveBeenCalled();
  });
  it('reported payment waits for review; confirmed local report updates only fictitious finances', async () => {
    await request('post', '/collection/results/customers/91003/result', { result: 'PAYMENT_REPORTED', invoice_id: '92004', reported_amount: '100000.00', reported_payment_date: simulationData().referenceDate, description: 'Soporte ficticio' });
    expect(simulationData().invoices[3].balance).toBe('900000.00');
    const report = simulationData().reports.at(-1);
    const body = { amount: report.reported_amount, payment_date: report.reported_payment_date, allocations: [{ invoice_id: report.invoice_id, amount: report.reported_amount }] };
    const preview = await request('post', `/collection/results/reports/${report.id}/payment-preview`, body);
    await request('post', `/collection/results/reports/${report.id}/review`, { decision: 'CONFIRMED', payment: { ...body, confirmation_token: preview.confirmation_token } });
    expect(report.status).toBe('CONFIRMED'); expect(simulationData().invoices[3].balance).toBe('800000.00'); expect(network).not.toHaveBeenCalled();
  });
  it('WhatsApp preview, send, delivery and read are local; credentials/files/unknown calls cannot reach any provider', async () => {
    const preview = await request('post', '/admin/whatsapp/test-configuration', { customer_id: '91001', template_id: '96001' }); expect(preview.content).toContain('Hola Distribuciones Andinas'); expect(preview.content).not.toContain('Mensaje simulado');
    await request('post', '/admin/whatsapp/messages/97001/mock-send', {});
    await request('post', '/admin/whatsapp/messages/97001/mock-delivery', { status: 'DELIVERED' });
    await request('post', '/admin/whatsapp/messages/97001/mock-delivery', { status: 'READ' });
    expect(simulationData().messages[0].status).toBe('READ'); expect(simulationData().messages[0].provider_message_id).toBe('demo:envio-local');
    await expect(request('patch', '/admin/whatsapp/settings', { credentials: { access_token: 'do-not-store' } })).rejects.toBeTruthy();
    expect(JSON.stringify(simulationData())).not.toContain('do-not-store'); expect(network).not.toHaveBeenCalled();
  });
  it('uses simulated resolution/history/settings and retains the authenticated user permissions', async () => {
    const settings = await request('get', '/admin/settings');
    await request('put', '/admin/settings/collection-rules', { stages: settings.stages.map(row => ({ key: row.key, active: row.key !== 'prompt_payment' })) });
    expect((await request('get', '/collection')).customers.some(row => row.stage === 'prompt_payment')).toBe(false);
    const resolution = await request('get', '/admin/portfolio/imports/resolution/summary'); expect(resolution.pending).toBe(2);
    await request('post', '/admin/portfolio/imports/resolution/99001/decision', { decision: 'create' }); expect(simulationData().resolution[0].status).toBe('RESOLVED');
    leaveSimulation(); enterSimulation({ ...identity, roles: [{ name: 'collector' }], permissions: permissionsForRoles([{ name: 'collector' }]) });
    await expect(request('get', '/admin/dashboard')).rejects.toMatchObject({ response: { status: 403 } }); expect(network).not.toHaveBeenCalled();
  });
});
