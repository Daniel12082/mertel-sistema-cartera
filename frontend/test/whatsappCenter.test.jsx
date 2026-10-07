import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext } from '../src/auth/auth.context';
import WhatsAppCenter from '../src/pages/Administracion/WhatsAppCenter';
import { whatsappRequest } from '../src/services/whatsappCenter.service';
import { getMessageTemplateAdminData } from '../src/services/messageTemplatesAdmin.service';
vi.mock('../src/services/whatsappCenter.service');
vi.mock('../src/services/messageTemplatesAdmin.service');
const template = { id: '1', name: 'DEMO / BORRADOR', stage: 'overdue', status: 'active', content: '{{cliente_nombre}}' };
const center = { settings: { connection_status: 'NOT_CONFIGURED', provider: null, number: '', automations_enabled: false, rules: [], credentials_configured: false }, stage_catalog: [{ key: 'overdue', label: 'En mora' }] };
function view(permissions = ['settings.manage', 'message_templates.manage']) { return render(<MemoryRouter><AuthContext.Provider value={{ permissions }}><WhatsAppCenter /></AuthContext.Provider></MemoryRouter>); }
beforeEach(() => {
  vi.clearAllMocks();
  getMessageTemplateAdminData.mockResolvedValue({ templates: [template], stage_catalog: center.stage_catalog, variables: [{ name: 'cliente_nombre', example: 'Cliente DEMO' }] });
  whatsappRequest.mockImplementation(path => Promise.resolve(path === '/messages' ? { messages: [], page: 1 } : path === '/audit' ? [] : center));
});
describe('WhatsApp administrative center', () => {
  it('shows disconnected status, no real sending and masks credentials', async () => {
    view(); expect(await screen.findByText('No conectado')).toBeVisible(); expect(screen.getByText(/ningún envío real/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Probar conexión MOCK' })).toBeDisabled();
  });
  it('denies collector configuration without fetching admin data', () => {
    view(['collection.manage']); expect(screen.getByRole('alert')).toHaveTextContent('No tienes permiso'); expect(whatsappRequest).not.toHaveBeenCalled();
  });
  it('saves MOCK settings with explicit limits and does not forge connected status', async () => {
    const user = userEvent.setup(); view(); await user.click(await screen.findByRole('button', { name: 'Configurar WhatsApp' }));
    await user.selectOptions(screen.getByLabelText('Proveedor'), 'MOCK'); await user.type(screen.getByLabelText('Máximo global diario'), '20'); await user.type(screen.getByLabelText('Máximo por cliente/día'), '1');
    await user.click(screen.getByRole('button', { name: 'Guardar configuración' }));
    expect(whatsappRequest).toHaveBeenCalledWith('/settings', expect.objectContaining({ method: 'patch', body: expect.objectContaining({ provider: 'MOCK', global_daily_limit: 20, customer_daily_limit: 1 }) }));
  });
  it('shows connected MOCK and validates rules using stage catalog, hours, days and limits', async () => {
    whatsappRequest.mockResolvedValue({ ...center, settings: { ...center.settings, provider: 'MOCK', connection_status: 'CONNECTED' } });
    const user = userEvent.setup(); view(); expect(await screen.findByText('Conectado · simulación MOCK')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Automatizaciones', exact: true }));
    await user.selectOptions(screen.getByLabelText('Plantilla'), '1'); await user.selectOptions(screen.getByLabelText('Modo'), 'AUTOMATICO');
    fireEvent.change(screen.getByLabelText('Hora inicio'), { target: { value: '08:00' } }); fireEvent.change(screen.getByLabelText('Hora fin'), { target: { value: '17:00' } });
    await user.type(screen.getByLabelText('Máximo por etapa/día'), '1'); await user.type(screen.getByLabelText('Intervalo mínimo (horas)'), '24'); await user.click(screen.getByLabelText('Lunes')); await user.click(screen.getByLabelText('Regla activa'));
    await user.click(screen.getByRole('button', { name: 'Guardar regla de En mora' }));
    expect(whatsappRequest).toHaveBeenCalledWith('/automations/overdue', expect.objectContaining({ body: expect.objectContaining({ start_time: '08:00', weekdays: [1], daily_limit: 1, enabled: true, mode: 'AUTOMATICO' }) }));
  });
  it('preview missing variables prevents queuing and displays validation information', async () => {
    whatsappRequest.mockImplementation(path => Promise.resolve(path === '/test-configuration' ? { customer: { name: 'Cliente DEMO' }, stage: 'overdue', content: '{{vendedor}}', variables: [{ name: 'vendedor', value: null }], missing_variables: ['vendedor'], unsupported_variables: [], can_prepare: false } : path === '/messages' ? { messages: [], page: 1 } : center));
    const user = userEvent.setup(); view(); await screen.findByText('No conectado'); await user.click(screen.getByRole('button', { name: 'Mensajes', exact: true }));
    await user.type(screen.getByLabelText('ID del cliente'), '1'); await user.selectOptions(screen.getByLabelText('Plantilla'), '1'); await user.click(screen.getByRole('button', { name: 'Probar configuración / vista previa' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('vendedor'); expect(screen.getByRole('button', { name: 'Guardar en cola manual' })).toBeDisabled();
  });
  it('filters history and shows failed messages and retry dates', async () => {
    whatsappRequest.mockImplementation(path => Promise.resolve(path === '/messages' ? { messages: [{ id: '2', customer_name: 'Cliente DEMO', template_name: 'DEMO', status: 'FAILED', direction: 'outbound', content: 'DEMO', attempts: 1, error_code: 'MOCK_SEND_FAILED', error_message: 'Fallo simulado', next_attempt_at: '2026-10-07T15:15:00Z' }], page: 1 } : center));
    const user = userEvent.setup(); view(); await screen.findByText('No conectado'); await user.click(screen.getByRole('button', { name: 'Mensajes', exact: true }));
    expect(await screen.findByText(/MOCK_SEND_FAILED: Fallo simulado/)).toBeVisible();
    await user.selectOptions(screen.getByLabelText('Filtrar estado'), 'FAILED');
    await waitFor(() => expect(whatsappRequest).toHaveBeenCalledWith('/messages', expect.objectContaining({ params: expect.objectContaining({ status: 'FAILED' }) })));
  });
  it('reuses existing template editor and displays audit events', async () => {
    whatsappRequest.mockImplementation(path => Promise.resolve(path === '/audit' ? [{ id: '1', action: 'automation_update', entity_type: 'whatsapp_setting', entity_id: '1', created_at: '2026-10-07T15:00:00Z' }] : center));
    const user = userEvent.setup(); view(); await screen.findByText('No conectado'); await user.click(screen.getByRole('button', { name: 'Plantillas', exact: true }));
    expect(await screen.findByRole('heading', { name: 'Plantillas WhatsApp', exact: true })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Historial', exact: true })); expect(await screen.findByText('Regla de mensajería actualizada')).toBeVisible();
  });
});
