import { useCallback, useMemo, useState } from "react";
import { AuthContext } from "./auth.context";
import { getAuthenticatedUser } from "../services/auth.service";

export default function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const acceptSession = useCallback(data => {
    setSession({ accessToken: data.access_token, user: data.user });
  }, []);
  const clearSession = useCallback(() => setSession(null), []);
  const refreshIdentity = useCallback(async () => {
    if (!session) return null;
    const user = await getAuthenticatedUser(session.accessToken);
    setSession(current => current?.accessToken === session.accessToken ? { ...current, user } : current);
    return user;
  }, [session]);
  const value = useMemo(() => ({ user: session?.user ?? null, accessToken: session?.accessToken ?? null,
    roles: session?.user.roles ?? [], permissions: session?.user.permissions ?? [],
    acceptSession, clearSession, refreshIdentity }), [session, acceptSession, clearSession, refreshIdentity]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
