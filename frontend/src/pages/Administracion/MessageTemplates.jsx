import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleAlert, LoaderCircle, MessageSquareText, Pencil, Plus, RefreshCw, Search, ToggleLeft, ToggleRight, X } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { createMessageTemplate, getAdminCompanies, getMessageTemplateAdminData, setMessageTemplateActive, updateMessageTemplate } from "../../services/messageTemplatesAdmin.service";
import "./MessageTemplates.css";

const blankForm = () => ({ name: "", channel: "whatsapp", content: "", stage: "", status: "inactive" });
const formatDate = value => value ? new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
function previewTemplate(content, variables) {
  const examples = new Map(variables.map(item => [item.name, item.example]));
  return content.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (token, key) => examples.get(key.trim()) ?? token);
}
function validateForm(form, variables) {
  if (!form.name.trim()) return "Escribe el nombre de la plantilla.";
  if (!form.content.trim()) return "Escribe el contenido del mensaje.";
  const names = new Set(variables.map(item => item.name));
  const matches = [...form.content.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)];
  const unsupported = matches.find(match => !names.has(match[1].trim()));
  if (unsupported) return `La variable {{${unsupported[1].trim()}}} no está en el catálogo.`;
  if (/[{}]/.test(form.content.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, ""))) return "Hay llaves o variables mal formadas.";
  if (!["active", "inactive"].includes(form.status)) return "Selecciona un estado válido.";
  return "";
}

export default function MessageTemplates() {
  const { user, permissions = [] } = useAuth();
  const authorized = permissions.includes("message_templates.manage");
  const globalAdmin = user?.is_global_admin === true;
  const [companies, setCompanies] = useState([]);
  const [companyId, setCompanyId] = useState("");
  const [companyLoading, setCompanyLoading] = useState(false);
  const [state, setState] = useState({ loading: true, saving: false, error: "", data: null });
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [form, setForm] = useState(null);
  const [editing, setEditing] = useState(null);
  const [formError, setFormError] = useState("");
  const [changingId, setChangingId] = useState("");
  const [actionError, setActionError] = useState("");
  const textarea = useRef(null);
  const data = state.data;
  const variables = data?.variables ?? [];
  const stages = data?.stage_catalog ?? [];
  const templates = useMemo(() => data?.templates ?? [], [data]);
  const companyConfig = useMemo(() => globalAdmin && companyId ? { companyId } : {}, [globalAdmin, companyId]);

  useEffect(() => {
    if (!authorized || !globalAdmin) return undefined;
    const controller = new AbortController();
    setCompanyLoading(true);
    getAdminCompanies({ signal: controller.signal }).then(rows => {
      if (controller.signal.aborted) return;
      const active = rows.filter(company => company.status === "active");
      setCompanies(active);
      setCompanyId(current => active.some(company => company.id === current) ? current : active[0]?.id ?? "");
      if (!active.length) setCompanyLoading(false);
    }).catch(error => {
      if (!controller.signal.aborted) { setCompanies([]); setCompanyLoading(false); setActionError(error.message); }
    }).finally(() => { if (!controller.signal.aborted) setCompanyLoading(false); });
    return () => controller.abort();
  }, [authorized, globalAdmin]);

  useEffect(() => {
    if (!authorized || globalAdmin && !companyId) {
      setState({ loading: false, saving: false, error: "", data: null });
      return undefined;
    }
    const controller = new AbortController();
    setState(current => ({ ...current, loading: true, error: "" }));
    getMessageTemplateAdminData({ ...companyConfig, signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setState({ loading: false, saving: false, error: "", data: result });
    }).catch(error => {
      if (!controller.signal.aborted) setState({ loading: false, saving: false, error: error.message, data: null });
    });
    return () => controller.abort();
  }, [authorized, globalAdmin, companyId, companyConfig]);

  const filteredTemplates = useMemo(() => {
    const normalized = query.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return templates.filter(template => (statusFilter === "all" || template.status === statusFilter) &&
      [template.name, template.channel, template.stage].some(value => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(normalized)));
  }, [templates, query, statusFilter]);

  function beginCreate() { setEditing(null); setForm(blankForm()); setFormError(""); }
  function beginEdit(template) {
    setEditing(template); setForm({ name: template.name, channel: template.channel, content: template.content, stage: template.stage ?? "", status: template.status }); setFormError("");
  }
  function cancelEdit() { setForm(null); setEditing(null); setFormError(""); }
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
    if (globalAdmin && !companyId) return;
    setState(current => ({ ...current, loading: true, error: "" }));
    try { const result = await getMessageTemplateAdminData(companyConfig); setState({ loading: false, saving: false, error: "", data: result }); }
    catch (error) { setState(current => ({ ...current, loading: false, error: error.message })); }
  }
  async function save(event) {
    event.preventDefault();
    const error = validateForm(form, variables);
    if (error) { setFormError(error); return; }
    setState(current => ({ ...current, saving: true })); setFormError("");
    const payload = { name: form.name, channel: form.channel, content: form.content, stage: form.stage || null };
    try {
      if (editing) await updateMessageTemplate(editing.id, payload, companyConfig);
      else await createMessageTemplate({ ...payload, status: form.status }, companyConfig);
      cancelEdit(); await refresh();
    } catch (failure) { setFormError(failure.message); setState(current => ({ ...current, saving: false })); }
  }
  async function toggle(template) {
    const active = template.status !== "active";
    const verb = active ? "activar" : "desactivar";
    if (!window.confirm(`¿Deseas ${verb} la plantilla «${template.name}»?`)) return;
    setChangingId(template.id); setActionError("");
    try { await setMessageTemplateActive(template.id, active, companyConfig); await refresh(); }
    catch (error) { setActionError(error.message); }
    finally { setChangingId(""); }
  }

  if (!authorized) return <section className="template-admin-page"><h1>Administración · Plantillas WhatsApp</h1><p role="alert">No tienes permiso para administrar las plantillas.</p></section>;
  return <section className="template-admin-page">
    <header className="template-admin-header"><div><span className="template-admin-eyebrow"><MessageSquareText size={16} /> Administración de MERTEL</span><h1>Plantillas WhatsApp</h1><p>Administra los mensajes que el equipo utilizará al preparar una comunicación desde Cobranza. Aquí no se envían mensajes.</p></div>
      {!form && <button className="template-primary" onClick={beginCreate} disabled={state.loading || globalAdmin && !companyId}><Plus size={17} /> Nueva plantilla</button>}</header>
    {globalAdmin && <label className="template-company-picker">Empresa autorizada<select aria-label="Empresa" value={companyId} onChange={event => setCompanyId(event.target.value)} disabled={companyLoading || !companies.length}><option value="">{companyLoading ? "Cargando empresas…" : "Selecciona una empresa"}</option>{companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>}
    {actionError && <div className="template-alert" role="alert"><CircleAlert size={17} />{actionError}<button aria-label="Cerrar error" onClick={() => setActionError("")}><X size={16} /></button></div>}
    {globalAdmin && !companyId ? <div className="template-empty"><MessageSquareText size={28} /><h2>{companies.length ? "Selecciona una empresa" : companyLoading ? "Cargando empresas…" : "No hay empresas activas"}</h2><p>{companies.length ? "El administrador global debe elegir el alcance antes de consultar plantillas." : "No se encontraron empresas activas para administrar."}</p></div> : null}
    {form && <form className="template-editor" onSubmit={save} noValidate>
      <div className="template-editor-heading"><div><span>{editing ? "Editar" : "Crear"}</span><h2>{editing ? editing.name : "Nueva plantilla"}</h2></div><button type="button" aria-label="Cancelar edición" className="template-icon-button" onClick={cancelEdit}><X size={19} /></button></div>
      <div className="template-form-grid"><label>Nombre de plantilla<input aria-label="Nombre de plantilla" maxLength={150} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
        <label>Canal<select aria-label="Canal" value={form.channel} onChange={event => setForm({ ...form, channel: event.target.value })}><option value="whatsapp">WhatsApp</option></select></label>
        <label>Etapa de cobranza<select aria-label="Etapa de cobranza" value={form.stage} onChange={event => setForm({ ...form, stage: event.target.value })}><option value="">General · cualquier etapa</option>{stages.map(stage => <option key={stage.key} value={stage.key}>{stage.label}</option>)}{editing?.stage && !stages.some(stage => stage.key === editing.stage) && <option value={editing.stage}>{editing.stage} · etapa no activa</option>}</select></label>
        {!editing && <label>Estado inicial<select aria-label="Estado inicial" value={form.status} onChange={event => setForm({ ...form, status: event.target.value })}><option value="inactive">Inactiva</option><option value="active">Activa</option></select></label>}
      </div>
      <label className="template-content-label">Contenido<textarea ref={textarea} aria-label="Contenido de plantilla" rows={6} maxLength={65535} value={form.content} onChange={event => setForm({ ...form, content: event.target.value })} placeholder="Hola {{nombre_cliente}}, le recordamos que su factura {{numero_factura}} presenta un saldo pendiente de {{saldo_pendiente}}." /></label>
      <fieldset className="template-variable-catalog"><legend>Variables disponibles · selecciona para insertarla</legend><div>{variables.map(variable => <button type="button" key={variable.name} aria-label={`Insertar {{${variable.name}}}`} title={`${variable.label} · Fuente: ${variable.source}`} onClick={() => insertVariable(variable)}><span>{variable.label}</span><code>{`{{${variable.name}}}`}</code>{variable.legacy && <small>Compatibilidad</small>}</button>)}</div><p>Las variables se reemplazan como texto literal usando datos disponibles en Cobranza. El mensaje no ejecuta código.</p></fieldset>
      <section className="template-preview" aria-label="Vista previa con ejemplos"><div><span>VISTA PREVIA</span><small>Datos de ejemplo ficticios · no se guardan ni se envían</small></div><p>{form.content ? previewTemplate(form.content, variables) : "El contenido de la plantilla aparecerá aquí."}</p></section>
      {formError && <p role="alert" className="template-form-error">{formError}</p>}
      <footer><button type="button" className="template-secondary" onClick={cancelEdit}>Cancelar</button><button className="template-primary" type="submit" disabled={state.saving}>{state.saving ? <LoaderCircle className="template-spin" size={17} /> : <Check size={17} />}{state.saving ? "Guardando…" : editing ? "Guardar cambios" : "Crear plantilla"}</button></footer>
    </form>}
    {!form && !(!companyId && globalAdmin) && <section className="template-list-panel"><div className="template-list-heading"><div><h2>Plantillas registradas</h2><p>Las plantillas inactivas permanecen guardadas y no se ofrecen en Cobranza.</p></div><button className="template-secondary" onClick={refresh} disabled={state.loading}><RefreshCw size={16} /> Actualizar</button></div>
      <div className="template-filters"><label><Search size={17} /><input aria-label="Buscar plantillas" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar por nombre, canal o etapa" /></label><select aria-label="Filtrar por estado" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="all">Todos los estados</option><option value="active">Activas</option><option value="inactive">Inactivas</option></select></div>
      {state.loading ? <div className="template-empty" role="status"><LoaderCircle className="template-spin" size={26} /><h2>Cargando plantillas…</h2></div> : state.error ? <div className="template-empty"><CircleAlert size={27} /><h2>No se pudieron cargar las plantillas</h2><p role="alert">{state.error}</p><button className="template-secondary" onClick={refresh}>Reintentar</button></div> : !templates.length ? <div className="template-empty"><MessageSquareText size={27} /><h2>No hay plantillas WhatsApp configuradas</h2><p>Crea una plantilla para que el equipo pueda utilizarla en Cobranza.</p><button className="template-primary" onClick={beginCreate}><Plus size={17} /> Nueva plantilla</button></div> : !filteredTemplates.length ? <div className="template-empty"><Search size={27} /><h2>No hay resultados</h2><p>Ajusta la búsqueda o el filtro de estado.</p></div> : <div className="template-table-wrap"><table className="template-table"><thead><tr><th>Nombre</th><th>Canal</th><th>Etapa</th><th>Estado</th><th>Actualizada</th><th>Acciones</th></tr></thead><tbody>{filteredTemplates.map(template => <tr key={template.id}><td data-label="Nombre"><strong>{template.name}</strong><small>{template.content}</small></td><td data-label="Canal">{template.channel === "whatsapp" ? "WhatsApp" : template.channel}</td><td data-label="Etapa">{stages.find(stage => stage.key === template.stage)?.label ?? (template.stage || "General")}</td><td data-label="Estado"><span className={`template-status ${template.status === "active" ? "is-active" : "is-inactive"}`}>{template.status === "active" ? "Activa" : "Inactiva"}</span></td><td data-label="Actualizada">{formatDate(template.updated_at)}</td><td data-label="Acciones"><div className="template-actions"><button type="button" className="template-icon-button" aria-label={`Editar ${template.name}`} onClick={() => beginEdit(template)}><Pencil size={17} /></button><button type="button" className="template-icon-button" aria-label={`${template.status === "active" ? "Desactivar" : "Activar"} ${template.name}`} disabled={changingId === template.id} onClick={() => toggle(template)}>{changingId === template.id ? <LoaderCircle className="template-spin" size={18} /> : template.status === "active" ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}</button></div></td></tr>)}</tbody></table></div>}
    </section>}
  </section>;
}
