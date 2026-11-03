import api from './api';
import { simulationSnapshot } from '../simulation/store';
import { requireMedia, MEDIA_UNAVAILABLE } from './whatsappMedia.service';

export async function whatsappRequest(path = '', { method = 'get', body, params, signal } = {}) {
  try {
    const { data } = await api.request({ url: `/admin/whatsapp${path}`, method, data: body, params, signal });
    if (!data.success) throw new Error('Respuesta inválida del centro WhatsApp.');
    return data.data;
  } catch (error) {
    if (error.code === 'ERR_CANCELED') throw error;
    const message = error.response?.data?.message;
    throw new Error(typeof message === 'string' && !/Cannot read|TypeError|undefined/i.test(message) ? message : 'No se pudo completar la operación de WhatsApp.', { cause: error });
  }
}
export async function queueCustomerWhatsApp(customerId, templateId) {
  try {
    const { data } = await api.post(`/whatsapp/customers/${encodeURIComponent(customerId)}/queue`, { template_id: templateId, mode: 'MANUAL' });
    if (!data.success) throw new Error('Respuesta inválida.');
    if (!data.data || !data.data.message || data.data.message.id == null) throw new Error('Respuesta de cola inválida.');
    return data.data;
  } catch (error) { throw new Error(error.response?.data?.message || 'No se pudo preparar la cola WhatsApp.', { cause: error }); }
}

export async function sendMetaTestMessage(content) {
  if (typeof content !== 'string' || !content.trim() || content.length > 4096) throw new Error('Escribe un mensaje de prueba de hasta 4.096 caracteres.');
  const queued = await whatsappRequest('/meta/test-messages', { method: 'post', body: { recipient: '+573173697659', content: content.trim(), confirmed: true } });
  if (!queued?.message?.id) throw new Error('No se pudo preparar el mensaje de prueba.');
  const result = await whatsappRequest(`/meta/test-messages/${encodeURIComponent(queued.message.id)}/send`, { method: 'post', body: { confirmed: true } });
  if (!result?.message || String(result.message.id) !== String(queued.message.id)) throw new Error('No se pudo confirmar el resultado del envío de prueba.');
  if (result.accepted !== true) throw new Error(result.message.error_message || 'Meta rechazó el envío de prueba. Revisa el historial; no se realizará un reintento automático.');
  return result;
}

// One user action, using the existing queue, dispatcher, limits and audit trail.
// In simulation api's adapter handles both requests entirely in memory.
export async function sendManualWhatsApp(body, request = whatsappRequest) {
  const started = simulationSnapshot();
  if (body.attachment) {
    if (started.mode !== 'SIMULATION') throw new Error(MEDIA_UNAVAILABLE);
    requireMedia(body.attachment);
  }
  if (!body.customer_id) throw new Error('Selecciona un cliente para continuar.');
  if (body.simulation_free_text && started.mode !== 'SIMULATION') throw new Error('La redacción libre solo está disponible en Modo Simulación.');
  if (!body.template_id && !body.simulation_free_text) throw new Error('Selecciona una plantilla para continuar.');
  const payload = { ...body, mode: 'MANUAL' }; delete payload.simulation_free_text;
  const response = await request('/queue', { method: 'post', body: payload });
  if (simulationSnapshot().epoch !== started.epoch) throw new Error('La fuente de datos cambió. Revisa el mensaje nuevamente.');
  const queued = response && response.message;
  if (!queued || queued.id == null) throw new Error('No se pudo identificar el mensaje. Revisa el historial antes de reintentar.');
  if (['SENT', 'DELIVERED', 'READ'].includes(queued.status)) return queued;
  if (queued.provider !== 'MOCK') throw new Error('El proveedor de envío todavía no está disponible.');
  const sent = await request(`/messages/${encodeURIComponent(queued.id)}/mock-send`, { method: 'post', body: {} });
  if (!sent || !sent.message || String(sent.message.id) !== String(queued.id)) throw new Error('No se pudo confirmar el resultado. Consulta el historial antes de reintentar.');
  return sent.message;
}

export async function sendConversationSimulation(customerId, content, attachment = null) {
  // This free-text contract is local-only. It is never forwarded to the production queue.
  if (simulationSnapshot().mode !== 'SIMULATION') throw new Error('Activa Modo Simulación para redactar mensajes. Meta todavía no está conectado.');
  if (!customerId) throw new Error('Selecciona un cliente para continuar.');
  if (typeof content !== 'string' || !content.trim() && !attachment || content.length > 16000) throw new Error('Escribe un mensaje de hasta 16.000 caracteres o selecciona un adjunto.');
  if (attachment) requireMedia(attachment);
  const request = await localConversationRequest();
  return sendManualWhatsApp({ customer_id: String(customerId), content: content.trim(), ...(attachment ? { attachment } : {}), mode: 'MANUAL', template_id: null, simulation_free_text: true }, request);
}

export async function associateConversationSimulation(messageIds, customerId) {
  if (simulationSnapshot().mode !== 'SIMULATION') throw new Error('La asociación manual de esta demo requiere Modo Simulación.');
  if (!customerId || !Array.isArray(messageIds) || !messageIds.length) throw new Error('Selecciona un cliente y una conversación.');
  const request = await localConversationRequest();
  return request('/messages/associate-local', { method: 'post', body: { message_ids: messageIds, customer_id: String(customerId) } });
}

async function localConversationRequest() {
  const source = simulationSnapshot();
  const { simulationRequest } = await import('../simulation/adapter');
  return (path, { method, body }) => {
    if (source.mode !== 'SIMULATION' || simulationSnapshot().mode !== 'SIMULATION' || simulationSnapshot().epoch !== source.epoch) throw new Error('La fuente de datos cambió. Abre la conversación nuevamente.');
    // Use the same authorized adapter directly: even a mode switch cannot forward this
    // demonstration-only body to a production HTTP endpoint.
    return simulationRequest({ url: `/admin/whatsapp${path}`, method, data: body }).data;
  };
}
