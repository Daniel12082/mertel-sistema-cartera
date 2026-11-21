import { Fragment, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { AuthContext } from '../auth/auth.context';
import { refreshSession } from '../services/api';
import { enterSimulation, leaveSimulation, resetSimulation, simulationSnapshot, subscribeSimulation } from './store';
import { SimulationContext } from './simulation.context';

export default function SimulationProvider({ children }) {
  const identity = useAuth();
  const snapshot = useSyncExternalStore(subscribeSimulation, simulationSnapshot);
  const navigate = useNavigate();
  const [closing, setClosing] = useState(false);
  const locked = identity.user?.simulation_only === true;
  const ready = !locked || (snapshot.mode === 'SIMULATION' && snapshot.display?.account_id === String(identity.user.id));
  useLayoutEffect(() => {
    if (closing) return;
    if (locked && !ready) enterSimulation({ ...identity.user, permissions: identity.permissions, roles: identity.roles });
    else if (!identity.initializing && !identity.user && snapshot.display?.simulation_only) leaveSimulation();
  }, [locked, ready, closing, identity, snapshot.display]);
  const value = useMemo(() => ({ ...snapshot, locked,
    activate() { enterSimulation({ ...identity.user, permissions: identity.permissions, roles: identity.roles }); navigate('/', { replace: true, state: null }); },
    reset() { resetSimulation(); navigate('/', { replace: true, state: null }); },
    async exit() {
      if (locked) {
        setClosing(true);
        leaveSimulation();
        try { await identity.logout(); } catch { /* The local session is cleared even if logout is unavailable. */ }
        finally { navigate('/login', { replace: true, state: null }); setClosing(false); }
        return;
      }
      if (!window.confirm('¿Salir del modo simulación?\nLos cambios realizados durante la demostración no se guardarán.')) return;
      leaveSimulation(); navigate('/', { replace: true, state: null });
      // Only after the mode is REAL may the existing cookie/session mechanism resume.
      await refreshSession().catch(() => {});
    },
  }), [snapshot, identity, navigate, locked]);
  useEffect(() => {
    document.documentElement.dataset.mertelMode = snapshot.mode;
    return () => { delete document.documentElement.dataset.mertelMode; };
  }, [snapshot.mode]);
  const blocked = async () => { throw new Error('Usa Salir de simulación para volver a la sesión real.'); };
  // The local display identity never carries the authenticated access token.
  const visibleIdentity = snapshot.mode === 'SIMULATION' ? { ...identity, user: snapshot.display, accessToken: null, roles: snapshot.display.roles,
    permissions: snapshot.display.permissions, initializing: false, login: blocked, logout: locked ? value.exit : blocked,
    refreshIdentity: async () => snapshot.display, acceptSession: blocked, clearSession: blocked } : identity;
  return <SimulationContext.Provider value={value}><AuthContext.Provider value={visibleIdentity}>
    <Fragment key={snapshot.epoch}>{ready && !closing ? children : <p role="status">Preparando datos de demostración…</p>}</Fragment>
  </AuthContext.Provider></SimulationContext.Provider>;
}
