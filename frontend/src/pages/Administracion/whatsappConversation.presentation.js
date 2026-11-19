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
export function customerConversationKey(customer, phone) {
  return phone && phone !== phoneKey(customer.phone) ? `customer:${customer.id}:phone:${phone}` : `customer:${customer.id}`;
}
export function buildConversations(customers, messages, assignments = null) {
  const rows = customers.map(customer => ({ key: `customer:${customer.id}`, customer, phone: customer.phone, name: customer.name, nit: customer.nit, messages: [], candidates: [] }));
  const byKey = new Map(rows.map(row => [row.key, row]));
  function addLinked(customer, phone) {
    const key = customerConversationKey(customer, phone);
    if (!byKey.has(key)) {
      const row = { key, customer, phone: `+${phone}`, name: customer.name, nit: customer.nit, messages: [], candidates: [] };
      rows.push(row); byKey.set(key, row);
    }
    return key;
  }
  for (const [number, id] of Object.entries(assignments || {})) {
    const customer = customers.find(row => String(row.id) === id);
    if (customer) addLinked(customer, phoneKey(number));
  }
  for (const message of messages) {
    const owner = conversationOwner(message, customers);
    const phone = phoneKey(message.recipient || message.phone);
    const key = owner.customer ? addLinked(owner.customer, assignments && phone) : `unlinked:${phone || message.id}`;
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

export function conversationMessageError(message) {
  if (message.status !== 'FAILED') return '';
  const descriptions = {
    '132018': 'Meta rechazó el formato de los datos de la plantilla.',
    '131058': 'La plantilla hello_world solo se puede enviar desde un número de prueba de Meta.',
    '131047': 'La ventana de respuesta había terminado. Envía una plantilla aprobada para retomar la conversación.',
  };
  return descriptions[message.error_code] || message.error_message || 'El envío falló. Consulta el historial de WhatsApp para ver el detalle.';
}
