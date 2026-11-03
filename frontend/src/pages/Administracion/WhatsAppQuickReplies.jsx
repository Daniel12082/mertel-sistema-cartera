import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getCollectionMessageTemplates } from '../../services/collectionMessages.service';
import { whatsappRequest } from '../../services/whatsappCenter.service';
import { normalizeCommand, quickReplyCommands, quickReplyToken, previewProblem } from './whatsappQuickReplies.commands';
import './WhatsAppQuickReplies.css';

export default function WhatsAppQuickReplies({ customerId, value, disabled, onChange, onInsert, onPending }) {
  const input = useRef(null), request = useRef(null), currentValue = useRef(value);
  const [catalog, setCatalog] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [caret, setCaret] = useState(0), [focused, setFocused] = useState(false), [dismissed, setDismissed] = useState(false), [index, setIndex] = useState(0);
  const [position, setPosition] = useState(null), [preparing, setPreparing] = useState(false);
  const id = useId();
  const commands = useMemo(() => quickReplyCommands(catalog), [catalog]);
  const token = quickReplyToken(value, caret);
  const query = token?.query || '';
  const options = token ? commands.filter(row => row.command.includes(token.query) || normalizeCommand(row.name).includes(token.query)) : [];
  const open = focused && !disabled && !dismissed && Boolean(token);
  const selectedIndex = Math.min(index, Math.max(0, options.length - 1));

  useEffect(() => { currentValue.current = value; }, [value]);
  useEffect(() => {
    const controller = new AbortController();
    const parts = new Intl.DateTimeFormat('en', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const date = ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-');
    if (customerId) getCollectionMessageTemplates(customerId, date, { signal: controller.signal }).then(rows => {
      if (!controller.signal.aborted) { setCatalog(rows); setError(''); }
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); request.current?.abort(); };
  }, [customerId, retry]);
  useEffect(() => {
    if (!open) return;
    function place() {
      const rect = input.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop || 0, left = viewport?.offsetLeft || 0;
      const width = viewport?.width || window.innerWidth, height = viewport?.height || window.innerHeight;
      const above = rect.top - top - 16, below = top + height - rect.bottom - 16;
      const upward = above >= Math.min(300, below);
      setPosition({ position: 'fixed', left: Math.max(left + 8, Math.min(rect.left, left + width - Math.min(rect.width, width - 16) - 8)),
        width: Math.min(rect.width, width - 16), maxHeight: Math.max(60, Math.min(300, upward ? above : below)),
        ...(upward ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }) });
    }
    place();
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place); window.visualViewport?.addEventListener('scroll', place);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); window.visualViewport?.removeEventListener('resize', place); window.visualViewport?.removeEventListener('scroll', place); };
  }, [open]);
  useEffect(() => { if (open) document.getElementById(`${id}-${selectedIndex}`)?.scrollIntoView({ block: 'nearest' }); }, [id, open, selectedIndex, query]);

  async function select(row) {
    if (!token || preparing) return;
    const original = value, range = token;
    const controller = new AbortController(); request.current?.abort(); request.current = controller;
    setPreparing(true); onPending(true); setError(''); setDismissed(true);
    try {
      const preview = await whatsappRequest('/preview', { method: 'post', body: { customer_id: customerId, template_id: String(row.id) }, signal: controller.signal });
      if (controller.signal.aborted || currentValue.current !== original) return;
      if (!preview || String(preview.customer?.id) !== customerId || String(preview.template?.id) !== String(row.id) || typeof preview.content !== 'string' ||
        !Array.isArray(preview.missing_variables) || !Array.isArray(preview.unsupported_variables) || typeof preview.can_prepare !== 'boolean') throw new Error('La vista previa no corresponde a esta plantilla y cliente.');
      const content = original.slice(0, range.start) + preview.content + original.slice(range.end);
      if (content.length > 16000) throw new Error('El mensaje supera los 16000 caracteres permitidos.');
      onInsert(content, { ...preview, problem: previewProblem(preview) });
      const nextCaret = range.start + preview.content.length;
      setCaret(nextCaret);
      requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(nextCaret, nextCaret); });
    } catch (failure) { if (!controller.signal.aborted) setError(failure.message); }
    finally { if (!controller.signal.aborted) { setPreparing(false); onPending(false); } }
  }
  function change(event) {
    request.current?.abort(); setPreparing(false); onPending(false);
    currentValue.current = event.target.value;
    setCaret(event.target.selectionStart); setDismissed(false); setIndex(0); onChange(event.target.value);
  }
  return <>
    <textarea ref={input} id="wa-conversation-draft" aria-label="Redactar mensaje" aria-haspopup="listbox" aria-expanded={open}
      aria-controls={open ? id : undefined} aria-activedescendant={open && options.length ? `${id}-${selectedIndex}` : undefined}
      placeholder="Escribe un mensaje o / para una plantilla…" maxLength={16000} rows={2} value={value}
      disabled={disabled}
      onChange={change} onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); setDismissed(true); }}
      onSelect={event => setCaret(event.target.selectionStart)}
      onKeyDown={event => {
        if (!open || event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') { event.preventDefault(); setDismissed(true); }
        if (options.length && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setIndex((selectedIndex + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length); }
        if (options.length && event.key === 'Enter') { event.preventDefault(); void select(options[selectedIndex]); }
      }} />
    {preparing && <span role="status" className="wa-quick-feedback">Preparando plantilla…</span>}
    {error && <span role="alert" className="wa-quick-feedback">{error}<button type="button" onClick={() => { setLoading(true); setRetry(number => number + 1); }}>Reintentar plantillas</button></span>}
    {open && position && createPortal(<div className="wa-quick-menu" style={position} onMouseDown={event => event.preventDefault()}>
      <div className="wa-quick-heading">Respuestas rápidas <small>↑ ↓ · Enter · Escape</small></div>
      <div id={id} role="listbox" aria-label="Plantillas de respuesta rápida">{options.map((row, number) => <button key={row.id} id={`${id}-${number}`} role="option" aria-selected={number === selectedIndex} tabIndex={-1} type="button" onClick={() => void select(row)}>
        <strong>{row.name}</strong><code>/{row.command}</code><span>{row.content.replace(/\s+/g, ' ').slice(0, 120)}{row.attachment ? ` · Adjunto ${row.content_type}: ${row.attachment.name}` : ''}</span>
      </button>)}</div>
      {!options.length && <p role="status">{loading ? 'Cargando plantillas…' : error ? 'No se pudieron cargar las plantillas.' : 'No hay plantillas disponibles para este comando y cliente.'}</p>}
    </div>, document.body)}
  </>;
}
