import { useEffect, useState } from 'react';
import { whatsappRequest } from '../../services/whatsappCenter.service';
import { conversationMessageStatus } from './whatsappConversation.presentation';

const time = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', timeStyle: 'short' });

export default function WhatsAppAutomaticSendsToday({ stages }) {
  const [request, setRequest] = useState({ page: 1 });
  const [result, setResult] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    whatsappRequest('/messages', { params: { automatic_sent_today: 'true', page: request.page }, signal: controller.signal })
      .then(data => {
        if (!Array.isArray(data?.messages) || !data.sent_date) throw new Error('Respuesta de envíos inválida.');
        if (!controller.signal.aborted) setResult({ request, data });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ request, error: true });
      });
    return () => controller.abort();
  }, [request]);
  const current = result?.request === request ? result : null;
  const data = current?.data;
  return <article className="wa-card" aria-busy={!current}>
    <h2>Enviados automáticamente hoy</h2>
    <p>Avisos automáticos aceptados por Meta{data && <> el <time dateTime={data.sent_date}>{data.sent_date}</time></>}, en horario de Bogotá.</p>
    <button type="button" disabled={!current} onClick={() => setRequest({ page: 1 })}>Actualizar envíos de hoy</button>
    {!current && <p role="status">Consultando envíos…</p>}
    {current?.error && <p className="wa-error" role="alert">No se pudieron consultar los envíos automáticos de hoy.</p>}
    {data && !data.messages.length && <p>No se han enviado avisos automáticos hoy.</p>}
    {data?.messages.length > 0 && <div className="wa-table">
      <table>
        <thead><tr><th>Hora de envío</th><th>Destinatario</th><th>Etapa</th><th>Mensaje</th><th>Estado</th></tr></thead>
        <tbody>{data.messages.map(message => <tr key={message.id}>
          <td><time dateTime={message.sent_at}>{time.format(new Date(message.sent_at))}</time></td>
          <td>{message.customer_name && <><strong>{message.customer_name}</strong><br /></>}{message.recipient}</td>
          <td>{stages.find(stage => stage.key === message.stage)?.label || message.stage || '—'}</td>
          <td className="wa-content">{message.content}</td>
          <td>{conversationMessageStatus(message)}{message.status === 'FAILED' && message.error_message && <p>{message.error_message}</p>}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    {data && (data.page > 1 || data.has_next) && <div className="wa-actions">
      <button type="button" disabled={data.page <= 1} onClick={() => setRequest({ page: data.page - 1 })}>Anterior</button>
      <span>Página {data.page}</span>
      <button type="button" disabled={!data.has_next} onClick={() => setRequest({ page: data.page + 1 })}>Siguiente</button>
    </div>}
  </article>;
}
