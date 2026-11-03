import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import api from '../src/services/api';
import { permissionsForRoles } from '../../backend/src/config/permissions';
import { enterSimulation, leaveSimulation, simulationData } from '../src/simulation/store';
import { SimulationContext } from '../src/simulation/simulation.context';
import WhatsAppManualSend from '../src/pages/Administracion/WhatsAppManualSend';
import { queueCustomerWhatsApp, sendManualWhatsApp } from '../src/services/whatsappCenter.service';
import { collectionView } from '../src/simulation/views';

const originalAdapter = api.defaults.adapter;
const network = vi.fn();
const identity = { roles: [{ name: 'admin' }], permissions: permissionsForRoles([{ name: 'admin' }]) };
beforeEach(() => { network.mockReset(); api.defaults.adapter = network; enterSimulation(identity); });
afterEach(() => { leaveSimulation(); api.defaults.adapter = originalAdapter; });
function view(mode = 'SIMULATION', templates = simulationData().templates) {
  return render(<SimulationContext.Provider value={{ mode }}><WhatsAppManualSend settings={mode === 'SIMULATION' ? simulationData().whatsapp : { provider: 'MOCK', connection_status: 'CONNECTED' }} templates={templates} /></SimulationContext.Provider>);
}
async function select(user) {
  await waitFor(() => expect(screen.getByLabelText('Cliente')).toBeEnabled());
  await user.selectOptions(screen.getByLabelText('Cliente'), '91001');
  await user.selectOptions(screen.getByLabelText('Plantilla'), '96001');
}
const finances = data => structuredClone({ invoices: data.invoices, payments: data.payments, allocations: data.allocations, customers: data.customers, configuration: data.configuration });

describe('manual WhatsApp with the actual local simulation adapter', () => {
  it('selects actual IDs, renders variables and sends in one action without financial or network changes', async () => {
    const user = userEvent.setup(); const before = finances(simulationData()); view();
    expect(screen.getByText('Selecciona un cliente para continuar.')).toBeVisible();
    await select(user);
    const button = screen.getByRole('button', { name: 'Enviar mensaje por WhatsApp', exact: true });
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.getByLabelText('Vista previa del mensaje')).toHaveTextContent('Hola Distribuciones Andinas DEMO S.A.S.');
    expect(screen.getByLabelText('Vista previa del mensaje')).toHaveTextContent(/FV-DEMO-001 por \$\s*1\.800\.000/);
    expect(screen.getByLabelText('Vista previa del mensaje').querySelector('pre').textContent).not.toContain('simulado');
    await user.click(screen.getByRole('button', { name: 'Vista previa', exact: true }));
    await waitFor(() => expect(button).toBeEnabled());
    await user.dblClick(button);
    expect(await screen.findByText('Mensaje simulado enviado correctamente. No se realizó ningún envío real.')).toBeVisible();
    expect(simulationData().messages.filter(row => row.id !== '97001' && row.customer_id === '91001' && row.status === 'SENT')).toHaveLength(1);
    expect(finances(simulationData())).toEqual(before); expect(network).not.toHaveBeenCalled();
  });
  it('clears the preview and disables sending with an empty template', async () => {
    const user = userEvent.setup(); view(); await select(user);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar mensaje por WhatsApp' })).toBeEnabled());
    await user.selectOptions(screen.getByLabelText('Plantilla'), '');
    expect(screen.getByText('Selecciona una plantilla para continuar.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Enviar mensaje por WhatsApp' })).toBeDisabled();
  });
  it('has controlled errors for a missing template, empty catalog and missing customer', async () => {
    await expect(sendManualWhatsApp({ customer_id: '91001', template_id: 'missing' })).rejects.toThrow(/Registro de demostración/);
    await expect(sendManualWhatsApp({ customer_id: '', template_id: '96001' })).rejects.toThrow('Selecciona un cliente');
    await expect(sendManualWhatsApp({ customer_id: '91001', template_id: '' })).rejects.toThrow('Selecciona una plantilla');
    simulationData().templates = [];
    await expect(queueCustomerWhatsApp('91001', '')).rejects.toThrow();
    view(); expect(screen.getByText('No hay plantillas activas autorizadas disponibles.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Enviar mensaje por WhatsApp' })).toBeDisabled(); expect(network).not.toHaveBeenCalled();
  });
  it('prevents sending for a customer without a phone', async () => {
    simulationData().customers[0].phone = ''; const user = userEvent.setup(); view(); await select(user);
    expect(await screen.findByText(/El cliente no tiene teléfono registrado/)).toBeVisible();
    await screen.findByText(/Información pendiente/);
    expect(screen.getByRole('button', { name: 'Enviar mensaje por WhatsApp' })).toBeDisabled();
    expect(network).not.toHaveBeenCalled();
  });
  it('blocks unknown and unavailable variables instead of inventing data', async () => {
    simulationData().templates[0].content = '{{vendedor}} {{variable_inexistente}}';
    const user = userEvent.setup(); view(); await select(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('vendedor, variable_inexistente');
    expect(screen.getByRole('button', { name: 'Enviar mensaje por WhatsApp' })).toBeDisabled();
  });
  it('uses invoice_id when the engine identifier differs from id', () => {
    simulationData().invoices[0].invoice_id = 'canonical-invoice';
    expect(collectionView(simulationData()).customers[0].main_invoice.invoice.invoice_id).toBe('canonical-invoice');
  });
  it('queue and send have the same message wrapper as the backend; no undefined.id', async () => {
    const queued = await queueCustomerWhatsApp('91001', '96001');
    expect(queued.message.id).toBeDefined(); expect(queued.message.status).toBe('PENDING'); expect(queued.duplicate).toBe(false);
    const sent = await sendManualWhatsApp({ customer_id: '91001', template_id: '96001' });
    expect(sent.status).toBe('SENT'); expect(network).not.toHaveBeenCalled();
  });
  it('shows recoverable backend errors without exposing a JavaScript exception', async () => {
    leaveSimulation();
    network.mockResolvedValue({ status: 200, headers: {}, data: { success: true, data: [{ id: '91001', name: 'Cliente', status: 'active', phone: '3001234567' }] } });
    view('REAL', [{ id: '96001', name: 'Plantilla', status: 'active', channel: 'whatsapp' }]);
    const user = userEvent.setup(); await waitFor(() => expect(screen.getByLabelText('Cliente')).toBeEnabled());
    network.mockRejectedValue({ response: { status: 500, data: { message: "Cannot read properties of undefined (reading 'id')" } } });
    await select(user); expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo completar la operación');
    expect(screen.getByRole('alert')).not.toHaveTextContent('undefined'); expect(screen.getByRole('button', { name: 'Reintentar' })).toBeEnabled();
  });
  it('does not resend an already sent duplicate returned by the existing backend', async () => {
    leaveSimulation();
    network.mockResolvedValue({ status: 200, headers: {}, data: { success: true, data: { message: { id: '7', status: 'SENT', provider: 'MOCK' }, duplicate: true } } });
    expect((await sendManualWhatsApp({ customer_id: '1', template_id: '2' })).status).toBe('SENT');
    expect(network).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed queue responses before reading an ID or dispatching', async () => {
    leaveSimulation();
    network.mockResolvedValue({ status: 200, headers: {}, data: { success: true, data: { duplicate: false } } });
    await expect(sendManualWhatsApp({ customer_id: '1', template_id: '2' })).rejects.toThrow('No se pudo identificar el mensaje');
    expect(network).toHaveBeenCalledTimes(1);
  });
  it('reports scheduled messages as pending instead of claiming they were sent', async () => {
    leaveSimulation();
    network.mockImplementation(config => Promise.resolve({ status: 200, headers: {}, data: { success: true, data: {
      message: { id: '7', status: 'PENDING', provider: 'MOCK' }, ...(config.url.endsWith('mock-send') ? { scheduled: true } : { duplicate: false }),
    } } }));
    expect((await sendManualWhatsApp({ customer_id: '1', template_id: '2' })).status).toBe('PENDING');
    expect(network).toHaveBeenCalledTimes(2);
  });
});
