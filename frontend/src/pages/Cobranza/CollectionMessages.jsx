import { useEffect, useRef, useState } from "react";
import { getCollectionMessageTemplates, previewCollectionMessage, prepareCollectionMessage } from "../../services/collectionMessages.service";
import { useAuth } from "../../auth/useAuth";

export default function CollectionMessages({ customer, companyId, referenceDate, autoOpen = false }) {
  const { permissions = [] } = useAuth();
  const allowed = permissions.includes("collection.manage");
  const [opened, setOpened] = useState(autoOpen);
  const [reload, setReload] = useState(0);
  const [templates, setTemplates] = useState({ loading: autoOpen, rows: [], error: "" });
  const [templateId, setTemplateId] = useState("");
  const [message, setMessage] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const selector = useRef(null);
  const heading = useRef(null);
  const version = useRef(0);
  const busy = useRef(false);
  const activeRequest = useRef(null);
  useEffect(() => () => { version.current++; activeRequest.current?.abort(); }, []);
  useEffect(() => {
    if (!opened || !allowed) return;
    const controller = new AbortController();
    getCollectionMessageTemplates(customer.id, referenceDate, { signal: controller.signal, companyId })
      .then(rows => { if (!controller.signal.aborted) setTemplates({ loading: false, rows, error: "" }); })
      .catch(failure => { if (!controller.signal.aborted) setTemplates({ loading: false, rows: [], error: failure.message }); });
    return () => controller.abort();
  }, [opened, allowed, customer.id, referenceDate, reload, companyId]);
  useEffect(() => { if (opened && !templates.loading) (templates.rows.length ? selector.current : heading.current)?.focus(); }, [opened, templates.loading, templates.rows]);
  function open() {
    version.current++; activeRequest.current?.abort(); busy.current = false;
    setLoading(false); setTemplateId(""); setMessage(null); setError("");
    setTemplates({ loading: true, rows: [], error: "" }); setOpened(true); setReload(value => value + 1);
  }
  function choose(event) { version.current++; activeRequest.current?.abort(); busy.current = false; setLoading(false); setTemplateId(event.target.value); setMessage(null); setError(""); }
  async function generate(prepare = false) {
    if (!allowed || !templateId || busy.current) return;
    const revision = ++version.current;
    const controller = new AbortController(); activeRequest.current = controller; busy.current = true;
    setLoading(true); setError("");
    try {
      const data = await (prepare ? prepareCollectionMessage : previewCollectionMessage)(customer.id, referenceDate, templateId, { signal: controller.signal, companyId });
      if (version.current === revision && !controller.signal.aborted) setMessage(data);
    } catch (failure) { if (version.current === revision && !controller.signal.aborted) { setMessage(null); setError(failure.message); } }
    finally { if (version.current === revision) { busy.current = false; setLoading(false); } }
  }
  const phoneAvailable = typeof customer.phone === "string" && customer.phone.trim().length > 0;
  return <section className="cobranza-whatsapp" id="cobranza-whatsapp" aria-label="WhatsApp del cliente">
    <h3 ref={heading} data-message-start tabIndex={-1}>WhatsApp</h3><p className="cobranza-note">Selecciona una plantilla y prepara el contenido. El envío real todavía no está habilitado.</p>
    <button className="cartera-reset cobranza-whatsapp-button" disabled={!allowed} onClick={open}>Enviar mensaje a WhatsApp</button>
    {!allowed && <p>No tienes permiso para preparar mensajes.</p>}
    {!phoneAvailable && <p role="status">Este cliente no tiene un número de WhatsApp registrado.</p>}
    {opened && allowed && <div className="cobranza-message-panel" aria-label="Selector de mensajes">
      {templates.loading ? <p role="status">Cargando mensajes…</p> : templates.error ? <div role="alert">{templates.error}<button className="cartera-reset" onClick={() => { setTemplates({ loading: true, rows: [], error: "" }); setReload(value => value + 1); }}>Reintentar mensajes</button></div> : !templates.rows.length ? <p role="status">No hay mensajes configurados</p> : <>
        <label>Seleccionar plantilla<select ref={selector} value={templateId} onChange={choose} disabled={loading}><option value="">Selecciona un mensaje</option>{templates.rows.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
        <button className="cartera-reset" disabled={!templateId || loading} onClick={() => generate()}>{loading ? "Preparando vista…" : "Ver vista previa"}</button>
        {error && <p className="cartera-alert" role="alert">{error}</p>}
        {message && <div className="cobranza-message-preview" aria-label="Vista previa del mensaje">
          <h4>{message.prepared ? "Mensaje preparado" : "Vista previa"}</h4>
          <dl><div><dt>Cliente</dt><dd>{message.customer.name?.trim() ? message.customer.name : "—"}</dd></div><div><dt>Número de WhatsApp disponible</dt><dd>{message.customer.phone?.trim() ? message.customer.phone : "No registrado"}</dd></div><div><dt>Plantilla seleccionada</dt><dd>{message.template.name}</dd></div></dl>
          <p className="cobranza-draft-preview">{message.content}</p>
          <h4>Variables reemplazadas</h4>{!message.variables.length ? <p>La plantilla no utiliza variables.</p> : <dl>{message.variables.map(variable => <div key={variable.name}><dt>{`{{${variable.name}}}`}</dt><dd>{variable.value == null ? "No registrado" : String(variable.value)}</dd></div>)}</dl>}
          {message.missing_variables.length > 0 && <p role="alert">Falta información: {message.missing_variables.join(", ")}.</p>}
          {message.unsupported_variables.length > 0 && <p role="alert">Variables no admitidas: {message.unsupported_variables.join(", ")}.</p>}
          {message.malformed_variables && <p role="alert">La plantilla contiene variables con formato inválido.</p>}
          {message.empty_content && <p role="alert">La plantilla no tiene contenido.</p>}
          <p role="status">{message.notice}</p>
          <button className="cartera-reset" disabled={!message.can_prepare || !phoneAvailable || loading || message.prepared} onClick={() => generate(true)}>Preparar mensaje</button>
        </div>}
      </>}
      {error && !templates.rows.length && <p role="alert">{error}</p>}
    </div>}
  </section>;
}
