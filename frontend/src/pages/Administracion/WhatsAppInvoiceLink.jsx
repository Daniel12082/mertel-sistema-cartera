import { useState } from 'react';
import { whatsappRequest } from '../../services/whatsappCenter.service';

export default function WhatsAppInvoiceLink({ onLink, busy }) {
  const [number, setNumber] = useState('');
  const [invoice, setInvoice] = useState(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  async function search(event) {
    event.preventDefault();
    if (!number.trim() || searching) return;
    setSearching(true); setError(''); setInvoice(null);
    try { setInvoice(await whatsappRequest('/meta/conversations/invoice', { params: { invoice_number: number.trim() } })); }
    catch (failure) { setError(failure.message); }
    finally { setSearching(false); }
  }
  return <details>
    <summary>Vincular a una factura</summary>
    <form onSubmit={search}>
      <label>Número de factura<input value={number} maxLength={100} disabled={busy || searching}
        onChange={event => { setNumber(event.target.value); setInvoice(null); }} /></label>
      <button type="submit" disabled={busy || searching || !number.trim()}>Buscar factura</button>
    </form>
    {error && <p role="alert" className="wa-error">{error}</p>}
    {invoice && <p>{invoice.invoice_number} · {invoice.customer_name}{' '}
      <button type="button" disabled={busy} onClick={() => onLink(invoice)}>Vincular este número</button></p>}
  </details>;
}
