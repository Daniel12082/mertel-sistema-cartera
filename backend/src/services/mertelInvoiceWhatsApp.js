import { operationError } from './collectionOperations.validation.js';
import { moneyCents } from './collectionMoney.js';
import { dateDay, dateFromDay } from './promptPayment.service.js';

export const MERTEL_INVOICE_TEMPLATE = 'mertel_recordatorio_facturas';
export const MERTEL_INVOICE_LANGUAGE = 'es';
export const MERTEL_INVOICE_BODY = [
  'Hola, {{1}}. Te saluda Marjori de MERTEL IMPORTACIONES S.A.S.',
  'Tienes facturas pendientes que debes programar para pago: {{2}}.',
  'Recuerda validar las condiciones del 3% por pronto pago y del 10% condicionado según la fecha de cada factura.',
  'Para dudas, devoluciones o condiciones de negociación, comunícate al +57 318 345 6887.'
].join('\n\n');

const clean = value => String(value ?? '').trim().replace(/\s+/g, ' ');
const normalized = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
const promo18 = invoice => ['SI', 'YES', 'TRUE'].includes(normalized(invoice.promo_18)) ||
  /^\d+(\.\d+)?$/.test(normalized(invoice.promo_18)) && moneyCents(invoice.promo_18) > 0n ||
  /PROMO\s*18\s*[:=]\s*SI\b/i.test(invoice.notes || '');
const conditioned = invoice => normalized(invoice.discount_condition ?? invoice.discount) === 'CONDICIONADO' ||
  /DSCTO\s*[:=]\s*CONDICIONADO\b/i.test(invoice.notes || '');

function reminderLines(invoices, referenceDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate || '')) return [];
  const promptDeadlines = invoices.filter(invoice => invoice.issue_date && !promo18(invoice) && dateDay(referenceDate) <= dateDay(invoice.issue_date) + 10)
    .map(invoice => dateFromDay(dateDay(invoice.issue_date) + 10));
  const conditionedDeadlines = invoices.filter(invoice => invoice.issue_date && conditioned(invoice) && dateDay(referenceDate) <= dateDay(invoice.issue_date) + 60)
    .map(invoice => dateFromDay(dateDay(invoice.issue_date) + 60));
  const lines = [];
  if (promptDeadlines.length) lines.push(`Recordatorio: el 3% por pronto pago puede aplicar hasta el ${[...promptDeadlines].sort()[0]}, sujeto a validación comercial.`);
  if (conditionedDeadlines.length) lines.push(`Recordatorio: el 10% condicionado puede aplicar hasta el ${[...conditionedDeadlines].sort()[0]}, sujeto a las condiciones de negociación.`);
  return lines;
}

export function invoiceNoticeParts(invoices, referenceDate) {
  const documents = invoices.map(invoice => {
    const issue = invoice.issue_date ? ` · emisión ${invoice.issue_date}` : '';
    const due = invoice.due_date ? ` · vence ${invoice.due_date}` : '';
    const observation = clean(invoice.notes);
    return `Factura ${clean(invoice.invoice_number)}${issue}${due}${observation ? ` · Observación: ${observation}` : ''}`;
  });
  return { documents: documents.join('\n'), reminders: reminderLines(invoices, referenceDate).join('\n') || 'Sin descuentos calculados. Las condiciones comerciales se validan antes de aplicar cualquier beneficio.' };
}

export function isMertelInvoiceTemplate(template) {
  return template.name === MERTEL_INVOICE_TEMPLATE && template.language === MERTEL_INVOICE_LANGUAGE &&
    template.status === 'APPROVED' && template.category === 'UTILITY' &&
    template.components.length === 1 && template.components[0].type === 'BODY' &&
    template.components[0].text === MERTEL_INVOICE_BODY;
}

export function buildMertelInvoiceMessage(customer, invoices, { referenceDate, contactPhone } = {}) {
  if (!invoices.length || invoices.some(invoice => moneyCents(invoice.balance) <= 0n)) throw operationError(409, 'Las facturas seleccionadas deben tener saldo pendiente.');
  const contact = clean(contactPhone);
  if (!contact) throw operationError(409, 'Configura el número de contacto de cobranza antes de preparar el mensaje.');
  const parts = invoiceNoticeParts(invoices, referenceDate);
  const values = [clean(customer.name), parts.documents];
  const content = MERTEL_INVOICE_BODY.replace(/\{\{([1-2])\}\}/g, (_, index) => values[Number(index) - 1]);
  if (values.some(value => !value || value.length > 1024) || content.length > 1024) throw operationError(409, 'El aviso excede el espacio de la plantilla de WhatsApp. Reduce la cantidad de facturas antes de enviarlo.');
  return { content, template: { name: MERTEL_INVOICE_TEMPLATE, language: MERTEL_INVOICE_LANGUAGE,
    components: [{ type: 'body', parameters: values.map(text => ({ type: 'text', text })) }] } };
}
