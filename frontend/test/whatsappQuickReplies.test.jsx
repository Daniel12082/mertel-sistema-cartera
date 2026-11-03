import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import api from '../src/services/api';
import * as whatsappService from '../src/services/whatsappCenter.service';
import WhatsAppConversations from '../src/pages/Administracion/WhatsAppConversations';
import { quickReplyCommands, quickReplyToken } from '../src/pages/Administracion/whatsappQuickReplies.commands';
import { SimulationContext } from '../src/simulation/simulation.context';
import { enterSimulation, leaveSimulation, simulationData } from '../src/simulation/store';
import { permissionsForRoles } from '../../backend/src/config/permissions';

const original = api.defaults.adapter, network = vi.fn();
const originalRequest = whatsappService.whatsappRequest;
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn(); network.mockReset(); api.defaults.adapter = network;
  enterSimulation({ roles: [{ name: 'admin' }], permissions: permissionsForRoles([{ name: 'admin' }]) });
});
afterEach(() => { leaveSimulation(); api.defaults.adapter = original; vi.restoreAllMocks(); });
const view = (mode = 'SIMULATION') => render(<SimulationContext.Provider value={{ mode }}><WhatsAppConversations settings={{ provider: 'MOCK', connection_status: 'CONNECTED' }} /></SimulationContext.Provider>);
const open = async user => user.click(await screen.findByRole('button', { name: 'Abrir conversación Distribuciones Andinas DEMO S.A.S.' }));
const financial = () => JSON.stringify({ invoices: simulationData().invoices, customers: simulationData().customers, payments: simulationData().payments, whatsapp: simulationData().whatsapp });

describe('quick commands without a parallel template catalog', () => {
  it('normalizes accents and resolves colliding short names deterministically', () => {
    const templates = [{ id: '1', name: 'Horario', content: 'A' }, { id: '2', name: 'Horário', content: 'B' }, { id: '3', name: 'Horario 1', content: 'C' }];
    const commands = quickReplyCommands(templates);
    expect(new Set(commands.map(row => row.command)).size).toBe(3);
    expect(commands.find(row => row.id === '1').command).toBe('horario-1');
    expect(quickReplyCommands([...templates].reverse())).toEqual(commands);
  });
  it('detects tokens at the caret, excluding words, URLs and punctuation', () => {
    expect(quickReplyToken('/rec', 4)).toEqual({ start: 0, end: 4, query: 'rec' });
    expect(quickReplyToken('Hola /rec después', 9)).toEqual({ start: 5, end: 9, query: 'rec' });
    for (const text of ['hola/rec', 'https://mertel.co/rec', '/https://mertel.co', ' /rec.com']) expect(quickReplyToken(text, text.length)).toBeNull();
    expect(quickReplyToken('/rec.com', 4)).toBeNull();
  });
  it('filters, selects with keyboard, resolves actual data, allows editing and only sends on explicit click', async () => {
    const user = userEvent.setup(), before = financial(), count = simulationData().messages.length; view(); await open(user);
    const input = screen.getByLabelText('Redactar mensaje'); await user.type(input, '/rec');
    const option = await screen.findByRole('option', { name: /Recordatorio de demostración/ });
    expect(option).toHaveTextContent('/recordatorio');
    await user.keyboard('{ArrowDown}{ArrowUp}{Enter}');
    await waitFor(() => expect(input.value).toContain('Distribuciones Andinas DEMO S.A.S.'));
    expect(input.value).toContain('FV-DEMO-001'); expect(input.value).not.toContain('{{');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument(); expect(simulationData().messages).toHaveLength(count);
    await user.type(input, ' Gracias.'); const content = input.value;
    await user.click(screen.getByRole('button', { name: 'Simular envío del mensaje' }));
    await screen.findByText('Mensaje simulado enviado correctamente. No se realizó ningún envío real.');
    expect(simulationData().messages.at(-1).content).toBe(content); expect(financial()).toBe(before); expect(network).not.toHaveBeenCalled();
  });
  it('inserts at the caret preserving other text, dismisses with Escape and leaves unmatched text editable', async () => {
    const user = userEvent.setup(); view(); await open(user); const input = screen.getByLabelText('Redactar mensaje');
    await user.type(input, 'Inicio /rec final'); input.setSelectionRange(11, 11); fireEvent.select(input);
    await user.click(await screen.findByRole('option', { name: /Recordatorio de demostración/ }));
    await waitFor(() => expect(input.value).toMatch(/^Inicio Hola .* final$/));
    await user.clear(input); await user.type(input, '/'); await screen.findByRole('listbox'); await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument(); expect(input).toHaveValue('/');
    await user.type(input, 'no-existe'); expect(await screen.findByText(/No hay plantillas disponibles para este comando/)).toBeVisible();
    await user.keyboard('{Enter}'); expect(input.value).toContain('\n');
    await user.clear(input); await user.type(input, 'https://mertel.co/rec'); expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(network).not.toHaveBeenCalled();
  });
  it('reports missing variables and blocks sending even if an unresolved token is manually removed', async () => {
    simulationData().templates.find(row => row.id === '96001').content = 'Hola {{cliente_nombre}} {{vendedor}}';
    const user = userEvent.setup(); view(); await open(user); const input = screen.getByLabelText('Redactar mensaje');
    await user.type(input, '/rec'); await user.click(await screen.findByRole('option', { name: /Recordatorio de demostración/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('vendedor');
    expect(screen.getByRole('button', { name: 'Simular envío del mensaje' })).toBeDisabled();
    fireEvent.change(input, { target: { value: 'Dato inventado' } });
    expect(screen.getByRole('button', { name: 'Simular envío del mensaje' })).toBeDisabled(); expect(network).not.toHaveBeenCalled();
  });
  it('keeps colliding commands mapped to the exact selected existing template', async () => {
    const data = simulationData(); data.templates.push({ ...data.templates[0], id: 'extra', name: data.templates[0].name, content: 'Contenido diferente {{cliente_nombre}}' });
    const user = userEvent.setup(); view(); await open(user); const input = screen.getByLabelText('Redactar mensaje');
    await user.type(input, '/rec'); const options = await screen.findAllByRole('option', { name: /Recordatorio de demostración/ }); expect(options).toHaveLength(2);
    await user.click(options.find(option => option.textContent.includes('/recordatorio-extra')));
    await waitFor(() => expect(input.value).toBe('Contenido diferente Distribuciones Andinas DEMO S.A.S.')); expect(network).not.toHaveBeenCalled();
  });
  it('discards a delayed preview when the draft or selected customer changes', async () => {
    const resolvers = [];
    vi.spyOn(whatsappService, 'whatsappRequest').mockImplementation((path, options) => {
      if (path !== '/preview') return originalRequest(path, options);
      return new Promise(resolve => resolvers.push(resolve));
    });
    const user = userEvent.setup(); view(); await open(user); const input = screen.getByLabelText('Redactar mensaje');
    await user.type(input, '/rec'); await user.keyboard('{Enter}'); await screen.findByText('Preparando plantilla…');
    fireEvent.change(input, { target: { value: 'Edición durante la consulta' } });
    const preview = { customer: { id: '91001' }, template: { id: '96001' }, content: 'Vista previa antigua', missing_variables: [], unsupported_variables: [], can_prepare: true };
    resolvers[0](preview); await waitFor(() => expect(input).toHaveValue('Edición durante la consulta'));
    await user.clear(input); await user.type(input, '/rec'); await user.keyboard('{Enter}'); await screen.findByText('Preparando plantilla…');
    await user.click(screen.getByRole('button', { name: 'Abrir conversación Repuestos Horizonte DEMO' }));
    resolvers[1](preview); await waitFor(() => expect(screen.getByLabelText('Redactar mensaje')).toHaveValue(''));
    expect(screen.queryByText('Preparando plantilla…')).not.toBeInTheDocument(); expect(network).not.toHaveBeenCalled();
  });
  it('uses the existing REAL manual queue and validations; edits never send a different template silently', async () => {
    const customer = structuredClone(simulationData().customers[0]); leaveSimulation();
    network.mockImplementation(config => {
      let data;
      if (config.url === '/customers') data = [customer];
      else if (config.url.endsWith('/message-templates')) data = [{ id: '7', name: 'Horario', content: 'Hola {{cliente_nombre}}' }];
      else if (config.url.endsWith('/preview')) data = { customer, template: { id: '7', name: 'Horario' }, content: `Hola ${customer.name}`, missing_variables: [], unsupported_variables: [], can_prepare: true };
      else if (config.url.endsWith('/queue')) data = { message: { id: 'msg', customer_id: customer.id, content: `Hola ${customer.name}`, provider: 'MOCK', status: 'PENDING' } };
      else if (config.url.endsWith('/mock-send')) data = { message: { id: 'msg', customer_id: customer.id, content: `Hola ${customer.name}`, provider: 'MOCK', status: 'SENT' } };
      else if (config.url.endsWith('/messages')) data = { messages: [], has_next: false };
      else if (config.url.endsWith('/context')) data = { customer, total_balance: '1800000.00', open_invoices: [] };
      else if (config.url.endsWith('/sequence')) data = { customer };
      return Promise.resolve({ config, status: 200, headers: {}, data: { success: true, data } });
    });
    const user = userEvent.setup(); view('REAL'); await open(user); const input = screen.getByLabelText('Redactar mensaje');
    await waitFor(() => expect(input).toBeEnabled()); await user.type(input, '/hor'); await user.keyboard('{Enter}');
    const send = screen.getByRole('button', { name: 'Enviar mensaje con proveedor MOCK' }); await waitFor(() => expect(send).toBeEnabled());
    expect(network.mock.calls.filter(([config]) => config.url.endsWith('/queue'))).toHaveLength(0);
    await user.type(input, ' editado'); expect(send).toBeDisabled(); expect(screen.getByRole('alert')).toHaveTextContent('texto validado');
    await user.clear(input); await user.type(input, '/hor'); await user.keyboard('{Enter}'); await waitFor(() => expect(send).toBeEnabled());
    await user.click(send); await screen.findByText('Mensaje enviado correctamente en el proveedor MOCK. No se realizó ningún envío real.');
    const calls = network.mock.calls.filter(([config]) => config.url.endsWith('/queue'));
    expect(calls).toHaveLength(1); expect(JSON.parse(calls[0][0].data)).toEqual({ customer_id: customer.id, template_id: '7', mode: 'MANUAL' });
  });
});
