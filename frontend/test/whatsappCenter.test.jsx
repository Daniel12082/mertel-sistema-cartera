import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext } from '../src/auth/auth.context';
import WhatsAppCenter from '../src/pages/Administracion/WhatsAppCenter';
import WhatsAppAutomationPreview from '../src/pages/Administracion/WhatsAppAutomationPreview';
import { whatsappRequest } from '../src/services/whatsappCenter.service';
import { getCustomers } from '../src/services/customer.service';
import { getMessageTemplateAdminData } from '../src/services/messageTemplatesAdmin.service';
vi.mock('../src/services/whatsappCenter.service');
vi.mock('../src/services/customer.service');
vi.mock('../src/services/messageTemplatesAdmin.service');
const template = { id: '1', name: 'DEMO / BORRADOR', stage: 'overdue', status: 'active', content: '{{cliente_nombre}}' };
const center = { settings: { connection_status: 'NOT_CONFIGURED', provider: null, number: '', automations_enabled: false, rules: [], credentials_configured: false }, stage_catalog: [{ key: 'overdue', label: 'En mora' }] };
function view(permissions = ['settings.manage', 'message_templates.manage']) { return render(<MemoryRouter><AuthContext.Provider value={{ permissions }}><WhatsAppCenter /></AuthContext.Provider></MemoryRouter>); }
beforeEach(() => {
  vi.clearAllMocks();
  getCustomers.mockResolvedValue({ success: true, data: [] });
  getMessageTemplateAdminData.mockResolvedValue({ templates: [template], stage_catalog: center.stage_catalog, variables: [{ name: 'cliente_nombre', example: 'Cliente DEMO' }] });
  whatsappRequest.mockImplementation(path => Promise.resolve(path === '/messages' ? { messages: [], page: 1 } : path === '/audit' ? [] : center));
});
describe('WhatsApp administrative center', () => {
  it('does not offer test automation when production cannot resolve the Meta provider', () => {
    vi.stubEnv('PROD', true);
    try {
      render(<WhatsAppAutomationPreview settings={{ ...center.settings, provider: 'MOCK' }} />);
      expect(screen.getByRole('alert')).toHaveTextContent('La conexión real con Meta no está disponible');
      expect(screen.queryByRole('button', { name: /MOCK/i })).not.toBeInTheDocument();
      expect(whatsappRequest).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });
  it('shows disconnected status, no real sending and masks credentials', async () => {
    view(); await userEvent.click(await screen.findByRole('button', { name: 'Conexión', exact: true })); expect(await screen.findByText('No conectado')).toBeVisible(); expect(screen.getByText(/ningún envío real/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Probar conexión MOCK' })).toBeDisabled();
  });
  it('denies collector configuration without fetching admin data', () => {
    view(['collection.manage']); expect(screen.getByRole('alert')).toHaveTextContent('No tienes permiso'); expect(whatsappRequest).not.toHaveBeenCalled();
  });
  it('saves MOCK settings with explicit limits and does not forge connected status', async () => {
    const user = userEvent.setup(); view(); await user.click(await screen.findByRole('button', { name: 'Conexión', exact: true })); await user.click(await screen.findByRole('button', { name: 'Configurar WhatsApp' }));
    await user.selectOptions(screen.getByLabelText('Proveedor'), 'MOCK'); await user.type(screen.getByLabelText('Máximo global diario'), '20'); await user.type(screen.getByLabelText('Máximo por cliente/día'), '1');
    await user.click(screen.getByRole('button', { name: 'Guardar configuración' }));
    expect(whatsappRequest).toHaveBeenCalledWith('/settings', expect.objectContaining({ method: 'patch', body: expect.objectContaining({ provider: 'MOCK', global_daily_limit: 20, customer_daily_limit: 1 }) }));
  });
  it('shows fixed commercial rules, disables Sunday and does not activate anything on mount', async () => {
    const user = userEvent.setup(); view(); await user.click(await screen.findByRole('button', { name: 'Automatizaciones', exact: true }));
    expect(await screen.findByRole('heading', { name: 'Automatización de mensajes' })).toBeVisible();
    expect(screen.getByLabelText('Hora inicial de Pronto pago')).toBeEnabled();
    expect(screen.getAllByLabelText('Domingo').every(node => node.disabled)).toBe(true);
    expect(screen.getByText('mertel_pronto_pago')).toBeVisible();
    expect(screen.getByText('mertel_mora')).toBeVisible();
    expect(whatsappRequest.mock.calls.every(([, options]) => !options?.method || options.method === 'get')).toBe(true);
  });
  it('filters history and shows failed messages and retry dates', async () => {
    whatsappRequest.mockImplementation(path => Promise.resolve(path === '/messages' ? { messages: [{ id: '2', customer_name: 'Cliente DEMO', template_name: 'DEMO', status: 'FAILED', direction: 'outbound', content: 'DEMO', attempts: 1, error_code: 'MOCK_SEND_FAILED', error_message: 'Fallo simulado', next_attempt_at: '2026-10-07T15:15:00Z' }], page: 1 } : center));
    const user = userEvent.setup(); view(); await user.click(await screen.findByRole('button', { name: 'Mensajes', exact: true }));
    expect(await screen.findByText(/MOCK_SEND_FAILED: Fallo simulado/)).toBeVisible();
    await user.selectOptions(screen.getByLabelText('Filtrar estado'), 'FAILED');
    await waitFor(() => expect(whatsappRequest).toHaveBeenCalledWith('/messages', expect.objectContaining({ params: expect.objectContaining({ status: 'FAILED' }) })));
  });
  it('reuses existing template editor and displays audit events', async () => {
    whatsappRequest.mockImplementation(path => Promise.resolve(path === '/audit' ? [{ id: '1', action: 'automation_update', entity_type: 'whatsapp_setting', entity_id: '1', created_at: '2026-10-07T15:00:00Z' }] : center));
    const user = userEvent.setup(); view(); await user.click(await screen.findByRole('button', { name: 'Plantillas', exact: true }));
    expect(await screen.findByRole('heading', { name: 'Plantillas WhatsApp', exact: true })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Historial', exact: true })); expect(await screen.findByText('Regla de mensajería actualizada')).toBeVisible();
  });
});
