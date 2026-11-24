import { useEffect, useState } from 'react';
import { MERTEL_INVOICE_TEMPLATE } from '../../../../backend/src/services/mertelInvoiceWhatsApp';
import { describeWhatsAppTextTemplate, META_TEST_TEMPLATE_NAME, prepareWhatsAppTextTemplate } from '../../../../backend/src/services/whatsappTextTemplate';
import { whatsappRequest } from '../../services/whatsappCenter.service';

export default function WhatsAppTemplatePicker({ recipient, query, onClose, canUseInvoice, onInvoice, onMessage, canSend=true }) {
  const [templates, setTemplates] = useState(null);
  const [selected, setSelected] = useState(null);
  const [values, setValues] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    whatsappRequest('/meta/templates', { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setTemplates(result.templates.filter(template => template.status === 'APPROVED' && template.name !== META_TEST_TEMPLATE_NAME));
    }).catch(failure => {
      if (!controller.signal.aborted) { setTemplates([]); setError(failure.message); }
    });
    return () => controller.abort();
  }, []);
  const definitions = selected && describeWhatsAppTextTemplate(selected);
  const fields = definitions?.flatMap(component => component.variables.map(variable => ({ type: component.type, variable }))) || [];
  const preview = definitions && prepareWhatsAppTextTemplate(definitions, values);

  async function send(event) {
    event.preventDefault();
    if (busy || !preview || !canSend) return;
    setBusy(true);
    setError('');
    try {
      const { message, accepted } = await whatsappRequest('/meta/templates/send', { method: 'post',
        body: { recipient, name: selected.name, language: selected.language, values } });
      onMessage(message);
      if (accepted) onClose();
      else setError(message.error_message || 'Meta aún no ha confirmado el envío.');
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  return <section className="wa-chat-compose wa-template-picker" aria-label="Plantillas aprobadas de WhatsApp">
    <div className="wa-chat-draft-actions"><strong>Plantillas aprobadas</strong><button type="button" disabled={busy} onClick={onClose}>Cerrar plantillas</button></div>
    {error && <p className="wa-error" role="alert">{error}</p>}
    {!templates && <p role="status">Consultando plantillas en Meta…</p>}
    {templates && !selected && <div className="wa-chat-draft-actions">
      {templates.filter(template => template.name.includes(query)).map(template => {
        const invoiceTemplate = template.name === MERTEL_INVOICE_TEMPLATE;
        const supported = invoiceTemplate ? canUseInvoice : Boolean(describeWhatsAppTextTemplate(template));
        return <button key={`${template.name}:${template.language}`} type="button" disabled={!supported} onClick={() => {
          if (invoiceTemplate) { onInvoice(); return; }
          setError('');
          setSelected(template);
          setValues(describeWhatsAppTextTemplate(template).flatMap(component => component.variables.map(() => '')));
        }}>{template.name} ({template.language}){supported ? '' : invoiceTemplate ? ' · vincula una factura' : ' · formato no disponible'}</button>;
      })}
      {!templates.some(template => template.name.includes(query)) && <p>No hay plantillas aprobadas que coincidan.</p>}
    </div>}
    {selected && <form onSubmit={send}>
      <p><strong>{selected.name} ({selected.language})</strong></p>
      {fields.map(({ type, variable }, index) => <label key={`${type}:${variable}`}>
        {type === 'header' ? 'Encabezado' : 'Mensaje'} · {variable}
        <input required maxLength={1024} disabled={busy} value={values[index]} onChange={event => setValues(current =>
          current.map((value, position) => position === index ? event.target.value : value))} />
      </label>)}
      <p style={{ whiteSpace: 'pre-wrap' }}>{preview?.content || definitions.filter(component => component.type !== 'button').map(component => component.text).join('\n\n')}</p>
      {definitions.filter(component => component.type === 'button').map(({ index, text }) => <p key={index}>{text}</p>)}
      <div className="wa-chat-draft-actions">
        <button type="button" disabled={busy} onClick={() => { setSelected(null); setError(''); }}>Volver a plantillas</button>
        <button type="submit" disabled={busy || !preview || !canSend}>{busy ? 'Enviando…' : 'Enviar plantilla'}</button>
      </div>
    </form>}
  </section>;
}
