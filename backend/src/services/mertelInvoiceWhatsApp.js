import { operationError } from './collectionOperations.validation.js';
import { moneyCents } from './collectionMoney.js';

export const MERTEL_INVOICE_TEMPLATE = 'mertel_estado_facturas';
export const MERTEL_INVOICE_LANGUAGE = 'es';
export const MERTEL_INVOICE_BODY = [
  'Hola, {{1}}. Te saluda Marjori de MERTEL IMPORTACIONES S.A.S.',
  'Te compartimos el estado de tus facturas para que puedas programar el pago.',
  'Detalle de facturas: {{2}}\nTotal a pagar: {{3}} COP.',
  'Por favor, confírmanos la fecha en la que tienes previsto realizar el pago. Si ya pagaste o tienes alguna diferencia en el saldo, responde a este mensaje para que la revisemos. Gracias.',
].join('\n\n');

const formatPesos = cents => '$' + new Intl.NumberFormat('es-CO').format(cents / 100n) +
  (cents % 100n ? ',' + String(cents % 100n).padStart(2, '0') : '');
const clean = value => String(value ?? '').trim().replace(/\s+/g, ' ');

export function isMertelInvoiceTemplate(template) {
  return template.name === MERTEL_INVOICE_TEMPLATE && template.language === MERTEL_INVOICE_LANGUAGE &&
    template.status === 'APPROVED' && template.category === 'UTILITY' &&
    template.components.length === 1 && template.components[0].type === 'BODY' &&
    template.components[0].text === MERTEL_INVOICE_BODY;
}

export function buildMertelInvoiceMessage(customer, invoices, promptPayment) {
  const balance = invoices.reduce((total, invoice) => total + moneyCents(invoice.balance), 0n);
  if (!balance) throw operationError(409, 'Las facturas seleccionadas ya no tienen saldo pendiente.');
  const detail = invoices.map(invoice => {
    const due = invoice.due_date ? ` (vence ${invoice.due_date})` : '';
    return `${clean(invoice.invoice_number)}: ${formatPesos(moneyCents(invoice.balance))}${due}`;
  });
  if (promptPayment) detail.push(`Descuento por pronto pago de ${promptPayment.descuento_pronto_pago} hasta el ${promptPayment.expires_on}`);
  const values = [clean(customer.name), detail.join('; '), promptPayment?.total_pronto_pago ?? formatPesos(balance)];
  const content = MERTEL_INVOICE_BODY.replace(/\{\{([123])\}\}/g, (_, index) => values[Number(index) - 1]);
  if (values.some(value => !value || value.length > 1024) || content.length > 1024) {
    throw operationError(409, 'El aviso excede el espacio de la plantilla de WhatsApp. Reduce la cantidad de facturas antes de enviarlo.');
  }
  return { content, template: { name: MERTEL_INVOICE_TEMPLATE, language: MERTEL_INVOICE_LANGUAGE,
    components: [{ type: 'body', parameters: values.map(text => ({ type: 'text', text })) }] } };
}
