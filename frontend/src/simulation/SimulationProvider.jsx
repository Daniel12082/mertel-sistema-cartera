import { Fragment, useEffect, useMemo, useSyncExternalStore } from 'react';
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
  const value = useMemo(() => ({ ...snapshot,
    activate() { enterSimulation({ ...identity.user, permissions: identity.permissions, roles: identity.roles }); navigate('/', { replace: true, state: null }); },
    reset() { resetSimulation(); navigate('/', { replace: true, state: null }); },
    async exit() {
      if (!window.confirm('¿Salir del modo simulación?\nLos cambios realizados durante la demostración no se guardarán.')) return;
      leaveSimulation(); navigate('/', { replace: true, state: null });
      // Only after the mode is REAL may the existing cookie/session mechanism resume.
      await refreshSession().catch(() => {});
    },
  }), [snapshot, identity, navigate]);
  useEffect(() => {
    document.documentElement.dataset.mertelMode = snapshot.mode;
    return () => { delete document.documentElement.dataset.mertelMode; };
  }, [snapshot.mode]);
  const blocked = async () => { throw new Error('Usa Salir de simulación para volver a la sesión real.'); };
  // Display-only identity. No JWT/account is created and grants are never increased.
  const visibleIdentity = snapshot.mode === 'SIMULATION' ? { ...identity, user: snapshot.display, accessToken: null, roles: snapshot.display.roles,
    permissions: snapshot.display.permissions, initializing: false, login: blocked, logout: blocked,
    refreshIdentity: async () => snapshot.display, acceptSession: blocked, clearSession: blocked } : identity;
  return <SimulationContext.Provider value={value}><AuthContext.Provider value={visibleIdentity}>
    <Fragment key={snapshot.epoch}>{children}</Fragment>
  </AuthContext.Provider></SimulationContext.Provider>;
}
