import { useEffect, useState } from 'react';
import { MERTEL_INVOICE_LANGUAGE, MERTEL_INVOICE_TEMPLATE, isMertelInvoiceTemplate } from '../../../../backend/src/services/mertelInvoiceWhatsApp';
import { whatsappRequest } from '../../services/whatsappCenter.service';

export default function WhatsAppInvoiceNotice({ customerId, invoices, authorized, onMessage }) {
  const [invoiceIds, setInvoiceIds] = useState([]);
  const [template, setTemplate] = useState({ status: '', approved: false });
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!customerId || !open) return;
    const controller = new AbortController();
    whatsappRequest('/meta/templates', { signal: controller.signal }).then(data => {
      if (controller.signal.aborted) return;
      const match = data.templates.find(row => row.name === MERTEL_INVOICE_TEMPLATE && row.language === MERTEL_INVOICE_LANGUAGE);
      setTemplate({ status: match?.status || 'No registrada', approved: Boolean(match && isMertelInvoiceTemplate(match)) });
    }).catch(() => {
      if (!controller.signal.aborted) setTemplate({ status: 'Sin conexión para consultar', approved: false });
    });
    return () => controller.abort();
  }, [customerId, open]);

  async function request(send) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const body = { customer_id: customerId, invoice_ids: invoiceIds };
      if (send) body.preview_token = preview.preview_token;
      const result = await whatsappRequest('/meta/invoice-notices', { method: 'post', body });
      if (!send) setPreview(result);
      else {
        onMessage(result.message);
        setPreview(null);
        if (result.accepted) setInvoiceIds([]);
        else setError(result.message.error_message || 'El aviso quedó pendiente. Consulta el historial.');
      }
    } catch (failure) {
      if (send) setPreview(null);
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return <details className="wa-chat-compose" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Enviar aviso de facturas</summary>
    {!customerId ? <p>Selecciona una conversación vinculada al cliente para consultar sus facturas.</p> : <>
      <p>Estado en Meta: {({ PENDING: 'Pendiente', APPROVED: 'Aprobada', REJECTED: 'Rechazada' })[template.status] || template.status || 'Consultando…'}</p>
      {!authorized && <p>Registra la autorización del cliente en Configuración → WhatsApp → Timeline.</p>}
      {!invoices.length && <p>No hay facturas pendientes disponibles para este cliente.</p>}
      {invoices.length > 0 && <fieldset disabled={busy}>
        <legend>Facturas pendientes</legend>
        {invoices.map(invoice => {
          const id = String(invoice.invoice_id ?? invoice.id);
          return <label key={id}><input type="checkbox" checked={invoiceIds.includes(id)} onChange={event => {
            setPreview(null);
            setInvoiceIds(current => event.target.checked ? [...current, id] : current.filter(value => value !== id));
          }} /> {invoice.invoice_number}</label>;
        })}
      </fieldset>}
      {error && <p role="alert" className="wa-error">{error}</p>}
      {preview
        ? <><p style={{ whiteSpace: 'pre-wrap' }}>{preview.content}</p><button type="button" disabled={busy || !template.approved || !authorized} onClick={() => request(true)}>Confirmar envío del aviso</button></>
        : <button type="button" disabled={busy || !authorized || !invoiceIds.length} onClick={() => request(false)}>Revisar aviso</button>}
    </>}
  </details>;
}
