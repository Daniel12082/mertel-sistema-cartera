import {beforeEach,expect,it,vi} from 'vitest';
import {render,screen,within,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter} from 'react-router-dom';
import {AuthContext} from '../src/auth/auth.context';
import Usuarios from '../src/pages/Configuracion/Usuarios';
import Configuracion from '../src/pages/Configuracion/Configuracion';
import {getRoleCatalog} from '../src/services/auth.service';
import {usersRequest} from '../src/services/userManagement.service';
vi.mock('../src/services/auth.service',()=>({getRoleCatalog:vi.fn()}));
vi.mock('../src/services/userManagement.service',()=>({usersRequest:vi.fn()}));
const data={users:[{id:'1',first_name:'Ana',last_name:'Admin',email:'ana@example.test',username:'ana.admin',phone:'',status:'active',roles:['admin']},{id:'2',first_name:'Luis',last_name:'Worker',email:'luis@example.test',username:'luis.worker',phone:'3001111111',status:'active',roles:['collector']}],roles:[{name:'admin',label:'Admin'},{name:'collector',label:'Collector'},{name:'supervisor',label:'Supervisor'}]};
function view(element=<Usuarios/>,permissions=['settings.manage','roles.view']){render(<MemoryRouter><AuthContext.Provider value={{user:{id:'1'},permissions}}>{element}</AuthContext.Provider></MemoryRouter>);}
beforeEach(()=>{
  vi.clearAllMocks();getRoleCatalog.mockResolvedValue([{name:"admin",label:"Administrador",permissions:[{name:"settings.manage",moduleLabel:"Configuración",description:"Administrar configuración",enabled:true,implemented:true}]}]);usersRequest.mockImplementation(method=>Promise.resolve(method==='GET'?data:{id:'2'}));
  Object.defineProperties(HTMLDialogElement.prototype,{showModal:{configurable:true,value:function(){this.setAttribute('open','');}},close:{configurable:true,value:function(){this.removeAttribute('open');}}});
});
it('configuration opens the category overview and links to the existing user module',()=>{view(<Configuracion/>);expect(screen.getByRole('heading',{name:'Centro de configuración'})).toBeVisible();expect(screen.getAllByRole('link',{name:/Usuarios/})[0]).toHaveAttribute('href','/configuracion/usuarios');expect(usersRequest).not.toHaveBeenCalled();});
it('denies unauthorized users without fetching accounts',()=>{view(<Usuarios/>,['roles.view']);expect(screen.getByRole('alert')).toHaveTextContent('No tienes permiso');expect(usersRequest).not.toHaveBeenCalled();});
it('lists real response users and protects own deactivation',async()=>{view();await screen.findByText('Luis Worker');expect(screen.getByText('Ana Admin')).toBeVisible();expect(screen.getByRole('row',{name:/Ana Admin/}).querySelector('button:last-child')).toBeDisabled();});
it('creates using existing fields and roles, with password hidden and no company selector',async()=>{
  const user=userEvent.setup();view();await screen.findByText('Luis Worker');await user.click(screen.getByRole('button',{name:'+ Crear usuario',exact:true}));const dialog=screen.getByRole('dialog');
  await user.type(within(dialog).getByLabelText('Nombre',{exact:true}),'María');await user.type(within(dialog).getByLabelText('Correo electrónico'),'maria@example.test');await user.type(within(dialog).getByLabelText('Contraseña inicial'),'test-password');await user.click(within(dialog).getByRole('checkbox',{name:'Collector'}));expect(within(dialog).getByLabelText('Contraseña inicial')).toHaveAttribute('type','password');expect(within(dialog).queryByLabelText(/Empresa/)).not.toBeInTheDocument();await user.click(within(dialog).getByRole('button',{name:'Crear usuario',exact:true}));
  await waitFor(()=>expect(usersRequest).toHaveBeenCalledWith('POST','',{first_name:'María',last_name:'',username:'',email:'maria@example.test',phone:'',roles:['collector'],password:'test-password'}));await screen.findByText('Usuario creado.');
});
it('edits basic data and existing roles without submitting password',async()=>{
  const user=userEvent.setup();view();await screen.findByText('Luis Worker');await user.click(within(screen.getByRole('row',{name:/Luis Worker/})).getByRole('button',{name:'Editar'}));const dialog=screen.getByRole('dialog');expect(within(dialog).queryByLabelText('Contraseña inicial')).not.toBeInTheDocument();await user.clear(within(dialog).getByLabelText('Nombre',{exact:true}));await user.type(within(dialog).getByLabelText('Nombre',{exact:true}),'Luis editado');await user.click(within(dialog).getByRole('button',{name:'Guardar cambios'}));await waitFor(()=>expect(usersRequest).toHaveBeenCalledWith('PUT','/2',expect.objectContaining({first_name:'Luis editado',roles:['collector']})));const body=usersRequest.mock.calls.find(call=>call[0]==='PUT')[2];expect(body).not.toHaveProperty('password');
});
it('requires explicit confirmation before changing status',async()=>{const user=userEvent.setup();view();await screen.findByText('Luis Worker');await user.click(within(screen.getByRole('row',{name:/Luis Worker/})).getByRole('button',{name:'Desactivar'}));expect(usersRequest.mock.calls.some(call=>call[0]==='PATCH')).toBe(false);await user.click(screen.getByRole('button',{name:'Confirmar estado'}));await waitFor(()=>expect(usersRequest).toHaveBeenCalledWith('PATCH','/2/status',{status:'inactive'}));});
it('displays safe load errors and retry',async()=>{usersRequest.mockRejectedValueOnce(new Error('No pudimos cargar los usuarios.'));view();await screen.findByText('No pudimos cargar los usuarios.');await userEvent.click(screen.getByRole('button',{name:'Reintentar'}));await screen.findByText('Luis Worker');});

it('keeps the roles catalogue consultable as a secondary section',async()=>{view();await screen.findByText('Luis Worker');await userEvent.click(screen.getByText('Consultar roles y permisos',{selector:'summary'}));await userEvent.click(screen.getByRole('button',{name:'Consultar roles y permisos'}));expect(await screen.findByText('Administrar configuración')).toBeVisible();expect(getRoleCatalog).toHaveBeenCalledTimes(1);});
