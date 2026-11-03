import {useEffect,useState} from 'react';
import {Link,NavLink,useNavigate,useParams} from 'react-router-dom';
import {ArrowUpRight,Building2,ClipboardCheck,Users,MessageSquare,FileText,FileSpreadsheet,Server,Palette,Settings} from 'lucide-react';
import {useAuth} from '../../auth/useAuth';
import {useAppDataMode} from '../../simulation/useAppDataMode';
import {useAppearance} from '../../appearance/appearance.context';
import {Panel,Badge,EmptyState} from '../../components/ui/dashboard-ui';
import api from '../../services/api';
import Usuarios from './Usuarios';
import CollectionSettings from '../Administracion/CollectionSettings';
import WhatsAppCenter from '../Administracion/WhatsAppCenter';
import Personalizacion from './Personalizacion';
import './SettingsCenter.css';

const categories=[
  {key:'general',name:'General',description:'Información de MERTEL y formatos de presentación.',icon:Building2},
  {key:'cobranza',name:'Cobranza',description:'Etapas operativas y reglas comerciales vigentes.',icon:ClipboardCheck},
  {key:'usuarios',name:'Usuarios',description:'Trabajadores, cuentas y consulta de roles.',icon:Users},
  {key:'whatsapp',name:'WhatsApp',description:'Conexión, proveedor y reglas de envío.',icon:MessageSquare},
  {key:'mensajes',name:'Mensajes',description:'Plantillas y variables de los mensajes.',icon:FileText},
  {key:'importaciones',name:'Importaciones',description:'Cargue de cartera, validaciones y resolución.',icon:FileSpreadsheet},
  {key:'sistema',name:'Sistema',description:'Estado de los servicios de la aplicación.',icon:Server},
  {key:'personalizacion',name:'Personalización',description:'Identidad visual, logos y colores de MERTEL.',icon:Palette},
];
function ServiceStatus(){
  const {mode}=useAppDataMode(),[revision,setRevision]=useState(0),[state,setState]=useState({loading:true,results:null});
  useEffect(()=>{
    if(mode==='SIMULATION')return;
    const controller=new AbortController();
    Promise.allSettled([api.get('/health',{signal:controller.signal}),api.get('/health/db',{signal:controller.signal})]).then(results=>{if(!controller.signal.aborted)setState({loading:false,results:results.map(result=>result.status==='fulfilled'&&result.value.data.success===true)});});
    return()=>controller.abort();
  },[mode,revision]);
  if(mode==='SIMULATION')return <Panel title="Sistema"><EmptyState title="Servicios reales sin consultar" description="En simulación las operaciones permanecen en este navegador."/></Panel>;
  return <Panel title="Estado de servicios" description="Comprobación de disponibilidad, sin exponer configuración interna." action={<button onClick={()=>{setState({loading:true,results:null});setRevision(value=>value+1);}}>Comprobar nuevamente</button>}>{state.loading?<p role="status">Comprobando servicios…</p>:<dl className="settings-data">{['Aplicación / API','Base de datos'].map((name,index)=><div key={name}><dt>{name}</dt><dd><Badge tone={state.results[index]?'positive':'critical'}>{state.results[index]?'Disponible':'No disponible'}</Badge></dd></div>)}</dl>}{!state.loading&&state.results.some(value=>!value)&&<p role="alert">No pudimos verificar todos los servicios. Puedes intentar nuevamente.</p>}</Panel>;
}
function ModuleAccess({title,description,links}){
  const {permissions=[]}=useAuth();
  return <Panel title={title} description={description}><div className="settings-module-links">{links.map(link=>permissions.includes(link.permission)?<Link key={link.to} to={link.to}><div><strong>{link.name}</strong><p>{link.description}</p></div><ArrowUpRight size={18} aria-hidden="true"/></Link>:<p key={link.to}>No tienes permiso para acceder a {link.name.toLowerCase()}.</p>)}</div></Panel>;
}
export default function Configuracion(){
  const {permissions=[]}=useAuth(),{mode}=useAppDataMode(),{category}=useParams(),navigate=useNavigate(),appearance=useAppearance();
  if(!permissions.includes('settings.manage'))return <section className="settings-center"><h2>Configuración</h2><p role="alert">{category==='usuarios'?'No tienes permiso para administrar usuarios.':'No tienes permiso para administrar la configuración de MERTEL.'}</p></section>;
  const selected=categories.find(item=>item.key===category);
  let content;
  if(!category)content=<><div className="settings-overview-heading"><h3>Centro de configuración</h3><p>Encuentra las opciones que necesitas para administrar MERTEL.</p></div><div className="settings-categories">{categories.map(({key,name,description,icon:Icon})=><Link className="settings-category-card" key={key} to={'/configuracion/'+key}><span className="settings-category-icon"><Icon size={22} aria-hidden="true"/></span><h3>{name}</h3><p>{description}</p><span className="settings-card-action">Administrar <ArrowUpRight size={15} aria-hidden="true"/></span></Link>)}</div></>;
  else if(!selected)content=<EmptyState title="Categoría no disponible" description="Selecciona una opción del Centro de Configuración."/>;
  else if(category==='general')content=<Panel title="Información general" description="MERTEL es el único contexto de esta aplicación.">{appearance.loading?<p role="status">Cargando información…</p>:appearance.error?<div className="ui-error" role="alert">No pudimos cargar la información.<button onClick={appearance.reload}>Reintentar</button></div>:<dl className="settings-data"><div><dt>Organización</dt><dd>{mode==='SIMULATION'?'MERTEL · Modo simulación':appearance.companyName||'MERTEL'}</dd></div><div><dt>Nombre de la aplicación</dt><dd>{appearance.savedAppearance?.name||appearance.appearance.name}</dd></div><div><dt>Descripción</dt><dd>{appearance.savedAppearance?.description||appearance.appearance.description}</dd></div><div><dt>Zona horaria de presentación</dt><dd>Bogotá (UTC−5)</dd></div><div><dt>Formato monetario</dt><dd>Peso colombiano (COP)</dd></div><div><dt>Formato de fecha y hora</dt><dd>Español (Colombia)</dd></div></dl>}<p className="settings-muted">Los formatos actuales son informativos. La identidad visual se administra en Personalización.</p><Link className="settings-text-link" to="/configuracion/personalizacion">Administrar identidad visual →</Link></Panel>;
  else if(category==='cobranza')content=<CollectionSettings/>;
  else if(category==='usuarios')content=<Usuarios/>;
  else if(category==='whatsapp')content=<WhatsAppCenter/>;
  else if(category==='mensajes')content=<ModuleAccess title="Mensajes" description="Administra las plantillas y consulta sus variables en el módulo existente." links={[{to:'/administracion/plantillas-whatsapp',name:'Plantillas y variables',description:'Contenido, etapas, variables y activación de plantillas.',permission:'message_templates.manage'}]}/>;
  else if(category==='importaciones')content=<ModuleAccess title="Importaciones" description="Accede a las herramientas de cargue y revisión de cartera." links={[{to:'/administracion/importar-cartera',name:'Importar cartera',description:'Analiza archivos y consulta las validaciones disponibles.',permission:'portfolio.import'},{to:'/administracion/resolucion-clientes',name:'Clientes por resolver',description:'Revisa y resuelve las correspondencias del archivo.',permission:'portfolio.import'}]}/>;
  else if(category==='sistema')content=<ServiceStatus/>;
  else content=<Personalizacion/>;
  return <section className="settings-center"><header className="settings-center-header"><div className="settings-eyebrow"><Settings size={14} aria-hidden="true"/>ADMINISTRACIÓN</div><h2>Configuración</h2><p>Administra las preferencias, reglas y módulos de MERTEL desde un solo lugar.</p></header>{mode==='SIMULATION'&&<p className="settings-simulation" role="status"><Badge tone="attention">MODO SIMULACIÓN</Badge> Cambios temporales en este navegador. No se guardan en MERTEL.</p>}
    <label className="settings-mobile-selector">Categoría de configuración<select value={selected?.key||''} onChange={event=>navigate(event.target.value?'/configuracion/'+event.target.value:'/configuracion')}><option value="">Centro de configuración</option>{categories.map(item=><option key={item.key} value={item.key}>{item.name}</option>)}</select></label>
    <div className="settings-layout"><nav aria-label="Categorías de configuración" className="settings-navigation"><NavLink end to="/configuracion">Centro de configuración</NavLink>{categories.map(({key,name,icon:Icon})=><NavLink key={key} to={'/configuracion/'+key}><Icon size={17} aria-hidden="true"/>{name}</NavLink>)}</nav><div className="settings-content" key={category||'overview'}>{content}</div></div>
  </section>;
}
