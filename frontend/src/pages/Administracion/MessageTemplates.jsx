import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleAlert, LoaderCircle, MessageSquareText, Pencil, Plus, RefreshCw, Search, ToggleLeft, ToggleRight, X } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { createMessageTemplate, getMessageTemplateAdminData, setMessageTemplateActive, updateMessageTemplate } from "../../services/messageTemplatesAdmin.service";
import "./MessageTemplates.css";
import { useAppDataMode } from '../../simulation/useAppDataMode';
import { WhatsAppAttachmentPicker, WhatsAppMediaPreview } from './WhatsAppMedia';
import { discardDraftMedia, MEDIA_TYPES, MEDIA_UNAVAILABLE } from '../../services/whatsappMedia.service';

const blankForm = () => ({ name: "", description: "", channel: "whatsapp", content: "", stage: "", status: "inactive", content_type: 'text', attachment: null });
const formatDate = value => value ? new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
function previewTemplate(content, variables) {
  const examples = new Map(variables.map(item => [item.name, item.example]));
  return content.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (token, key) => examples.get(key.trim()) ?? token);
}
function validateForm(form, variables) {
  if (!form.name.trim()) return "Escribe el nombre de la plantilla.";
  if (!form.content.trim() && !form.attachment) return "Escribe el contenido del mensaje o adjunta un archivo.";
  if (form.content_type !== 'text' && !form.attachment) return 'Adjunta el archivo del tipo seleccionado o elige Solo texto.';
  const names = new Set(variables.map(item => item.name));
  const matches = [...form.content.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)];
  const unsupported = matches.find(match => !names.has(match[1].trim()));
  if (unsupported) return `La variable {{${unsupported[1].trim()}}} no está en el catálogo.`;
  if (/[{}]/.test(form.content.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, ""))) return "Hay llaves o variables mal formadas.";
  if (!["active", "inactive"].includes(form.status)) return "Selecciona un estado válido.";
  return "";
}

export default function MessageTemplates() {
  const { mode } = useAppDataMode(); const simulated = mode === 'SIMULATION';
  const { permissions = [] } = useAuth();
  const authorized = permissions.includes("message_templates.manage");
  const [state, setState] = useState({ loading: true, saving: false, error: "", data: null });
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [form, setForm] = useState(null);
  const [editing, setEditing] = useState(null);
  const [formError, setFormError] = useState("");
  const [changingId, setChangingId] = useState("");
  const [actionError, setActionError] = useState("");
  const textarea = useRef(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const ownedMedia = useRef(null);
  useEffect(() => () => { discardDraftMedia(ownedMedia.current); }, []);
  const data = state.data;
  const variables = data?.variables ?? [];
  const stages = data?.stage_catalog ?? [];
  const templates = useMemo(() => data?.templates ?? [], [data]);
  useEffect(() => {
    if (!authorized) {
      setState({ loading: false, saving: false, error: "", data: null });
      return undefined;
    }
    const controller = new AbortController();
    setState(current => ({ ...current, loading: true, error: "" }));
    getMessageTemplateAdminData({ signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setState({ loading: false, saving: false, error: "", data: result });
    }).catch(error => {
      if (!controller.signal.aborted) setState({ loading: false, saving: false, error: error.message, data: null });
    });
    return () => controller.abort();
  }, [authorized]);

  const filteredTemplates = useMemo(() => {
    const normalized = query.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return templates.filter(template => (statusFilter === "all" || template.status === statusFilter) &&
      [template.name, template.channel, template.stage].some(value => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(normalized)));
  }, [templates, query, statusFilter]);

  function beginCreate() { setEditing(null); setForm(blankForm()); setFormError(""); }
  function beginEdit(template) {
    setEditing(template); setForm({ name: template.name, description: template.description || "", channel: template.channel, content: template.content, stage: template.stage ?? "", status: template.status, content_type: template.content_type || 'text', attachment: template.attachment || null }); setFormError("");
  }
  function cancelEdit() { discardDraftMedia(ownedMedia.current); ownedMedia.current = null; setMediaBusy(false); setForm(null); setEditing(null); setFormError(""); }
  function changeAttachment(attachment) { ownedMedia.current = attachment; setForm(current => ({ ...current, attachment })); setFormError(''); }
  function insertVariable(variable) {
    const node = textarea.current;
    if (!node) return;
    const start = node.selectionStart ?? form.content.length;
    const end = node.selectionEnd ?? start;
    const token = `{{${variable.name}}}`;
    const content = `${form.content.slice(0, start)}${token}${form.content.slice(end)}`;
    setForm(current => ({ ...current, content }));
    requestAnimationFrame(() => { node.focus(); node.setSelectionRange(start + token.length, start + token.length); });
  }
  async function refresh() {
    setState(current => ({ ...current, loading: true, error: "" }));
    try { const result = await getMessageTemplateAdminData(); setState({ loading: false, saving: false, error: "", data: result }); }
    catch (error) { setState(current => ({ ...current, loading: false, error: error.message })); }
  }
  async function save(event) {
    event.preventDefault();
    if (mediaBusy || state.saving) return;
    if (!simulated && form.content_type !== 'text') { setFormError(MEDIA_UNAVAILABLE); return; }
    const error = validateForm(form, variables);
    if (error) { setFormError(error); return; }
    setState(current => ({ ...current, saving: true })); setFormError("");
    const payload = { name: form.name, channel: form.channel, content: form.content, stage: form.stage || null, ...(form.description || editing?.description ? { description: form.description } : {}) };
    if (form.content_type !== 'text' || editing?.attachment) Object.assign(payload, { content_type: form.content_type, attachment: form.attachment });
    try {
      if (editing) await updateMessageTemplate(editing.id, payload);
      else await createMessageTemplate({ ...payload, status: form.status });
      cancelEdit(); await refresh();
    } catch (failure) { setFormError(failure.message); setState(current => ({ ...current, saving: false })); }
  }
  async function toggle(template) {
    const active = template.status !== "active";
    const verb = active ? "activar" : "desactivar";
    if (!window.confirm(`¿Deseas ${verb} la plantilla «${template.name}»?`)) return;
    setChangingId(template.id); setActionError("");
    try { await setMessageTemplateActive(template.id, active); await refresh(); }
    catch (error) { setActionError(error.message); }
    finally { setChangingId(""); }
  }

  if (!authorized) return <section className="template-admin-page"><h1>Administración · Plantillas WhatsApp</h1><p role="alert">No tienes permiso para administrar las plantillas.</p></section>;
  return <section className="template-admin-page">
    <header className="template-admin-header"><div><span className="template-admin-eyebrow"><MessageSquareText size={16} /> Administración de MERTEL</span><h1>Plantillas WhatsApp</h1><p>Administra los mensajes que el equipo utilizará al preparar una comunicación desde Cobranza. Aquí no se envían mensajes.</p></div>
      {!form && <button className="template-primary" onClick={beginCreate} disabled={state.loading}><Plus size={17} /> Nueva plantilla</button>}</header>
    {actionError && <div className="template-alert" role="alert"><CircleAlert size={17} />{actionError}<button aria-label="Cerrar error" onClick={() => setActionError("")}><X size={16} /></button></div>}
    {form && <form className="template-editor template-whatsapp-editor" aria-label="Editor de plantilla WhatsApp" onSubmit={save} noValidate>
      <div className="template-editor-heading"><div><span>{editing ? 'EDITAR PLANTILLA' : 'NUEVA PLANTILLA'} · WHATSAPP</span><h2>{editing ? editing.name : 'Prepara tu mensaje'}</h2><p>Define el contenido que tu equipo revisará antes de enviar.</p></div><button type="button" aria-label="Cancelar edición" className="template-icon-button" onClick={cancelEdit}><X size={19} /></button></div>
      <div className="template-editor-layout"><div className="template-editor-workspace">
        <section className="template-editor-section" aria-labelledby="template-information-title">
          <div className="template-section-heading"><span className="template-section-number">01</span><div><h3 id="template-information-title">Información de la plantilla</h3><p>Identifica el mensaje y cuándo estará disponible.</p></div></div>
          <div className="template-editor-fields">
            <label className="template-editor-field template-field-wide" htmlFor="template-name"><span>Nombre de plantilla</span><input id="template-name" maxLength={150} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="Por ejemplo, recordatorio de pago" /></label>
            <label className="template-editor-field template-field-wide" htmlFor="template-description"><span>Descripción (opcional)</span><input id="template-description" maxLength={200} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} placeholder="Una nota para que el equipo reconozca esta plantilla" /></label>
            <label className="template-editor-field" htmlFor="template-content-type"><span>Tipo de contenido</span><select id="template-content-type" disabled={mediaBusy || state.saving} value={form.content_type} onChange={event => { discardDraftMedia(ownedMedia.current); ownedMedia.current = null; setForm({ ...form, content_type: event.target.value, attachment: null }); }}>
              {Object.entries(MEDIA_TYPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select></label>
            <label className="template-editor-field" htmlFor="template-stage"><span>Etapa de cobranza</span><select id="template-stage" value={form.stage} onChange={event => setForm({ ...form, stage: event.target.value })}><option value="">General · cualquier etapa</option>{stages.map(stage => <option key={stage.key} value={stage.key}>{stage.label}</option>)}{editing?.stage && !stages.some(stage => stage.key === editing.stage) && <option value={editing.stage}>{editing.stage} · etapa no activa</option>}</select></label>
            <label className="template-editor-field" htmlFor="template-channel"><span>Canal</span><select id="template-channel" value={form.channel} onChange={event => setForm({ ...form, channel: event.target.value })}><option value="whatsapp">WhatsApp</option></select></label>
            {!editing && <label className="template-editor-field" htmlFor="template-status"><span>Estado inicial</span><select id="template-status" value={form.status} onChange={event => setForm({ ...form, status: event.target.value })}><option value="inactive">Inactiva</option><option value="active">Activa</option></select></label>}
          </div>
        </section>
        <section className="template-editor-section" aria-labelledby="template-message-title">
          <div className="template-section-heading"><span className="template-section-number">02</span><div><h3 id="template-message-title">Editor del mensaje</h3><p>Escribe el texto e inserta las variables que necesitas.</p></div></div>
          <div className="template-message-composer">
            <label className="template-editor-field" htmlFor="template-message"><span>Contenido de plantilla</span><textarea id="template-message" ref={textarea} rows={7} maxLength={65535} value={form.content} onChange={event => setForm({ ...form, content: event.target.value })} placeholder="Hola {{nombre_cliente}}, le recordamos que su factura {{numero_factura}} presenta un saldo pendiente de {{saldo_pendiente}}." /></label>
            <div className="template-composer-tools"><WhatsAppAttachmentPicker key={form.content_type} type={form.content_type} value={form.attachment} onChange={changeAttachment} onPending={setMediaBusy} showPreview={false} disabled={state.saving || form.content_type === 'text'} />
              {form.content_type === 'text' && <small className="template-editor-hint">Selecciona Imagen, Video o Audio para habilitar el clip.</small>}
            </div>
          </div>
          {form.content_type !== 'text' && <p className="template-media-notice">{simulated ? 'SIMULACIÓN · archivo temporal, sin envío real. Plantilla interna MERTEL; no aprobada por Meta.' : MEDIA_UNAVAILABLE}</p>}
          <fieldset className="template-variable-catalog"><legend>Variables disponibles · selecciona para insertarla</legend><div>{variables.map(variable => <button type="button" key={variable.name} aria-label={`Insertar {{${variable.name}}}`} title={`${variable.label} · Fuente: ${variable.source}`} onClick={() => insertVariable(variable)}><span>{variable.label}</span><code>{`{{${variable.name}}}`}</code>{variable.legacy && <small>Compatibilidad</small>}</button>)}</div><p>Las variables se reemplazan como texto literal usando datos disponibles en Cobranza. El mensaje no ejecuta código.</p></fieldset>
        </section>
      </div><section className="template-editor-preview" aria-label="Vista previa con ejemplos">
        <div className="template-section-heading"><span className="template-section-number">03</span><div><h3>Vista previa</h3><p>Así se verá el contenido de tu plantilla.</p></div></div>
        <div className="template-chat-canvas"><div className="template-chat-header"><span className="template-chat-avatar"><MessageSquareText size={20} aria-hidden="true" /></span><div><strong>Mensaje de WhatsApp</strong><small>Vista previa · sin envío</small></div></div>
          <div className="template-chat-body"><div className="template-chat-bubble">
            {form.attachment && <WhatsAppMediaPreview key={form.attachment.id} attachment={form.attachment} />}
            {form.content ? <p>{previewTemplate(form.content, variables)}</p> : !form.attachment && <p className="template-preview-placeholder">El contenido de la plantilla aparecerá aquí.</p>}
          </div></div>
        </div>
        <p className="template-preview-caption">Datos de ejemplo ficticios · no se guardan ni se envían</p>
      </section></div>
      {formError && <p role="alert" className="template-form-error">{formError}</p>}
      <footer className="template-editor-footer"><span>Solo guardas la plantilla. Aquí no se envían mensajes.</span><div><button type="button" className="template-secondary" onClick={cancelEdit}>Cancelar</button><button className="template-primary" type="submit" disabled={state.saving || mediaBusy}>{state.saving ? <LoaderCircle className="template-spin" size={17} /> : <Check size={17} />}{state.saving ? "Guardando…" : editing ? "Guardar cambios" : "Crear plantilla"}</button></div></footer>
    </form>}
    {!form && <section className="template-list-panel"><div className="template-list-heading"><div><h2>Plantillas registradas</h2><p>Las plantillas inactivas permanecen guardadas y no se ofrecen en Cobranza.</p></div><button className="template-secondary" onClick={refresh} disabled={state.loading}><RefreshCw size={16} /> Actualizar</button></div>
      <div className="template-filters"><label><Search size={17} /><input aria-label="Buscar plantillas" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar por nombre, canal o etapa" /></label><select aria-label="Filtrar por estado" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="all">Todos los estados</option><option value="active">Activas</option><option value="inactive">Inactivas</option></select></div>
      {state.loading ? <div className="template-empty" role="status"><LoaderCircle className="template-spin" size={26} /><h2>Cargando plantillas…</h2></div> : state.error ? <div className="template-empty"><CircleAlert size={27} /><h2>No se pudieron cargar las plantillas</h2><p role="alert">{state.error}</p><button className="template-secondary" onClick={refresh}>Reintentar</button></div> : !templates.length ? <div className="template-empty"><MessageSquareText size={27} /><h2>No hay plantillas WhatsApp configuradas</h2><p>Crea una plantilla para que el equipo pueda utilizarla en Cobranza.</p><button className="template-primary" onClick={beginCreate}><Plus size={17} /> Nueva plantilla</button></div> : !filteredTemplates.length ? <div className="template-empty"><Search size={27} /><h2>No hay resultados</h2><p>Ajusta la búsqueda o el filtro de estado.</p></div> : <div className="template-table-wrap"><table className="template-table"><thead><tr><th>Nombre</th><th>Canal</th><th>Etapa</th><th>Estado</th><th>Actualizada</th><th>Acciones</th></tr></thead><tbody>{filteredTemplates.map(template => <tr key={template.id}><td data-label="Nombre"><strong>{template.name}</strong><small>{MEDIA_TYPES[template.content_type || 'text']} · {template.attachment ? 'Con adjunto temporal' : 'Sin adjunto'}</small><small>{template.content}</small></td><td data-label="Canal">{template.channel === "whatsapp" ? "WhatsApp" : template.channel}</td><td data-label="Etapa">{stages.find(stage => stage.key === template.stage)?.label ?? (template.stage || "General")}</td><td data-label="Estado"><span className={`template-status ${template.status === "active" ? "is-active" : "is-inactive"}`}>{template.status === "active" ? "Activa" : "Inactiva"}</span></td><td data-label="Actualizada">{formatDate(template.updated_at)}</td><td data-label="Acciones"><div className="template-actions"><button type="button" className="template-icon-button" aria-label={`Editar ${template.name}`} onClick={() => beginEdit(template)}><Pencil size={17} /></button><button type="button" className="template-icon-button" aria-label={`${template.status === "active" ? "Desactivar" : "Activar"} ${template.name}`} disabled={changingId === template.id} onClick={() => toggle(template)}>{changingId === template.id ? <LoaderCircle className="template-spin" size={18} /> : template.status === "active" ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}</button></div></td></tr>)}</tbody></table></div>}
    </section>}
  </section>;
}
