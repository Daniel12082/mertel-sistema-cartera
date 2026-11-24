import {useState} from 'react';
import {useAuth} from '../../auth/useAuth';
import {getRoleCatalog} from '../../services/auth.service';
import api from '../../services/api';
import {useAppDataMode} from '../../simulation/useAppDataMode';
import {PERMISSIONS,expandPermissions} from '../../../../backend/src/config/permissions';
import './Configuracion.css';
import './RolesPermissions.css';
const available=PERMISSIONS.filter(p=>p.implemented&&p.name!=='companies.view');
const groups=[...new Set(available.map(p=>p.module))];
export default function RoleManager({onSaved}){
  const {mode}=useAppDataMode();
  const {permissions=[]}=useAuth(),authorized=permissions.includes('roles.view'),canManage=permissions.includes('roles.manage');
  const [catalog,setCatalog]=useState([]),[selected,setSelected]=useState('admin'),[form,setForm]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  async function loadRoles(){setBusy(true);setError('');try{setCatalog(await getRoleCatalog());}catch{setError('No se pudieron consultar los roles. Intenta nuevamente.');}finally{setBusy(false);}}
  function edit(role){setError('');setNotice('');setForm(role?{id:role.id,label:role.label,description:role.description||'',active:role.active,permissions:role.permissions.filter(p=>p.enabled&&p.implemented).map(p=>p.name)}:{label:'',description:'',active:true,permissions:[]});}
  function toggle(permission,checked){setForm(current=>{let names=checked?expandPermissions([...current.permissions,permission]):current.permissions.filter(p=>p!==permission);if(!checked){let previous;do{previous=names.length;names=names.filter(name=>expandPermissions([name]).every(p=>names.includes(p)));}while(previous!==names.length);}return {...current,permissions:names};});}
  async function save(event){event.preventDefault();if(busy)return;setBusy(true);setError('');try{const {id,...body}=form;await api.request({method:id?'put':'post',url:'/admin/roles'+(id?'/'+id:''),data:body});setCatalog(await getRoleCatalog());setForm(null);setNotice(mode==='SIMULATION'?'Rol guardado solo en esta simulación.':'Rol guardado. Sus permisos se aplican en el servidor.');onSaved?.();}catch(failure){setError(failure.response?.data?.message||'No se pudo guardar el rol.');}finally{setBusy(false);}}
  const role=catalog.find(item=>item.name===selected);
  if(!authorized)return <section><h2>Roles y permisos</h2><p role="alert">No tienes permiso para consultar los roles.</p></section>;
  return <section className="role-permissions"><h2>Roles y permisos</h2><p>Selecciona los paneles y las operaciones de cada rol. Los roles del sistema se conservan; los personalizados se pueden editar.</p>
    <div className="role-toolbar"><button type="button" disabled={busy} onClick={loadRoles}>{busy?'Cargando…':'Consultar roles y permisos'}</button>{canManage&&<button type="button" disabled={busy} onClick={()=>edit(null)}>Nuevo rol</button>}</div>
    {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
    {!form&&catalog.length>0&&<><label>Rol<select value={selected} onChange={e=>setSelected(e.target.value)}>{catalog.map(item=><option key={item.name} value={item.name}>{item.label}{item.active===false?' (inactivo)':''}</option>)}</select></label>
      {role&&<><p>{role.custom?'Rol personalizado de MERTEL.':'Rol del sistema. Sus permisos no se modifican.'}</p>{role.custom&&canManage&&<button onClick={()=>edit(role)}>Editar rol</button>}<div className="role-permissions-table"><table><caption>Permisos de {role.label}</caption><thead><tr><th>Panel</th><th>Operación</th><th>Acceso</th></tr></thead><tbody>{role.permissions.filter(p=>p.implemented).map(p=><tr key={p.name}><td>{p.moduleLabel}</td><td>{p.description}</td><td>{p.enabled?'Permitido':'Sin permiso'}</td></tr>)}</tbody></table></div></>}
    </>}
    {form&&<form className="role-editor" onSubmit={save}><h3>{form.id?'Editar rol':'Crear rol'}</h3><label>Nombre del rol<input required maxLength={80} value={form.label} onChange={e=>setForm({...form,label:e.target.value})}/></label><label>Descripción<input maxLength={255} value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label><label className="role-check"><input type="checkbox" checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}/>Rol activo</label>
      <p>Una acción que necesita consultar el módulo selecciona también ese acceso.</p><div className="role-grid">{groups.map(module=><fieldset key={module} disabled={busy}><legend>{available.find(p=>p.module===module).moduleLabel}</legend>{available.filter(p=>p.module===module).map(p=><label className="role-check" key={p.name}><input type="checkbox" checked={form.permissions.includes(p.name)} onChange={e=>toggle(p.name,e.target.checked)}/>{p.description}</label>)}</fieldset>)}</div>
      <div className="role-toolbar"><button type="button" disabled={busy} onClick={()=>setForm(null)}>Cancelar</button><button type="submit" disabled={busy}>{busy?'Guardando…':'Guardar rol'}</button></div>
    </form>}
  </section>;
}
