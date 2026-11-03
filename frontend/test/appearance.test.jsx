import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {render,screen,waitFor,act} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter} from 'react-router-dom';
import {AuthContext} from '../src/auth/auth.context';
import SimulationProvider from '../src/simulation/SimulationProvider';
import {enterSimulation,leaveSimulation,resetSimulation} from '../src/simulation/store';
import AppearanceProvider from '../src/appearance/AppearanceProvider';
import {useAppearance} from '../src/appearance/appearance.context';
import Personalizacion from '../src/pages/Configuracion/Personalizacion';
import {DEFAULT_APPEARANCE} from '../../backend/src/config/appearance';
import {loadAppearance,persistAppearance} from '../src/services/appearance.service';
vi.mock('../src/services/appearance.service',()=>({loadAppearance:vi.fn(),persistAppearance:vi.fn()}));
const identity={user:{id:'appearance-test-user',roles:[{name:'admin'}]},roles:[{name:'admin'}],permissions:['settings.manage']};
function Probe(){const {appearance}=useAppearance();return <output data-testid="appearance-name">{appearance.name}</output>;}
function view(permissions=identity.permissions){return render(<MemoryRouter><AuthContext.Provider value={{...identity,permissions}}><SimulationProvider><AppearanceProvider><Probe/><Personalizacion/></AppearanceProvider></SimulationProvider></AuthContext.Provider></MemoryRouter>);}
beforeEach(()=>{leaveSimulation();vi.clearAllMocks();loadAppearance.mockResolvedValue({appearance:structuredClone(DEFAULT_APPEARANCE),company_name:'MERTEL IMPORTACIONES'});persistAppearance.mockImplementation(value=>Promise.resolve({appearance:value,company_name:'MERTEL IMPORTACIONES'}));});
afterEach(()=>{leaveSimulation();});
it('previews global identity and colors, saves real configuration and restores with confirmation',async()=>{
  const user=userEvent.setup();view();await screen.findByLabelText('Nombre de la aplicación');const name=screen.getByLabelText('Nombre de la aplicación');await user.clear(name);await user.type(name,'MERTEL Cartera');expect(screen.getByTestId('appearance-name')).toHaveTextContent('MERTEL Cartera');
  const color=screen.getByLabelText('Color principal HEX');await user.clear(color);await user.type(color,'#166534');expect(document.documentElement.style.getPropertyValue('--mertel-primary')).toBe('#166534');expect(persistAppearance).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button',{name:'Guardar cambios'}));await screen.findByText('Apariencia guardada para MERTEL.');expect(persistAppearance).toHaveBeenCalledWith(expect.objectContaining({name:'MERTEL Cartera',colors:expect.objectContaining({primary:'#166534'})}));
  await user.click(screen.getByRole('button',{name:'Restaurar apariencia predeterminada'}));expect(persistAppearance).toHaveBeenCalledTimes(1);await user.click(screen.getByRole('button',{name:'Confirmar restauración'}));await waitFor(()=>expect(persistAppearance).toHaveBeenLastCalledWith(DEFAULT_APPEARANCE));
});
it('shows load error and retries without a technical error',async()=>{loadAppearance.mockRejectedValueOnce(new Error('No pudimos cargar la apariencia de MERTEL.'));view();await screen.findByRole('button',{name:'Reintentar'});await userEvent.click(screen.getByRole('button',{name:'Reintentar'}));expect(await screen.findByLabelText('Nombre de la aplicación')).toBeVisible();});
it('does not permit editing without settings.manage',()=>{view([]);expect(screen.getByRole('alert')).toHaveTextContent('No tienes permiso');expect(screen.queryByRole('button',{name:'Guardar cambios'})).not.toBeInTheDocument();});
it('rejects SVG and oversized images before reading them',async()=>{view();const input=await screen.findByLabelText('Logo principal');await userEvent.upload(input,new File(['<svg><script/></svg>'],'bad.svg',{type:'image/svg+xml'}),{applyAccept:false});expect(await screen.findByRole('alert')).toHaveTextContent('SVG no está permitido');expect(persistAppearance).not.toHaveBeenCalled();});
it('blocks insufficient text contrast from saving',async()=>{view();const input=await screen.findByLabelText('Color de texto principal HEX');await userEvent.clear(input);await userEvent.type(input,'#ffffff');await userEvent.click(screen.getByRole('button',{name:'Guardar cambios'}));expect(await screen.findByRole('alert')).toHaveTextContent('4.5:1');expect(persistAppearance).not.toHaveBeenCalled();});
it('simulation changes remain local, reset clears them and exit restores real appearance',async()=>{
  loadAppearance.mockResolvedValue({appearance:{...DEFAULT_APPEARANCE,name:'MERTEL Real'},company_name:'MERTEL IMPORTACIONES'});view();await waitFor(()=>expect(screen.getByTestId('appearance-name')).toHaveTextContent('MERTEL Real'));
  act(()=>enterSimulation({...identity.user,permissions:identity.permissions}));const fetches=loadAppearance.mock.calls.length;const name=await screen.findByLabelText('Nombre de la aplicación');await userEvent.clear(name);await userEvent.type(name,'MERTEL Temporal');await userEvent.click(screen.getByRole('button',{name:'Guardar cambios'}));await screen.findByText('Apariencia aplicada solo a esta simulación.');expect(persistAppearance).not.toHaveBeenCalled();expect(loadAppearance).toHaveBeenCalledTimes(fetches);
  act(()=>resetSimulation());expect(screen.getByTestId('appearance-name')).toHaveTextContent('MERTEL');expect(screen.getByLabelText('Nombre de la aplicación')).toHaveValue('MERTEL');act(()=>leaveSimulation());await waitFor(()=>expect(screen.getByTestId('appearance-name')).toHaveTextContent('MERTEL Real'));
});
