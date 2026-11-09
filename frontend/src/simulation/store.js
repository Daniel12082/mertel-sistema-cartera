import { createSimulationDataset } from './dataset';

export const MODE_KEY = 'mertel_simulation_mode';
export const simulationAvailable = !import.meta.env.PROD;
const IDENTITY_KEY = 'mertel_simulation_display';
const listeners = new Set();
let realWrites = 0;
function readDisplay() {
  try {
    if (!simulationAvailable) {
      sessionStorage.removeItem(MODE_KEY);
      sessionStorage.removeItem(IDENTITY_KEY);
      return null;
    }
    if (sessionStorage.getItem(MODE_KEY) !== 'true') return null;
    const value = JSON.parse(sessionStorage.getItem(IDENTITY_KEY));
    return Array.isArray(value?.permissions) && Array.isArray(value?.roles) ? value : null;
  } catch { return null; }
}
const initialDisplay = readDisplay();
let snapshot = { mode: initialDisplay ? 'SIMULATION' : 'REAL', epoch: 0, display: initialDisplay };
let dataset = initialDisplay ? createSimulationDataset() : null;
export const simulationSnapshot = () => snapshot;
export const simulationActive = () => snapshot.mode === 'SIMULATION';
export const subscribeSimulation = listener => { listeners.add(listener); return () => listeners.delete(listener); };
export function simulationData() { if (!simulationActive() || !dataset) throw new Error('La simulación no está activa.'); return dataset; }
function notify() { listeners.forEach(listener => listener()); }
function saveDisplay(display) {
  try { sessionStorage.setItem(MODE_KEY, 'true'); sessionStorage.setItem(IDENTITY_KEY, JSON.stringify(display)); } catch { /* in-memory mode still works */ }
}
export function beginRealWrite() { realWrites++; }
export function finishRealWrite() { realWrites = Math.max(0, realWrites - 1); }
export function enterSimulation(identity) {
  if (!simulationAvailable) throw new Error('La versión publicada trabaja con datos de producción.');
  if (!identity || !Array.isArray(identity.permissions)) throw new Error('Inicia sesión antes de activar la simulación.');
  if (realWrites) throw new Error('Espera a que termine la operación actual antes de activar la simulación.');
  const display = { id: 'SIMULATION', name: 'Equipo de demostración', first_name: 'Equipo DEMO', email: 'presentacion@example.invalid', company_id: null,
    roles: (identity.roles || []).map(role => typeof role === 'string' ? { name: role } : { name: role.name }), permissions: [...identity.permissions] };
  dataset = createSimulationDataset(); saveDisplay(display);
  snapshot = { mode: 'SIMULATION', epoch: snapshot.epoch + 1, display }; notify();
}
export function resetSimulation() {
  if (!simulationActive()) return;
  dataset = createSimulationDataset(); snapshot = { ...snapshot, source: null, epoch: snapshot.epoch + 1 }; notify();
}
export function loadTemporaryPortfolio(prepared, expectedEpoch) {
  if (!simulationActive() || snapshot.epoch !== expectedEpoch) throw new Error('La simulación cambió; vuelve a analizar el archivo.');
  if (!snapshot.display.permissions.includes('portfolio.import')) throw new Error('No tienes permiso para cargar cartera.');
  dataset = structuredClone(prepared);
  snapshot = { ...snapshot, source: dataset.source, epoch: snapshot.epoch + 1 }; notify();
}
export function leaveSimulation() {
  dataset = null;
  try { sessionStorage.removeItem(MODE_KEY); sessionStorage.removeItem(IDENTITY_KEY); } catch { /* memory is cleared regardless */ }
  snapshot = { mode: 'REAL', epoch: snapshot.epoch + 1, display: null }; notify();
}
