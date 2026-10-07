import { randomUUID } from 'node:crypto';

// A real adapter must implement this contract and normalize authenticated webhooks.
// No real adapter is registered in this phase, so no path can perform external IO.
export class WhatsAppProvider {
  async sendMessage() { throw new Error('Provider method not implemented'); }
  async sendTemplateMessage(message) { return this.sendMessage(message); }
  async getConnectionStatus() { throw new Error('Provider method not implemented'); }
  async validateConnection() { throw new Error('Provider method not implemented'); }
  handleIncomingWebhook() { throw new Error('Provider method not implemented'); }
  handleDeliveryStatus() { throw new Error('Provider method not implemented'); }
}

export function normalizePhone(value) {
  if (typeof value !== 'string' || !/^[+\d\s()-]{7,30}$/.test(value)) throw new Error('Teléfono inválido.');
  let digits = value.replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('3')) digits = `57${digits}`;
  if (!/^[1-9]\d{7,14}$/.test(digits)) throw new Error('Teléfono inválido.');
  return `+${digits}`;
}

export class MockWhatsAppProvider extends WhatsAppProvider {
  async validateConnection({ fail = false } = {}) { return { status: fail ? 'ERROR' : 'CONNECTED', simulated: true }; }
  async getConnectionStatus() { return { status: 'CONNECTED', simulated: true }; }
  async sendMessage({ fail = false } = {}) {
    return fail ? { status: 'FAILED', error_code: 'MOCK_SEND_FAILED', error_message: 'Fallo de envío simulado.' } :
      { status: 'SENT', provider_message_id: `mock:${randomUUID()}`, simulated: true };
  }
  handleIncomingWebhook(dto) {
    if (!dto || typeof dto.content !== 'string' || !dto.content.trim() || dto.content.length > 16000 ||
        typeof dto.provider_message_id !== 'string' || !/^mock:[\w-]{1,100}$/.test(dto.provider_message_id) ||
        typeof dto.received_at !== 'string' || !Number.isFinite(Date.parse(dto.received_at))) throw new Error('Mensaje entrante inválido.');
    return { direction: 'inbound', provider: 'MOCK', phone: normalizePhone(dto.phone),
      content: dto.content, received_at: new Date(dto.received_at), provider_message_id: dto.provider_message_id };
  }
  handleDeliveryStatus(dto) {
    if (!dto || !['DELIVERED', 'READ', 'FAILED'].includes(dto.status)) throw new Error('Estado de entrega inválido.');
    return { status: dto.status, simulated: true };
  }
}

export function whatsappProvider(name) {
  if (name !== 'MOCK') throw new Error('La integración real todavía no está disponible.');
  return new MockWhatsAppProvider();
}
