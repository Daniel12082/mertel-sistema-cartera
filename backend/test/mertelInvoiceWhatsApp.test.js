import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMertelInvoiceMessage, MERTEL_INVOICE_TEMPLATE } from '../src/services/mertelInvoiceWhatsApp.js';

test('adds one validated discount reminder per eligible invoice without calculating amounts', () => {
  const message = buildMertelInvoiceMessage(
    { name: 'Cliente MERTEL' },
    [
      { invoice_number: 'FAC-3', issue_date: '2026-11-03', due_date: '2026-11-30', balance: '100.00', promo_18: '0.00' },
      { invoice_number: 'FAC-10', issue_date: '2026-10-15', due_date: '2026-12-15', balance: '100.00', notes: 'DSCTO = CONDICIONADO' },
      { invoice_number: 'FAC-VENCIDA', issue_date: '2026-09-01', due_date: '2026-10-01', balance: '100.00', promo_18: 'SI' }
    ],
    { referenceDate: '2026-11-11', contactPhone: '+573183456887' }
  );

  assert.equal(message.template.name, MERTEL_INVOICE_TEMPLATE);
  const values = message.template.components[0].parameters.map(parameter => parameter.text);
  assert.equal(values.length, 3);
  assert.match(values[2], /Factura FAC-3: el 3% por pronto pago puede aplicar hasta el 2026-11-13/);
  assert.match(values[2], /Factura FAC-10: el 10% condicionado puede aplicar hasta el 2026-12-14/);
  assert.doesNotMatch(values[2], /FAC-VENCIDA|\$|Total/);
});
