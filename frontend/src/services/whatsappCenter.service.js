import api from './api';

export async function whatsappRequest(path = '', { method = 'get', body, params, signal } = {}) {
  try {
    const { data } = await api.request({ url: `/admin/whatsapp${path}`, method, data: body, params, signal });
    if (!data.success) throw new Error('Respuesta inválida del centro WhatsApp.');
    return data.data;
  } catch (error) {
    if (error.code === 'ERR_CANCELED') throw error;
    throw new Error(error.response?.data?.message || 'No se pudo completar la operación de WhatsApp.', { cause: error });
  }
}
export async function queueCustomerWhatsApp(customerId, templateId) {
  try {
    const { data } = await api.post(`/whatsapp/customers/${encodeURIComponent(customerId)}/queue`, { template_id: templateId, mode: 'MANUAL' });
    if (!data.success) throw new Error('Respuesta inválida.');
    return data.data;
  } catch (error) { throw new Error(error.response?.data?.message || 'No se pudo preparar la cola WhatsApp.', { cause: error }); }
}
