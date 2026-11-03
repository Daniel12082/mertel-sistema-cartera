import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import api from '../src/services/api';
import WhatsAppConversations from '../src/pages/Administracion/WhatsAppConversations';
import { SimulationContext } from '../src/simulation/simulation.context';
import { enterSimulation, leaveSimulation, resetSimulation, simulationData } from '../src/simulation/store';
import { permissionsForRoles } from '../../backend/src/config/permissions';
import { sendConversationSimulation, associateConversationSimulation } from '../src/services/whatsappCenter.service';
import { conversationOwner } from '../src/pages/Administracion/whatsappConversation.presentation';

const network = vi.fn(), originalAdapter = api.defaults.adapter;
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  network.mockReset(); api.defaults.adapter = network;
  enterSimulation({ roles: [{ name: 'admin' }], permissions: permissionsForRoles([{ name: 'admin' }]) });
});
afterEach(() => { leaveSimulation(); api.defaults.adapter = originalAdapter; });
const view = (mode = 'SIMULATION') => render(<SimulationContext.Provider value={{ mode }}><div className="wa-center"><WhatsAppConversations /></div></SimulationContext.Provider>);
const financial = data => structuredClone({ customers: data.customers, invoices: data.invoices, payments: data.payments, allocations: data.allocations, actions: data.actions, promises: data.promises, reports: data.reports, rules: data.configuration, whatsapp: data.whatsapp });
const open = async (user, name = 'Distribuciones Andinas DEMO S.A.S.') => user.click(await screen.findByRole('button', { name: `Abrir conversación ${name}` }));

describe('visual conversations on the existing local dataset and adapter', () => {
  it('shows incoming/outgoing history, authoritative portfolio and a free-text simulation with no financial or network changes', async () => {
    const user = userEvent.setup(), data = simulationData(), before = financial(data); view();
    expect(screen.getByText('Tu bandeja de WhatsApp')).toBeVisible(); await open(user);
    expect(await screen.findByLabelText('Mensaje entrante 97005')).toHaveTextContent('¿Me compartes las facturas pendientes?');
    expect(screen.getByLabelText('Mensaje saliente 97001')).toHaveTextContent('Pendiente');
    expect(await screen.findByText('$ 1.800.000')).toBeVisible();
    expect(screen.getByText('FV-DEMO-001')).toBeVisible(); expect(screen.getByText('FV-DEMO-002')).toBeVisible();
    await user.type(screen.getByLabelText('Redactar mensaje'), 'Hola, te comparto la información solicitada.');
    await user.dblClick(screen.getByRole('button', { name: 'Simular envío del mensaje' }));
    expect(await screen.findByText('Mensaje simulado enviado correctamente. No se realizó ningún envío real.')).toBeVisible();
    const sent = data.messages.filter(row => row.content === 'Hola, te comparto la información solicitada.'); expect(sent).toHaveLength(1); expect(sent[0].status).toBe('SENT');
    expect(sent[0].customer_id).toBe('91001'); expect(sent[0].template_id).toBeNull(); expect(financial(data)).toEqual(before); expect(network).not.toHaveBeenCalled();
  });
  it('changes conversation without mixing messages or drafts and filters by NIT/phone/client/state', async () => {
    const user = userEvent.setup(); view(); await open(user);
    await user.type(screen.getByLabelText('Redactar mensaje'), 'Borrador de Andinas');
    await open(user, 'Repuestos Horizonte DEMO');
    expect(screen.getByLabelText('Redactar mensaje')).toHaveValue(''); expect(screen.queryByLabelText('Mensaje entrante 97005')).not.toBeInTheDocument();
    await open(user); expect(screen.getByLabelText('Redactar mensaje')).toHaveValue('Borrador de Andinas');
    await user.type(screen.getByLabelText('Buscar conversaciones'), 'DEMO-NIT-002');
    expect(screen.getByRole('button', { name: 'Abrir conversación Repuestos Horizonte DEMO' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Abrir conversación Distribuciones Andinas DEMO S.A.S.' })).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText('Buscar conversaciones')); await user.selectOptions(screen.getByLabelText('Filtrar conversaciones por estado'), 'empty');
    expect(screen.getByRole('button', { name: 'Abrir conversación Suministros Boreal DEMO' })).toBeVisible();
  });
  it('handles an empty chat and a customer without a phone', async () => {
    simulationData().customers[4].phone = ''; const user = userEvent.setup(); view(); await open(user, 'Suministros Boreal DEMO');
    expect(screen.getByText('No hay mensajes registrados para este cliente.')).toBeVisible();
    expect(screen.getByLabelText('Redactar mensaje')).toBeDisabled(); expect(screen.getByRole('button', { name: 'Simular envío del mensaje' })).toBeDisabled();
    expect(screen.getByText(/Este cliente no tiene un número de WhatsApp válido/)).toBeVisible(); expect(network).not.toHaveBeenCalled();
  });
  it('does not guess ambiguous ownership and allows explicit association only to a matching authorized customer', async () => {
    const data = simulationData(); data.customers[1].phone = data.customers[0].phone;
    data.messages.push({ id: 'ambiguous-demo', customer_id: null, phone: data.customers[0].phone, content: 'Mensaje con asociación pendiente.', direction: 'inbound', status: 'DELIVERED', provider: 'MOCK' });
    const before = financial(data), user = userEvent.setup(); view(); await open(user, 'Asociación ambigua');
    expect(screen.getByText(/Hay varios clientes con este teléfono/)).toBeVisible(); expect(screen.getByLabelText('Redactar mensaje')).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Cliente para asociar'), '91002'); await user.click(screen.getByRole('button', { name: 'Asociar en esta demo' }));
    expect(await screen.findByLabelText('Mensaje entrante ambiguous-demo')).toBeVisible();
    expect(data.messages.find(row => row.id === 'ambiguous-demo').customer_id).toBe('91002'); expect(financial(data)).toEqual(before); expect(network).not.toHaveBeenCalled();
  });
  it('uses an existing explicit ID even when phone matches are ambiguous, and does not create clients for unknown senders', () => {
    const data = simulationData(); data.customers[1].phone = data.customers[0].phone;
    expect(conversationOwner(data.messages[0], data.customers).customer.id).toBe('91001');
    expect(conversationOwner({ phone: '+573119999999' }, data.customers).customer).toBeNull();
    expect(data.customers).toHaveLength(5);
  });
  it('retains local messages when remounting and drops them when simulation is reset', async () => {
    const user = userEvent.setup(); const result = view(); await open(user);
    await user.type(screen.getByLabelText('Redactar mensaje'), 'Mensaje temporal de la bandeja'); await user.click(screen.getByRole('button', { name: 'Simular envío del mensaje' }));
    await screen.findByText('Mensaje simulado enviado correctamente. No se realizó ningún envío real.'); result.unmount();
    const remounted = view(); await open(user); expect(screen.getByRole('log')).toHaveTextContent('Mensaje temporal de la bandeja'); remounted.unmount();
    resetSimulation(); view(); await open(user); expect(screen.getByRole('log')).not.toHaveTextContent('Mensaje temporal de la bandeja'); expect(network).not.toHaveBeenCalled();
  });
  it('offers independent recovery for financial errors without inventing a zero balance or allowing production sending', async () => {
    const customer = structuredClone(simulationData().customers[0]); leaveSimulation();
    let failed = true;
    network.mockImplementation(config => {
      let data = null;
      if (config.url === '/customers') data = [customer];
      else if (config.url.endsWith('/message-templates')) data = [];
      else if (config.url.endsWith('/messages')) data = { messages: [], page: 1, has_next: false };
      else if (config.url.endsWith('/sequence')) data = { customer, steps: [], stage_label: 'En mora' };
      else if (config.url.endsWith('/context')) {
        if (failed) return Promise.reject({ response: { status: 503, data: { message: 'Fuente de cartera no disponible.' } } });
        data = { customer, total_balance: '1800000.00', open_invoices: [] };
      }
      return Promise.resolve({ config, status: 200, headers: {}, data: { success: true, data } });
    });
    const user = userEvent.setup(); view('REAL'); await open(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('El saldo no se sustituye por cero');
    expect(screen.getByLabelText('Redactar mensaje')).toBeDisabled();
    failed = false; await user.click(screen.getByRole('button', { name: 'Reintentar cartera' }));
    expect(await screen.findByText('$ 1.800.000')).toBeVisible();
    expect(network.mock.calls.every(([config]) => config.method === 'get')).toBe(true);
  });
  it('blocks free-text and local associations outside simulation without any HTTP request', async () => {
    leaveSimulation();
    await expect(sendConversationSimulation('91001', 'No debe salir')).rejects.toThrow('Modo Simulación');
    await expect(associateConversationSimulation(['97001'], '91001')).rejects.toThrow('Modo Simulación'); expect(network).not.toHaveBeenCalled();
  });
  it('cannot send to production when the mode changes during the asynchronous operation', async () => {
    const pending = sendConversationSimulation('91001', 'No debe llegar a producción'); leaveSimulation();
    await expect(pending).rejects.toThrow(/Simulación|fuente de datos/); expect(network).not.toHaveBeenCalled();
  });
});
