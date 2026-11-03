import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext } from '../src/auth/auth.context';
import { useAuth } from '../src/auth/useAuth';
import SimulationProvider from '../src/simulation/SimulationProvider';
import SimulationControls from '../src/simulation/SimulationControls';
import { leaveSimulation, MODE_KEY, simulationData } from '../src/simulation/store';
import api from '../src/services/api';
import { permissionsForRoles } from '../../backend/src/config/permissions.js';

const permissions = permissionsForRoles([{ name: 'admin' }]);
function Identity() { const { user } = useAuth(); return <span>{user.name}</span>; }
function view() { return render(<MemoryRouter><AuthContext.Provider value={{ user: { id: 1, name: 'Identidad privada de prueba' }, roles: [{ name: 'admin' }], permissions }}>
  <SimulationProvider><SimulationControls /><Identity /></SimulationProvider>
</AuthContext.Provider></MemoryRouter>); }
beforeEach(() => { leaveSimulation(); api.defaults.adapter = vi.fn(async config => ({ data: { data: { access_token: 'fixture', user: { id: 1 } } }, status: 200, config, headers: {} })); });
afterEach(() => { leaveSimulation(); vi.restoreAllMocks(); });
it('activation displays a persistent badge and replaces real identity with a local display identity', async () => {
  view(); expect(screen.queryByText('MODO SIMULACIÓN')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Activar simulación' }));
  expect(await screen.findByText('MODO SIMULACIÓN')).toBeVisible(); expect(screen.getByText('Equipo de demostración')).toBeVisible();
  expect(screen.queryByText('Identidad privada de prueba')).not.toBeInTheDocument(); expect(api.defaults.adapter).not.toHaveBeenCalled();
});
it('reset restores local records and exit confirmation clears the simulation keys', async () => {
  view(); fireEvent.click(screen.getByRole('button', { name: 'Activar simulación' }));
  simulationData().customers[0].name = 'Modificación local';
  fireEvent.click(screen.getByRole('button', { name: 'Reiniciar simulación' })); expect(simulationData().customers[0].name).toContain('DEMO');
  const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false);
  fireEvent.click(screen.getByRole('button', { name: 'Salir de simulación' })); expect(screen.getByText('MODO SIMULACIÓN')).toBeVisible(); expect(api.defaults.adapter).not.toHaveBeenCalled();
  confirmation.mockReturnValue(true); fireEvent.click(screen.getByRole('button', { name: 'Salir de simulación' }));
  await waitFor(() => expect(screen.queryByText('MODO SIMULACIÓN')).not.toBeInTheDocument());
  expect(sessionStorage.getItem(MODE_KEY)).toBeNull(); expect(screen.getByText('Identidad privada de prueba')).toBeVisible();
});
