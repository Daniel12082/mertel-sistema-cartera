import {useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {Plus,RefreshCw,X,Users} from 'lucide-react';
import {useAuth} from '../../auth/useAuth';
import {usersRequest} from '../../services/userManagement.service';
import {Panel,Badge,EmptyState} from '../../components/ui/dashboard-ui';
import './Usuarios.css';
import RolesPermissions from './RolesPermissions';

const initial={first_name:'',last_name:'',username:'',email:'',phone:'',password:'',roles:[]};
function UserForm({selected,roles,onClose,onSaved}){
  const editing=Boolean(selected),dialog=useRef(null),saving=useRef(false);
  const [form,setForm]=useState(()=>({...initial,...selected,roles:selected?.roles||[],password:''})),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{const element=dialog.current;const before=document.activeElement;element.showModal();element.querySelector('input')?.focus();return ()=>{element.close();before?.focus();};},[]);
  const update=(field,value)=>setForm(current=>({...current,[field]:value}));
  async function submit(event){event.preventDefault();if(saving.current)return;saving.current=true;setBusy(true);setError('');
    const body={first_name:form.first_name,last_name:form.last_name,username:form.username,email:form.email,phone:form.phone,roles:form.roles,...(!editing?{password:form.password}:{})};
    try{const saved=await usersRequest(editing?'PUT':'POST',editing?'/'+selected.id:'',body);onSaved(editing?'Datos del usuario actualizados.':'Usuario creado.',saved.id);}
    catch(failure){setError(failure.message);}finally{saving.current=false;setBusy(false);}
  }
  return <dialog className="users-dialog" ref={dialog} onCancel={event=>{if(busy)event.preventDefault();else onClose();}} aria-labelledby="user-form-title"><header><div><h3 id="user-form-title">{editing?'Editar usuario':'Crear usuario'}</h3><p>Cuenta interna de MERTEL Importaciones</p></div><button type="button" onClick={onClose} disabled={busy} aria-label="Cerrar formulario"><X size={18}/></button></header>
    <form onSubmit={submit}><div className="users-form-grid">{[['first_name','Nombre',100,true],['last_name','Apellidos',100,false],['username','Nombre de usuario',50,false],['email','Correo electrónico',150,true],['phone','Teléfono',50,false]].map(([field,label,max,required])=><label key={field}>{label}<input type={field==='email'?'email':'text'} value={form[field]||''} maxLength={max} required={required} disabled={busy} autoComplete={field==='username'?'username':'off'} onChange={event=>update(field,event.target.value)}/></label>)}
      {!editing&&<label>Contraseña inicial<input type="password" autoComplete="new-password" required value={form.password} disabled={busy} onChange={event=>update('password',event.target.value)}/></label>}</div>
      <fieldset disabled={busy}><legend>Roles existentes</legend>{roles.map(role=><label key={role.name}><input type="checkbox" checked={form.roles.includes(role.name)} onChange={event=>update('roles',event.target.checked?[...form.roles,role.name]:form.roles.filter(name=>name!==role.name))}/>{role.label}</label>)}{!roles.length&&<p>No hay roles compatibles disponibles.</p>}</fieldset>
      <p className="users-help">{editing?'La edición no cambia la contraseña. Los cambios de roles pueden requerir iniciar sesión de nuevo.':'El correo electrónico permite iniciar sesión con la autenticación existente.'}</p>
      {error&&<p role="alert" className="ui-error">{error}</p>}<footer><button type="button" onClick={onClose} disabled={busy}>Cancelar</button><button className="users-primary" type="submit" disabled={busy||!form.roles.length}>{busy?'Guardando…':editing?'Guardar cambios':'Crear usuario'}</button></footer>
    </form></dialog>;
}
export default function Usuarios(){
  const {permissions=[],user,refreshIdentity}=useAuth(),authorized=permissions.includes('settings.manage');
  const [revision,setRevision]=useState(0),[state,setState]=useState({key:null,data:null,error:''}),[selected,setSelected]=useState(null),[creating,setCreating]=useState(false),[notice,setNotice]=useState(''),[pending,setPending]=useState(null),[busy,setBusy]=useState(false);
  const locking=useRef(false);
  useEffect(()=>{if(!authorized)return;const controller=new AbortController();usersRequest('GET','',undefined,{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setState({key:revision,data,error:''});}).catch(error=>{if(!controller.signal.aborted)setState({key:revision,data:null,error:error.message});});return()=>controller.abort();},[authorized,revision]);
  const current=state.key===revision,data=current?state.data:null,loading=authorized&&!current;
  function changed(message,id){setSelected(null);setCreating(false);setNotice(message);setRevision(value=>value+1);if(String(id)===String(user?.id))refreshIdentity?.().catch(()=>{});}
  async function toggle(){if(locking.current)return;locking.current=true;setBusy(true);try{await usersRequest('PATCH','/'+pending.id+'/status',{status:pending.status==='active'?'inactive':'active'});setPending(null);changed('Estado del usuario actualizado.');}catch(error){setNotice(error.message);}finally{locking.current=false;setBusy(false);}}
  if(!authorized)return <section className="users-page"><p role="alert">No tienes permiso para administrar usuarios.</p></section>;
  return <section className="users-page"><header className="users-page-header"><div><Link to="/configuracion">Configuración</Link><h2>Usuarios</h2><p>Administra las cuentas de los trabajadores de MERTEL.</p></div><div><button onClick={()=>setRevision(value=>value+1)} disabled={loading||busy}><RefreshCw size={15}/>Actualizar</button><button className="users-primary" onClick={()=>setCreating(true)} disabled={!data||busy}><Plus size={16} aria-hidden="true"/>+ Crear usuario</button></div></header>
    {notice&&<p role="status" className="users-notice">{notice}</p>}{loading&&<p role="status">Cargando usuarios…</p>}{current&&state.error&&<div role="alert" className="ui-error">{state.error}<button onClick={()=>setRevision(value=>value+1)}>Reintentar</button></div>}
    {data&&<Panel title="Usuarios existentes" description="Cuentas de los trabajadores de MERTEL.">{data.users.length?<div className="users-table-wrap"><table><thead><tr><th>Nombre</th><th>Usuario/correo</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{data.users.map(item=><tr key={item.id}><td><strong>{item.first_name} {item.last_name}</strong></td><td>{item.username&&<small>{item.username}</small>}{item.email}</td><td>{item.roles.map(role=><Badge key={role}>{data.roles.find(candidate=>candidate.name===role)?.label||role}</Badge>)}</td><td><Badge tone={item.status==='active'?'positive':'neutral'}>{item.status==='active'?'Activo':'Inactivo'}</Badge></td><td><button onClick={()=>setSelected(item)} disabled={busy}>Editar</button><button onClick={()=>{setPending(item);setNotice('');}} disabled={busy||String(item.id)===String(user?.id)}>{item.status==='active'?'Desactivar':'Activar'}</button></td></tr>)}</tbody></table></div>:<EmptyState title="Sin usuarios disponibles" description="No se crean trabajadores de demostración."/>}</Panel>}
    {permissions.includes('roles.view')&&<details className="users-roles-consultation"><summary>Consultar roles y permisos</summary><RolesPermissions /></details>}
    {(creating||selected)&&<UserForm selected={selected} roles={data?.roles||[]} onClose={()=>{setSelected(null);setCreating(false);}} onSaved={changed}/>}
    {pending&&<div className="users-status-confirm" role="alert"><Users size={20}/><div><strong>{pending.status==='active'?'Desactivar':'Activar'} a {pending.first_name} {pending.last_name}</strong><p>{pending.status==='active'?'No podrá iniciar sesión y se cerrarán sus sesiones anteriores.':'Podrá iniciar sesión con sus credenciales existentes.'}</p></div><button disabled={busy} onClick={()=>setPending(null)}>Cancelar</button><button className="users-primary" disabled={busy} onClick={toggle}>{busy?'Guardando…':'Confirmar estado'}</button></div>}
  </section>;
}
