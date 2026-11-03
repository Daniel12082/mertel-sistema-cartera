// Identity matching only. No financial or commercial calculations.
export function phoneKey(value) {
  if (typeof value !== 'string' || !/^[+\d\s()-]+$/.test(value)) return '';
  let digits = value.replace(/\D/g, '');
  if (/^3\d{9}$/.test(digits)) digits = `57${digits}`;
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : '';
}
export function conversationOwner(message, customers) {
  if (message.customer_id != null) {
    const linked = customers.find(row => String(row.id) === String(message.customer_id));
    return linked ? { customer: linked, candidates: [], explicit: true } : { customer: null, candidates: [] };
  }
  const phone = phoneKey(message.recipient || message.phone);
  const candidates = phone ? customers.filter(row => phoneKey(row.phone) === phone) : [];
  return { customer: candidates.length === 1 ? candidates[0] : null, candidates, explicit: false };
}
export const messageTime = message => message.received_at || message.sent_at || message.created_at || null;
export function buildConversations(customers, messages) {
  const rows = customers.map(customer => ({ key: `customer:${customer.id}`, customer, phone: customer.phone, name: customer.name, nit: customer.nit, messages: [], candidates: [] }));
  const byKey = new Map(rows.map(row => [row.key, row]));
  for (const message of messages) {
    const owner = conversationOwner(message, customers);
    const key = owner.customer ? `customer:${owner.customer.id}` : `unlinked:${phoneKey(message.recipient || message.phone) || message.id}`;
    if (!byKey.has(key)) {
      const row = { key, customer: null, name: owner.candidates.length > 1 ? 'Asociación ambigua' : 'Conversación sin asociar', phone: message.recipient || message.phone || '', nit: '', candidates: owner.candidates, messages: [] };
      rows.push(row); byKey.set(key, row);
    }
    byKey.get(key).messages.push(message);
  }
  for (const row of rows) {
    row.messages.sort((a, b) => (new Date(messageTime(a)).getTime() || 0) - (new Date(messageTime(b)).getTime() || 0) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
    row.last = row.messages.at(-1) || null;
  }
  return rows.sort((a, b) => (new Date(messageTime(b.last || {})).getTime() || 0) - (new Date(messageTime(a.last || {})).getTime() || 0) || a.name.localeCompare(b.name));
}
export const conversationStatus = { PENDING: 'Pendiente', PROCESSING: 'Procesando', SENT: 'Enviado (MOCK)', DELIVERED: 'Entregado', READ: 'Leído', FAILED: 'Fallido', CANCELLED: 'Cancelado' };

export function conversationMessageStatus(message) {
  if (message?.provider === 'WHATSAPP_CLOUD_API') {
    return { PENDING: 'Pendiente de prueba Meta', PROCESSING: 'Solicitud enviada a Meta', SENT: 'Aceptado por Meta', DELIVERED: 'Entregado', READ: 'Leído', FAILED: 'Fallido', CANCELLED: 'Cancelado' }[message.status] || message.status || 'Sin estado registrado';
  }
  return conversationStatus[message?.status] || message?.status || 'Sin estado registrado';
}
