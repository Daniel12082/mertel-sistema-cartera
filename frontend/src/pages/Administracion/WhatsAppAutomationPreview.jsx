import { useState } from 'react';
import { MERTEL_CONTACTS } from '../../../../backend/src/services/whatsappSequence';
import { whatsappRequest } from '../../services/whatsappCenter.service';

const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
function AutomaticRule({ step, rule, templates, busy, act }) {
  const [form, setForm] = useState(rule || { stage: step.stage, mode: 'AUTOMATICO', enabled: false, template_id: '', start_time: '', end_time: '', weekdays: [], daily_limit: '', interval_hours: '' });
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const catalog = templates.filter(row => row.status === 'active' && row.channel === 'whatsapp' && row.name === step.template_name && (!row.stage || row.stage === step.stage));
  return <form className="wa-card" onSubmit={event => {
    event.preventDefault();
    void act(() => whatsappRequest(`/automations/${step.stage}`, { method: 'put', body: { ...form, mode: 'AUTOMATICO', weekdays: form.weekdays.filter(day => day !== 7), daily_limit: Number(form.daily_limit), interval_hours: Number(form.interval_hours) } }), `Regla de ${step.label} guardada.`);
  }}><h3>{step.label}</h3><p>{step.description}</p><code>{step.template_name}</code>
    {!catalog.length && <p className="wa-warning">No hay una plantilla activa con este nombre en el catálogo autorizado. Créala o actívala en Plantillas.</p>}
    <div className="wa-grid"><label>Plantilla de {step.label}<select aria-label={`Plantilla de ${step.label}`} required value={form.template_id} onChange={event => change('template_id', event.target.value)}><option value="">Seleccionar plantilla</option>{catalog.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <label>Hora inicial de {step.label}<input required type="time" value={form.start_time} onChange={event => change('start_time', event.target.value)} /></label>
      <label>Hora final de {step.label}<input required type="time" value={form.end_time} onChange={event => change('end_time', event.target.value)} /></label>
      <label>Límite diario de {step.label}<input required type="number" min="1" value={form.daily_limit} onChange={event => change('daily_limit', event.target.value)} /></label>
      <label>Intervalo técnico existente (horas) de {step.label}<input required type="number" min="1" max="8760" value={form.interval_hours} onChange={event => change('interval_hours', event.target.value)} /></label></div>
    <p>El intervalo no genera avisos nuevos ni cambia sus fechas comerciales. Máximo un automático por cliente y día.</p>
    <fieldset><legend>Días permitidos para {step.label}</legend><div className="wa-days">{days.map((day, index) => <label key={day}><input type="checkbox" disabled={index === 6} checked={index !== 6 && form.weekdays.includes(index + 1)} onChange={event => change('weekdays', event.target.checked ? [...form.weekdays, index + 1] : form.weekdays.filter(value => value !== index + 1))} />{day}</label>)}</div></fieldset>
    <label className="wa-check"><input type="checkbox" checked={form.enabled} onChange={event => change('enabled', event.target.checked)} />Habilitar {step.label}</label>
    <button disabled={busy || !catalog.length}>Guardar regla de {step.label}</button>
  </form>;
}
export default function WhatsAppAutomationPreview({ settings, templates, busy, act, revision }) {
  const [daily, setDaily] = useState(settings.global_daily_limit ?? '');
  return <>
    <article className="wa-card"><span className="wa-eyebrow">AUTOMATIZACIÓN MERTEL</span><h2>Automatización de mensajes</h2><p>Configuración automática</p>
      <p className="wa-banner">Mora → Vence hoy → Recordatorio → Pronto pago. Un aviso enviado no se repite. Sin domingos ni festivos; aplazamiento máximo de 3 días y pronto pago hasta el día calendario 10.</p>
      <p>Estado: {settings.automations_enabled ? 'Automatización activa' : settings.rules.some(rule => rule.mode === 'AUTOMATICO') ? 'Automatización configurada' : 'Automatización desactivada'}</p>
      <p>Proveedor MOCK: esta configuración no envía WhatsApp real.</p>
      <form onSubmit={event => { event.preventDefault(); void act(() => whatsappRequest('/settings', { method: 'patch', body: { global_daily_limit: Number(daily), customer_daily_limit: settings.customer_daily_limit || 1 } }), 'Límite diario guardado.'); }}>
        <label>Límite global diario<input required type="number" min="1" value={daily} onChange={event => setDaily(event.target.value)} /></label><button disabled={busy}>Guardar límite diario</button>
      </form>
      <button disabled={busy || settings.connection_status !== 'CONNECTED'} onClick={() => act(() => whatsappRequest('/settings', { method: 'patch', body: { automations_enabled: !settings.automations_enabled } }), settings.automations_enabled ? 'Automatización desactivada.' : 'Automatización activada en MOCK.')}>{settings.automations_enabled ? 'Desactivar automatización' : 'Activar automatización MOCK'}</button>
    </article>
    {MERTEL_CONTACTS.map(step => <AutomaticRule key={`${step.stage}:${revision}`} step={step} rule={settings.rules.find(row => row.stage === step.stage && row.mode === 'AUTOMATICO')} templates={templates} busy={busy} act={act} />)}
  </>;
}
