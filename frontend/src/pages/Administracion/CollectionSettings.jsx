import { useEffect, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { getCollectionSettings, updateCollectionStages } from "../../services/collectionSettingsAdmin.service";
import "./CollectionSettings.css";

export default function CollectionSettings() {
  const { permissions = [] } = useAuth();
  const authorized = permissions.includes("settings.manage");
  const [state, setState] = useState({ loading: true, saving: false, error: "", data: null, success: "" });
  const [stages, setStages] = useState([]);
  useEffect(() => {
    if (!authorized) {
      setState({ loading: false, saving: false, error: "", data: null, success: "" }); setStages([]);
      return undefined;
    }
    const controller = new AbortController();
    setState(current => ({ ...current, loading: true, error: "", success: "" }));
    getCollectionSettings({ signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) { setState({ loading: false, saving: false, error: "", data, success: "" }); setStages(data.stages); }
    }).catch(error => { if (!controller.signal.aborted) setState({ loading: false, saving: false, error: error.message, data: null, success: "" }); });
    return () => controller.abort();
  }, [authorized]);

  async function save() {
    setState(current => ({ ...current, saving: true, error: "", success: "" }));
    try {
      const data = await updateCollectionStages(stages.map(({ key, value }) => ({ key, active: value })));
      setState({ loading: false, saving: false, error: "", data, success: "Configuración guardada correctamente." }); setStages(data.stages);
    } catch (error) { setState(current => ({ ...current, saving: false, error: error.message, success: "" })); }
  }

  if (!authorized) return <section className="collection-settings-page"><div className="collection-settings-notice" role="alert">No tienes permiso para administrar la configuración de cobranza.</div></section>;
  const configured = state.data?.configured;
  return <section className="collection-settings-page">
    <header className="collection-settings-header"><div><h2>Configuración de cobranza</h2><p>Administra las etapas operativas de la política de cobranza de MERTEL.</p></div></header>
    {state.loading ? <div role="status">Cargando configuración de cobranza…</div> : null}
    {state.error && <div className="collection-settings-notice error" role="alert">{state.error}</div>}
    {state.success && <div className="collection-settings-notice success" role="status">{state.success}</div>}
    {!state.loading && state.data && !configured && <div className="collection-settings-notice">MERTEL Importaciones todavía no tiene reglas de cobranza configuradas.</div>}
    {!state.loading && configured && <>
      <section className="collection-settings-section"><h3>Etapas de cobranza</h3><p>Solo se modifica si una etapa participa en la clasificación operativa. La prioridad permanece fija.</p>
        <div className="collection-settings-list">{stages.map(stage => <label className="collection-settings-row" key={stage.key}>
          <span><strong>{stage.label}</strong><small>{stage.description}</small></span>
          <span className="collection-settings-toggle"><input type="checkbox" aria-label={`Activar ${stage.label}`} checked={stage.value} disabled={state.saving} onChange={event => setStages(current => current.map(item => item.key === stage.key ? { ...item, value: event.target.checked } : item))} />{stage.value ? "Activa" : "Inactiva"}</span>
        </label>)}</div>
        <button type="button" onClick={save} disabled={state.saving || !stages.length}>{state.saving ? "Guardando…" : "Guardar configuración"}</button>
      </section>
      <section className="collection-settings-section"><h3>Reglas comerciales confirmadas</h3><p>Estos valores se muestran desde la configuración validada y no se editan en esta pantalla.</p>
        <div className="collection-settings-list">{state.data.settings.filter(item => !item.editable).map(item => <div className="collection-settings-row" key={item.key}>
          <span><strong>{item.label}</strong><small>{item.description}</small></span><span className="collection-settings-readonly">{Array.isArray(item.value) ? item.value.join(" → ") : `${item.value}${item.unit ? ` ${item.unit}` : ""}`}</span>
        </div>)}</div>
        <p>El beneficio condicionado del 10% entre los días 60 y 70 se mantiene informativo. La base de cálculo y coexistencia financiera están pendientes de definición.</p>
      </section>
    </>}
  </section>;
}
