import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import api from '../src/services/api';
import { enterSimulation, leaveSimulation, simulationData } from '../src/simulation/store';
import { SimulationContext } from '../src/simulation/simulation.context';
import { permissionsForRoles } from '../../backend/src/config/permissions';
import { createSimulationDataset } from '../src/simulation/dataset';
import { MERTEL_CONTACTS, contactDates } from '../../backend/src/services/whatsappSequence';
import { whatsappRequest } from '../src/services/whatsappCenter.service';
import WhatsAppCustomerTimeline from '../src/pages/Administracion/WhatsAppCustomerTimeline';
const network = vi.fn(), original = api.defaults.adapter;
beforeEach(() => {
  network.mockReset(); api.defaults.adapter = network;
  enterSimulation({ roles: [{ name: 'admin' }], permissions: permissionsForRoles([{ name: 'admin' }]) });
  const data = simulationData(); Object.assign(data, createSimulationDataset('2026-10-08')); data.whatsapp.automations_enabled = true;
  data.whatsapp.rules = MERTEL_CONTACTS.map(step => ({ stage: step.stage, template_id: data.templates.find(row => row.name === step.template_name).id, enabled: true, mode: 'AUTOMATICO', weekdays: [1,2,3,4,5,6], start_time: '08:00', end_time: '18:00', interval_hours: 1, daily_limit: 100 }));
});
afterEach(() => { leaveSimulation(); api.defaults.adapter = original; });
const finances = data => structuredClone({ customers: data.customers, invoices: data.invoices, payments: data.payments, allocations: data.allocations, configuration: data.configuration });
describe('complete automation simulation using shared backend notice policy', () => {
  it('demonstrates all four notice stages, no repetition and no network or financial mutation', async () => {
    const data = simulationData(), before = finances(data), invoice = data.invoices.find(row => row.customer_id === '91003'), dates = contactDates(invoice, data.configuration);
    expect(dates.every(row => row.applicable)).toBe(true);
    for (const step of dates) {
      await whatsappRequest('/automations/process', { method: 'post', body: { reference_date: step.date } });
      const result = await whatsappRequest('/customers/91003/sequence', { params: { reference_date: step.date } });
      expect(result.steps.find(row => row.stage === step.stage).message.status).toBe('SENT');
      const count = data.messages.filter(row => row.customer_id === '91003' && row.message_mode === 'AUTOMATICO').length;
      await whatsappRequest('/automations/process', { method: 'post', body: { reference_date: step.date } });
      expect(data.messages.filter(row => row.customer_id === '91003' && row.message_mode === 'AUTOMATICO')).toHaveLength(count);
    }
    expect(data.messages.filter(row => row.customer_id === '91003' && row.message_mode === 'AUTOMATICO')).toHaveLength(4);
    expect(finances(data)).toEqual(before); expect(network).not.toHaveBeenCalled();
  });
  it('shows client identity, balance, planned/actual dates and backend exclusion in the timeline', async () => {
    const user = userEvent.setup(); render(<SimulationContext.Provider value={{ mode: 'SIMULATION' }}><WhatsAppCustomerTimeline /></SimulationContext.Provider>);
    await waitFor(() => expect(screen.getByRole('option', { name: /Moto Partes Aurora/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText('Cliente de la timeline'), '91003');
    expect(await screen.findByRole('heading', { name: 'Moto Partes Aurora DEMO' })).toBeVisible();
    expect(screen.getByText('DEMO-NIT-003')).toBeVisible();
    expect(screen.getByText('mertel_pronto_pago')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Excluir de mensajes automáticos' }));
    expect(await screen.findByText('Cliente excluido: el backend bloquea los mensajes automáticos.')).toBeVisible();
    expect(simulationData().whatsapp.excluded_customers['91003'].source).toBe('MANUAL'); expect(network).not.toHaveBeenCalled();
  });
  for (const keyword of ['BAJA', 'STOP', 'CANCELAR']) it(`${keyword} prevents automatic sending in simulation`, async () => {
    const data = simulationData(), customer = data.customers.find(row => row.id === '91003'), invoice = data.invoices.find(row => row.customer_id === customer.id), before = finances(data);
    await whatsappRequest('/mock-incoming', { method: 'post', body: { phone: customer.phone, content: keyword, provider_message_id: `mock:local-${keyword}`, received_at: new Date().toISOString() } });
    await whatsappRequest('/automations/process', { method: 'post', body: { reference_date: contactDates(invoice, data.configuration)[0].date } });
    expect(data.messages.some(row => row.customer_id === customer.id && row.message_mode === 'AUTOMATICO')).toBe(false);
    expect(finances(data)).toEqual(before); expect(network).not.toHaveBeenCalled();
  });
});
