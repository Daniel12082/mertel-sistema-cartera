import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import api from '../src/services/api';
import MessageTemplates from '../src/pages/Administracion/MessageTemplates';
import WhatsAppConversations from '../src/pages/Administracion/WhatsAppConversations';
import WhatsAppManualSend from '../src/pages/Administracion/WhatsAppManualSend';
import { AuthContext } from '../src/auth/auth.context';
import { SimulationContext } from '../src/simulation/simulation.context';
import { enterSimulation, leaveSimulation, resetSimulation, simulationData } from '../src/simulation/store';
import { permissionsForRoles } from '../../backend/src/config/permissions';
import { temporaryWhatsAppMedia, validateMediaFile, MEDIA_LIMITS, requireMedia } from '../src/services/whatsappMedia.service';
import { createMessageTemplate } from '../src/services/messageTemplatesAdmin.service';
import { sendManualWhatsApp, sendConversationSimulation } from '../src/services/whatsappCenter.service';

const permissions = permissionsForRoles([{ name: 'admin' }]);
const original = api.defaults.adapter, network = vi.fn();
const file = (type = 'image', name = `archivo.${type}`) => new File(['contenido local'], name, { type: { image: 'image/png', video: 'video/mp4', audio: 'audio/mpeg' }[type] });
const finance = () => JSON.stringify({ customers: simulationData().customers, invoices: simulationData().invoices, payments: simulationData().payments, allocations: simulationData().allocations, configuration: simulationData().configuration });
beforeEach(() => {
  network.mockReset(); api.defaults.adapter = network; Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => `blob:local/${crypto.randomUUID()}`), revokeObjectURL: vi.fn() }));
  enterSimulation({ roles: [{ name: 'admin' }], permissions });
});
afterEach(() => { leaveSimulation(); api.defaults.adapter = original; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const view = (node, mode = 'SIMULATION') => render(<AuthContext.Provider value={{ permissions }}><SimulationContext.Provider value={{ mode }}>{node}</SimulationContext.Provider></AuthContext.Provider>);
const open = async (user, name = 'Distribuciones Andinas DEMO S.A.S.') => user.click(await screen.findByRole('button', { name: `Abrir conversación ${name}` }));

describe('session media uses existing templates and messages', () => {
  it.each(['image', 'video', 'audio'])('creates and edits %s templates, including media without text, through the existing local catalog', async type => {
    const before = finance(), user = userEvent.setup(); view(<MessageTemplates />);
    const create = await screen.findByRole('button', { name: 'Nueva plantilla' }); await waitFor(() => expect(create).toBeEnabled()); await user.click(create);
    await user.type(screen.getByLabelText('Nombre de plantilla'), `Multimedia ${type}`);
    await user.selectOptions(screen.getByLabelText('Tipo de contenido'), type);
    await user.selectOptions(screen.getByLabelText('Estado inicial'), 'active');
    await user.upload(screen.getByLabelText('Archivo adjunto'), file(type));
    expect(await screen.findByLabelText(`Adjunto archivo.${type}`)).toHaveTextContent('Adjunto temporal');
    await user.click(screen.getByRole('button', { name: 'Crear plantilla' }));
    const saved = await screen.findByRole('row', { name: new RegExp(`Multimedia ${type}`) }); expect(saved).toHaveTextContent('Con adjunto temporal');
    const row = simulationData().templates.find(template => template.name === `Multimedia ${type}`);
    expect(row.content).toBe(''); expect(row.attachment.type).toBe(type); expect(row.attachment.storage).toBe('session');
    expect(JSON.stringify(row)).not.toMatch(/blob:|base64|contenido local/);
    await user.click(screen.getByRole('button', { name: `Editar Multimedia ${type}` }));
    await user.upload(screen.getByLabelText('Archivo adjunto'), file(type, `reemplazo.${type}`));
    await screen.findByLabelText(`Adjunto reemplazo.${type}`); await user.type(screen.getByLabelText('Contenido de plantilla'), 'Texto opcional');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await screen.findByRole('row', { name: new RegExp(`Multimedia ${type}`) });
    expect(row.content).toBe('Texto opcional'); expect(row.attachment.name).toBe(`reemplazo.${type}`);
    await user.click(screen.getByRole('button', { name: `Editar Multimedia ${type}` })); await user.click(screen.getByRole('button', { name: 'Retirar adjunto' }));
    await user.selectOptions(screen.getByLabelText('Tipo de contenido'), 'text'); await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await screen.findByRole('row', { name: new RegExp(`Multimedia ${type}`) }); expect(row.attachment).toBeNull(); expect(row.content_type).toBe('text');
    expect(finance()).toBe(before); expect(network).not.toHaveBeenCalled();
  });
  it('inserts a multimedia quick reply without sending and prepares the edited message locally', async () => {
    const attachment = await temporaryWhatsAppMedia.put(file());
    simulationData().templates.push({ id: 'multimedia', name: 'Imagen cartera', content: 'Hola {{cliente_nombre}}', content_type: 'image', attachment, status: 'active', channel: 'whatsapp', stage: null });
    const count = simulationData().messages.length, before = finance(), user = userEvent.setup(); view(<WhatsAppConversations />); await open(user);
    await user.type(screen.getByLabelText('Redactar mensaje'), '/imagen'); await user.click(await screen.findByRole('option', { name: /Imagen cartera/ }));
    await screen.findByLabelText('Adjunto archivo.image'); expect(screen.getByLabelText('Redactar mensaje')).toHaveValue('Hola Distribuciones Andinas DEMO S.A.S.');
    expect(simulationData().messages).toHaveLength(count); await user.type(screen.getByLabelText('Redactar mensaje'), ' Gracias.');
    await user.click(screen.getByRole('button', { name: 'Simular envío del mensaje' }));
    await screen.findByText('Mensaje multimedia simulado preparado correctamente. Ningún archivo fue enviado ni entregado realmente.');
    const message = simulationData().messages.at(-1); expect(message.attachment).toEqual(attachment); expect(message.content).toContain('Gracias.');
    expect(screen.getByRole('log')).toHaveTextContent('Multimedia simulada · sin entrega real'); expect(finance()).toBe(before); expect(network).not.toHaveBeenCalled();
  });
  it('keeps attachments with their own conversation, can replace/remove, and allows media without text', async () => {
    const user = userEvent.setup(); view(<WhatsAppConversations />); await open(user);
    await user.upload(screen.getByLabelText('Archivo adjunto'), file()); await screen.findByLabelText('Adjunto archivo.image');
    await open(user, 'Repuestos Horizonte DEMO'); expect(screen.queryByLabelText('Adjunto archivo.image')).not.toBeInTheDocument();
    await open(user); expect(screen.getByLabelText('Adjunto archivo.image')).toBeVisible();
    await user.upload(screen.getByLabelText('Archivo adjunto'), file('audio', 'voz.mp3')); await screen.findByLabelText('Adjunto voz.mp3');
    await user.click(screen.getByRole('button', { name: 'Retirar adjunto' })); expect(screen.queryByLabelText('Adjunto voz.mp3')).not.toBeInTheDocument();
    await user.upload(screen.getByLabelText('Archivo adjunto'), file('video', 'video.mp4')); await screen.findByLabelText('Adjunto video.mp4');
    await user.click(screen.getByRole('button', { name: 'Simular envío del mensaje' }));
    await screen.findByText('Mensaje multimedia simulado preparado correctamente. Ningún archivo fue enviado ni entregado realmente.');
    expect(simulationData().messages.at(-1).content).toBe(''); expect(simulationData().messages.at(-1).attachment.type).toBe('video'); expect(network).not.toHaveBeenCalled();
  });
  it('rejects MIME, size, empty files and read failures without losing the draft or previous attachment', async () => {
    expect(() => validateMediaFile(new File(['x'], 'x.svg', { type: 'image/svg+xml' }))).toThrow('Tipo de archivo');
    expect(() => validateMediaFile(new File([], 'empty.png', { type: 'image/png' }))).toThrow('vacío');
    expect(() => validateMediaFile({ type: 'image/png', size: MEDIA_LIMITS.image + 1 })).toThrow('límite provisional');
    const user = userEvent.setup({ applyAccept: false }); view(<WhatsAppConversations />); await open(user);
    await user.type(screen.getByLabelText('Redactar mensaje'), 'Borrador importante');
    await user.upload(screen.getByLabelText('Archivo adjunto'), file()); await screen.findByLabelText('Adjunto archivo.image');
    await user.upload(screen.getByLabelText('Archivo adjunto'), new File(['x'], 'x.html', { type: 'text/html' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Tipo de archivo');
    vi.spyOn(FileReader.prototype, 'readAsArrayBuffer').mockImplementation(function () { this.onerror(); });
    await user.upload(screen.getByLabelText('Archivo adjunto'), file('audio'));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo leer');
    expect(screen.getByLabelText('Redactar mensaje')).toHaveValue('Borrador importante'); expect(screen.getByLabelText('Adjunto archivo.image')).toBeVisible(); expect(network).not.toHaveBeenCalled();
  });
  it('clears object URLs on reset/exit and cannot send stale or forged references', async () => {
    const attachment = await temporaryWhatsAppMedia.put(file()); expect(temporaryWhatsAppMedia.get(attachment)).not.toBeNull();
    expect(() => requireMedia({ ...attachment, name: 'otra-identidad' })).toThrow('no está disponible');
    resetSimulation(); expect(temporaryWhatsAppMedia.get(attachment)).toBeNull(); expect(URL.revokeObjectURL).toHaveBeenCalled();
    await expect(sendConversationSimulation('91001', '', attachment)).rejects.toThrow('no está disponible');
    const next = await temporaryWhatsAppMedia.put(file()); leaveSimulation(); expect(temporaryWhatsAppMedia.get(next)).toBeNull(); expect(network).not.toHaveBeenCalled();
  });
  it('blocks persistent media and MOCK media sends before HTTP, while retaining a REAL editor draft', async () => {
    const attachment = await temporaryWhatsAppMedia.put(file()); leaveSimulation();
    await expect(createMessageTemplate({ attachment, content_type: 'image' })).rejects.toThrow('no transporta archivos');
    await expect(sendManualWhatsApp({ customer_id: '1', template_id: '1', attachment })).rejects.toThrow('no transporta archivos');
    network.mockImplementation(config => Promise.resolve({ config, status: 200, headers: {}, data: { success: true, data: { templates: [], stage_catalog: [], variables: [] } } }));
    const user = userEvent.setup(); view(<MessageTemplates />, 'REAL'); const create = await screen.findByRole('button', { name: 'Nueva plantilla' }); await waitFor(() => expect(create).toBeEnabled()); await user.click(create);
    await user.type(screen.getByLabelText('Nombre de plantilla'), 'Borrador REAL'); await user.selectOptions(screen.getByLabelText('Tipo de contenido'), 'image');
    await user.upload(screen.getByLabelText('Archivo adjunto'), file()); await screen.findByLabelText('Adjunto archivo.image');
    await user.click(screen.getByRole('button', { name: 'Crear plantilla' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no transporta archivos'); expect(screen.getByLabelText('Nombre de plantilla')).toHaveValue('Borrador REAL');
    expect(network.mock.calls.every(([config]) => config.method === 'get')).toBe(true);
  });
  it('shows media in the existing manual preview and never claims a real delivery', async () => {
    const attachment = await temporaryWhatsAppMedia.put(file('audio'));
    const template = { id: 'manual-media', name: 'Voz manual', content: '', content_type: 'audio', attachment, status: 'active', channel: 'whatsapp', stage: null };
    simulationData().templates.push(template);
    const user = userEvent.setup(); view(<WhatsAppManualSend templates={[template]} settings={{}} />);
    await screen.findByRole('option', { name: /Distribuciones Andinas DEMO/ });
    await user.selectOptions(screen.getByLabelText('Cliente'), '91001'); await user.selectOptions(screen.getByLabelText('Plantilla'), template.id);
    await screen.findByLabelText('Adjunto archivo.audio'); await user.click(screen.getByRole('button', { name: 'Enviar mensaje por WhatsApp' }));
    expect(await screen.findByText('Mensaje multimedia simulado preparado correctamente. Ningún archivo fue enviado ni entregado realmente.')).toBeVisible();
    expect(simulationData().messages.at(-1).attachment).toEqual(attachment); expect(network).not.toHaveBeenCalled();
  });
  it('discards a read finishing after switching conversations', async () => {
    let finish;
    vi.spyOn(FileReader.prototype, 'readAsArrayBuffer').mockImplementation(function () { finish = () => { Object.defineProperty(this, 'result', { value: new ArrayBuffer(15) }); this.onload(); }; });
    const user = userEvent.setup(); view(<WhatsAppConversations />); await open(user);
    await user.upload(screen.getByLabelText('Archivo adjunto'), file()); await open(user, 'Repuestos Horizonte DEMO'); finish();
    await waitFor(() => expect(screen.queryByLabelText('Adjunto archivo.image')).not.toBeInTheDocument()); expect(network).not.toHaveBeenCalled();
  });
});
