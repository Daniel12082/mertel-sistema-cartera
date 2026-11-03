import {useEffect, useRef, useState} from 'react';
import {Palette, RotateCcw, Save} from 'lucide-react';
import {useAppearance} from '../../appearance/appearance.context';
import {useAuth} from '../../auth/useAuth';
import {useAppDataMode} from '../../simulation/useAppDataMode';
import {Panel, Badge} from '../../components/ui/dashboard-ui';
import defaultLogo from '../../assets/login/mertel-logo.png';
import {DEFAULT_APPEARANCE, MAX_LOGO_BYTES, contrastRatio, foregroundFor} from '../../../../backend/src/config/appearance';

const colors={primary:'Color principal',accent:'Color de acento',sidebar:'Color del sidebar',background:'Color de fondo',surface:'Color de tarjetas',text:'Color de texto principal'};
function validColors(value){return Object.values(value).every(color=>/^#[\da-f]{6}$/i.test(color));}
function readable(value){return validColors(value)&&contrastRatio(value.text,value.surface)>=4.5&&contrastRatio(value.text,value.background)>=4.5;}
async function readLogo(file){
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>MAX_LOGO_BYTES||!file.size)throw new Error('Usa PNG, JPG o WebP de hasta 20 KB. SVG no está permitido.');
  const bitmap=await createImageBitmap(file).catch(()=>{throw new Error('No pudimos leer esta imagen.');});
  const sizeValid=bitmap.width<=2048&&bitmap.height<=2048;bitmap.close();
  if(!sizeValid)throw new Error('El logo admite dimensiones de hasta 2048 × 2048 píxeles.');
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('No pudimos leer esta imagen.'));reader.readAsDataURL(file);});
}
function AppearanceEditor({initial,save,preview,clearPreview,simulated}){
  const [draft,setDraft]=useState(()=>structuredClone(initial)),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[restoring,setRestoring]=useState(false);
  const [uploading,setUploading]=useState(0);
  const alive=useRef(true),pending=useRef(false),uploads=useRef({logo:0,compactLogo:0});
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;clearPreview();};},[clearPreview]);
  useEffect(()=>{if(readable(draft.colors))preview(draft);},[draft,preview]);
  function update(field,value){setNotice('');setDraft(current=>({...current,[field]:value}));}
  async function upload(field,file){
    if(!file)return;const revision=++uploads.current[field];setError('');setUploading(count=>count+1);
    try{const data=await readLogo(file);if(alive.current&&uploads.current[field]===revision)update(field,data);}catch(failure){if(alive.current)setError(failure.message);}finally{if(alive.current)setUploading(count=>count-1);}
  }
  async function commit(value=draft){
    if(pending.current)return;
    if(uploading)return;
    if(!value.name.trim()||!value.description.trim()||[...value.name+value.description].some(character=>character.charCodeAt(0)<32||character.charCodeAt(0)===127||'<>'.includes(character))){setError('Introduce un nombre y una descripción sin HTML ni caracteres de control.');return;}
    if(!readable(value.colors)){setError('Introduce colores HEX válidos y un contraste de texto de al menos 4.5:1 con el fondo y las tarjetas.');return;}
    pending.current=true;setBusy(true);setError('');setNotice('');
    try{await save(value);if(alive.current){setDraft(structuredClone(value));setRestoring(false);setNotice(simulated?'Apariencia aplicada solo a esta simulación.':'Apariencia guardada para MERTEL.');}}
    catch(failure){if(alive.current)setError(failure.message);}finally{pending.current=false;if(alive.current)setBusy(false);}
  }
  const theme=validColors(draft.colors)?draft.colors:DEFAULT_APPEARANCE.colors;
  return <div className="appearance-editor"><form onSubmit={event=>{event.preventDefault();commit();}}><fieldset disabled={busy||uploading>0}>
    <Panel title="Identidad" description="Nombre, descripción y logos de la aplicación."><label>Nombre de la aplicación<input required maxLength={50} value={draft.name} onChange={event=>update('name',event.target.value)}/></label><label>Descripción / subtítulo<input required maxLength={120} value={draft.description} onChange={event=>update('description',event.target.value)}/></label>
      <div className="appearance-logos">{[['logo','Logo principal'],['compactLogo','Logo compacto para sidebar']].map(([field,label])=><div key={field} className="appearance-logo-upload"><img src={draft[field]||defaultLogo} alt={label}/><label>{label}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event=>{upload(field,event.target.files?.[0]);event.target.value='';}}/></label><button type="button" onClick={()=>{uploads.current[field]++;update(field,null);}}>Restaurar {label.toLowerCase()}</button></div>)}</div><p className="settings-muted">PNG, JPG o WebP · hasta 20 KB por logo · máximo 2048 × 2048 píxeles.</p>
    </Panel><Panel title="Colores" description="Personaliza el tema manteniendo un texto legible."><div className="appearance-colors">{Object.entries(colors).map(([key,label])=><label key={key}>{label}<div><input type="color" aria-label={`Selector de ${label.toLowerCase()}`} value={/^#[\da-f]{6}$/i.test(draft.colors[key])?draft.colors[key]:'#000000'} onChange={event=>update('colors',{...draft.colors,[key]:event.target.value})}/><input aria-label={`${label} HEX`} required pattern="#[0-9a-fA-F]{6}" maxLength={7} value={draft.colors[key]} onChange={event=>update('colors',{...draft.colors,[key]:event.target.value})}/></div></label>)}</div></Panel></fieldset>
    {uploading>0&&<p role="status">Validando logo…</p>}{error&&<p role="alert" className="ui-error">{error}</p>}{notice&&<p role="status" className="settings-success">{notice}</p>}<div className="settings-actions"><button className="settings-primary" disabled={busy||uploading>0} type="submit"><Save size={16} aria-hidden="true"/>{busy?'Guardando…':'Guardar cambios'}</button><button disabled={busy||uploading>0} type="button" onClick={()=>setRestoring(true)}><RotateCcw size={16} aria-hidden="true"/>Restaurar apariencia predeterminada</button></div>
    {restoring&&<div className="settings-confirm" role="alert"><p>¿Restaurar la apariencia predeterminada de MERTEL?</p><button type="button" disabled={busy} onClick={()=>setRestoring(false)}>Cancelar</button><button type="button" disabled={busy} onClick={()=>commit(structuredClone(DEFAULT_APPEARANCE))}>Confirmar restauración</button></div>}
  </form><aside className="appearance-preview-column"><Panel title="Vista previa" description="Los cambios se reflejan inmediatamente en la aplicación. Se conservan al guardar."><div className="appearance-preview" style={{background:theme.background,color:theme.text}}><div className="appearance-preview-sidebar" style={{background:theme.sidebar,color:foregroundFor(theme.sidebar)}}><img src={draft.compactLogo||defaultLogo} alt="Logo compacto en vista previa"/><strong>{draft.name}</strong><span>Dashboard</span><span>Configuración</span></div><div className="appearance-preview-main"><header style={{background:theme.surface}}><img src={draft.logo||defaultLogo} alt="Logo principal en vista previa"/><strong>{draft.name}</strong><small>{draft.description}</small></header><article style={{background:theme.surface}}><Badge tone="positive">Disponible</Badge><h3>Gestión de cartera</h3><p>Tu espacio de trabajo</p><button type="button" style={{background:theme.primary,color:foregroundFor(theme.primary)}}>Botón principal</button><span className="appearance-preview-accent" style={{background:theme.accent,color:foregroundFor(theme.accent)}}>Acento</span></article></div></div><p className="settings-muted">Los estados de éxito, advertencia y error conservan sus colores.</p></Panel></aside></div>;
}
export default function Personalizacion(){
  const {permissions=[]}=useAuth(),{mode}=useAppDataMode(),appearance=useAppearance();
  if(!permissions.includes('settings.manage'))return <p role="alert">No tienes permiso para personalizar MERTEL.</p>;
  return <section><header className="settings-category-header"><Palette size={22} aria-hidden="true"/><div><h2>Personalización</h2><p>Personaliza la identidad visual de MERTEL sin modificar la funcionalidad del sistema.</p></div></header>{appearance.loading?<p role="status">Cargando apariencia…</p>:appearance.error?<Panel title="Apariencia" error onRetry={appearance.reload}/>:<AppearanceEditor initial={appearance.savedAppearance} save={appearance.save} preview={appearance.preview} clearPreview={appearance.clearPreview} simulated={mode==='SIMULATION'}/>}</section>;
}
