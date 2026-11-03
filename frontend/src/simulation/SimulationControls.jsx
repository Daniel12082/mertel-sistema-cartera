import { useState } from 'react';
import { useAppDataMode } from './useAppDataMode';
import './SimulationControls.css';

export default function SimulationControls() {
  const { mode, source, activate, reset, exit } = useAppDataMode();
  const [error, setError] = useState('');
  function start() { try { activate(); } catch (failure) { setError(failure.message); } }
  return <div className="simulation-controls">
    {mode === 'SIMULATION' ? <>
      <strong className="simulation-badge" title={source ? 'Estás viendo tu cartera temporal. Ningún cambio se guarda en MERTEL.' : 'Estás viendo datos de demostración. Ningún cambio se guarda en MERTEL.'}>MODO SIMULACIÓN</strong>
      <span className="simulation-legend">{source ? 'Cartera de tu archivo · Solo en memoria · Contiene datos del archivo' : 'Datos de demostración · Ningún cambio se guarda'}</span>
      <button type="button" onClick={reset}>Reiniciar simulación</button><button type="button" onClick={exit}>Salir de simulación</button>
    </> : <button type="button" onClick={start}>Activar simulación</button>}
    {error && <span role="alert">{error}</span>}
  </div>;
}
