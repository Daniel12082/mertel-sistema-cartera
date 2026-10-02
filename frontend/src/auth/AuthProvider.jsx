import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AuthContext } from "./auth.context";
import { getAuthenticatedUser } from "../services/auth.service";
import { acceptSession, clearSession, getSession, loginSession, logoutSession,
  refreshSession, subscribeSession, updateIdentity } from "../services/api";

export default function AuthProvider({ children }) {
  const session = useSyncExternalStore(subscribeSession, getSession);
  const [initializing, setInitializing] = useState(true);
  useEffect(() => {
    let active = true;
    refreshSession().catch(() => {}).finally(() => { if (active) setInitializing(false); });
    return () => { active = false; };
  }, []);
  const refreshIdentity = useCallback(async () => {
    const identity = getSession()?.user.id;
    if (!identity) return null;
    const user = await getAuthenticatedUser();
    if (getSession()?.user.id !== identity) return null;
    updateIdentity(user);
    return user;
  }, []);
  const value = useMemo(() => ({ user: session?.user ?? null, accessToken: session?.accessToken ?? null,
    roles: session?.user.roles ?? [], permissions: session?.user.permissions ?? [],
    initializing, login: loginSession, logout: logoutSession,
    acceptSession, clearSession, refreshIdentity }), [session, initializing, refreshIdentity]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
