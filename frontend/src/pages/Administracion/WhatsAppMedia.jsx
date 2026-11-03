import { useEffect, useRef, useState } from 'react';
import { Paperclip } from 'lucide-react';
import { discardDraftMedia, mediaAccept, mediaSize, MEDIA_LIMITS, MEDIA_TYPES, temporaryWhatsAppMedia } from '../../services/whatsappMedia.service';
import './WhatsAppMedia.css';

export function WhatsAppMediaPreview({ attachment }) {
  const [failed, setFailed] = useState(false);
  const row = temporaryWhatsAppMedia.get(attachment);
  if (!attachment) return null;
  return <figure className="wa-media-preview" aria-label={`Adjunto ${attachment.name}`}>
    {!row || failed ? <p role="alert">No se pudo previsualizar el adjunto. Retíralo y selecciona un archivo compatible.</p> :
      attachment.type === 'image' ? <img src={row.url} alt={`Vista previa de ${attachment.name}`} onError={() => setFailed(true)} /> :
        attachment.type === 'video' ? <video src={row.url} controls preload="metadata" onError={() => setFailed(true)} aria-label={`Video ${attachment.name}`} /> :
          <audio src={row.url} controls preload="metadata" onError={() => setFailed(true)} aria-label={`Audio ${attachment.name}`} />}
    <figcaption><strong>{attachment.name}</strong><span>{MEDIA_TYPES[attachment.type]} · {attachment.mime} · {mediaSize(attachment.size)}</span><small>Adjunto temporal · sin entrega real · plantilla Meta sin vincular</small></figcaption>
  </figure>;
}

export function WhatsAppAttachmentPicker({ value, onChange, type, disabled, onPending, showPreview = true }) {
  const input = useRef(null), generation = useRef(0), mounted = useRef(true);
  const [error, setError] = useState(''), [reading, setReading] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function pick(event) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    const request = ++generation.current;
    setReading(true); setError(''); onPending?.(true);
    try {
      const attachment = await temporaryWhatsAppMedia.put(file, type);
      if (!mounted.current || request !== generation.current) { temporaryWhatsAppMedia.remove(attachment); return; }
      onChange(attachment); discardDraftMedia(value);
    } catch (failure) { if (mounted.current && request === generation.current) setError(failure.message); }
    finally { if (mounted.current && request === generation.current) { setReading(false); onPending?.(false); } }
  }
  return <section className="wa-media-picker" aria-label="Adjuntos del mensaje">
    <input ref={input} type="file" aria-label="Archivo adjunto" accept={mediaAccept(type)} hidden disabled={disabled || reading} onChange={pick} />
    <button type="button" title={type === 'text' ? 'Selecciona Imagen, Video o Audio para adjuntar' : 'Seleccionar archivo del dispositivo'} disabled={disabled || reading} onClick={() => input.current?.click()}><Paperclip size={16} aria-hidden="true" />{reading ? 'Leyendo archivo…' : value ? 'Reemplazar adjunto' : 'Adjuntar archivo'}</button>
    {value && <>{showPreview ? <WhatsAppMediaPreview key={value.id} attachment={value} /> : <span className="wa-media-file-summary">{value.name} · {mediaSize(value.size)}</span>}<button type="button" disabled={disabled || reading} onClick={() => { onChange(null); discardDraftMedia(value); setError(''); }}>Retirar adjunto</button></>}
    <details className="wa-media-limits"><summary>Límites provisionales</summary><small>Imagen {mediaSize(MEDIA_LIMITS.image)}, video {mediaSize(MEDIA_LIMITS.video)}, audio {mediaSize(MEDIA_LIMITS.audio)}. Pendientes de validar con el proveedor real.</small></details>
    {error && <p role="alert">{error}</p>}
  </section>;
}
