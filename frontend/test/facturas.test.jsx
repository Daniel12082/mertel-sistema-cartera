import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import Facturas from '../src/pages/Factura/Facturas';
import * as api from '../src/services/invoice.service';

vi.mock('../src/auth/useAuth', () => ({ useAuth: () => ({ permissions: ['invoices.update', 'payments.create', 'payment_allocations.create'] }) }));
vi.mock('../src/simulation/useAppDataMode', () => ({ useAppDataMode: () => ({ mode: 'REAL' }) }));
vi.mock('../src/services/invoice.service', () => ({ getInvoices: vi.fn(), getInvoiceById: vi.fn(), getInvoiceHistory: vi.fn(), markInvoicePaid: vi.fn(), createInvoice: vi.fn(), updateInvoice: vi.fn(), deleteInvoice: vi.fn(), voidInvoice: vi.fn() }));
const invoice = { id: 1, invoice_number: 'ME-100', customer_name: 'Cliente', status: 'pending', document_value: '100.00', balance: '64.75' };
beforeEach(() => {
  vi.clearAllMocks();
  api.getInvoices.mockResolvedValue({ data: [invoice] });
  api.markInvoicePaid.mockResolvedValue({ data: { ...invoice, status: 'paid', balance: '0.00' } });
  api.getInvoiceById.mockResolvedValue({ data: { ...invoice, status: 'paid', balance: '0.00' } });
  api.getInvoiceHistory.mockResolvedValue({ data: [{ id: '2', action: 'invoice_marked_paid', actor: 'Marjori Mertel', occurred_at: '2026-11-19T12:30:45Z' }] });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
it('marks paid directly from the list, shows paid status and removes the quick action', async () => {
  render(<Facturas />);
  fireEvent.click(await screen.findByRole('button', { name: 'Marcar pagada factura ME-100' }));
  await waitFor(() => expect(api.markInvoicePaid).toHaveBeenCalledWith(1));
  expect(await screen.findByText('Pagada', { selector: 'span' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Marcar pagada factura ME-100' })).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Ya no se incluirá en cobros automáticos');
});
it('shows who marked paid and the full date and time in Bogotá inside invoice detail', async () => {
  render(<Facturas />);
  fireEvent.click(await screen.findByRole('button', { name: 'Ver factura ME-100' }));
  expect(await screen.findByText('Marcada como pagada')).toBeVisible();
  expect(screen.getByText('Marjori Mertel')).toBeVisible();
  const time = screen.getByText(/7:30:45/);
  expect(time).toHaveAttribute('datetime', '2026-11-19T12:30:45Z');
  expect(time).toHaveTextContent('Bogotá');
});
it('cancelling does not register a payment and a failed request leaves the invoice pending', async () => {
  window.confirm.mockReturnValueOnce(false);
  render(<Facturas />);
  const button = await screen.findByRole('button', { name: 'Marcar pagada factura ME-100' });
  fireEvent.click(button); expect(api.markInvoicePaid).not.toHaveBeenCalled();
  api.markInvoicePaid.mockRejectedValueOnce({ response: { status: 500, data: { message: 'No se pudo guardar el pago' } } });
  fireEvent.click(button);
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo guardar el pago');
  expect(screen.getByRole('button', { name: 'Marcar pagada factura ME-100' })).toBeEnabled();
});
