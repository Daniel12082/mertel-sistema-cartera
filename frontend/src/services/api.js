import axios from "axios";

// Support the documented origin and existing configurations ending in /api.
const configuredOrigin = import.meta.env.VITE_API_URL?.trim();
if (import.meta.env.PROD && !configuredOrigin) throw new Error("VITE_API_URL es obligatorio en producción");
const origin = (configuredOrigin || "http://localhost:3000").replace(/\/+$/, "");
let apiUrl;
try { apiUrl = new URL(origin); }
catch { throw new Error("VITE_API_URL debe ser un origen HTTP/HTTPS válido, opcionalmente terminado en /api"); }
if (!["http:", "https:"].includes(apiUrl.protocol) || apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash ||
    !["/", "/api"].includes(apiUrl.pathname) || (import.meta.env.PROD && apiUrl.protocol !== "https:")) {
  throw new Error("VITE_API_URL debe ser un origen sin credenciales; HTTPS en producción y prefijo /api opcional");
}
const api = axios.create({
  baseURL: origin.endsWith("/api") ? origin : `${origin}/api`,
  withCredentials: true, timeout: 15000,
  headers: { "Content-Type": "application/json" },
});
let session = null;
let revision = 0;
let refreshPromise = null;
let logoutPromise = null;
let signingOut = false;
const listeners = new Set();
export function getSession() { return session; }
export function subscribeSession(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function acceptSession(data) {
  if (typeof data?.access_token !== "string" || !data?.user) throw new Error("Sesión inválida");
  session = { accessToken: data.access_token, user: data.user };
  listeners.forEach(listener => listener(session));
}
export function clearSession() {
  revision += 1;
  session = null;
  listeners.forEach(listener => listener(null));
}
export function updateIdentity(user) {
  if (session) acceptSession({ access_token: session.accessToken, user });
}
export function refreshSession() {
  if (signingOut) return Promise.reject(new Error("Sesión cerrándose"));
  if (!refreshPromise) {
    const startedAt = revision;
    refreshPromise = api.post("/auth/refresh", {}, { skipAuth: true }).then(({ data }) => {
      if (revision !== startedAt || signingOut) throw new Error("Sesión invalidada");
      acceptSession(data.data);
      return session;
    }).catch(error => {
      if (revision === startedAt) clearSession();
      throw error;
    }).finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}
export async function loginSession(email, password) {
  if (logoutPromise) await logoutPromise.catch(() => {});
  // Serialize cookie rotation with login so an older refresh cannot restore a session.
  if (refreshPromise) await refreshPromise.catch(() => {});
  const startedAt = ++revision;
  const { data } = await api.post("/auth/login", { email, password }, { skipAuth: true });
  if (revision !== startedAt || signingOut) throw new Error("Sesión invalidada");
  try {
    const response = await api.get("/auth/me", {
      skipAuth: true, headers: { Authorization: `Bearer ${data.data.access_token}` },
    });
    if (revision !== startedAt) throw new Error("Sesión invalidada");
    acceptSession({ ...data.data, user: response.data.data });
    return session;
  } catch (error) { clearSession(); throw error; }
}
export function logoutSession() {
  if (logoutPromise) return logoutPromise;
  signingOut = true;
  clearSession();
  logoutPromise = (async () => {
    try {
      if (refreshPromise) await refreshPromise.catch(() => {});
      await api.post("/auth/logout", {}, { skipAuth: true });
    } finally { clearSession(); signingOut = false; logoutPromise = null; }
  })();
  return logoutPromise;
}
api.interceptors.request.use(config => {
  if (!config.skipAuth) {
    config.sessionRevision = revision;
    if (session?.accessToken) config.headers.set("Authorization", `Bearer ${session.accessToken}`);
  }
  return config;
});
api.interceptors.response.use(response => response, async error => {
  const config = error.config;
  if (error.response?.status !== 401 || !config || config.skipAuth || signingOut ||
      config.sessionRevision !== revision || !session) throw error;
  if (config.authRetried) { clearSession(); throw error; }
  config.authRetried = true;
  if (config.headers.get("Authorization") === `Bearer ${session.accessToken}`) await refreshSession();
  if (!session || config.sessionRevision !== revision) throw error;
  return api(config);
});
// Sanitize only after refresh/retry has finished; callers may log Axios errors.
api.interceptors.response.use(undefined, error => {
  if (axios.isAxiosError(error)) {
    const redactConfig = config => {
      if (!config) return config;
      const safe = { ...config, headers: new axios.AxiosHeaders(config.headers) };
      safe.headers.delete("Authorization");
      safe.headers.delete("Cookie");
      delete safe.auth;
      delete safe.data;
      return safe;
    };
    error.config = redactConfig(error.config);
    if (error.response) error.response = { ...error.response, config: redactConfig(error.response.config) };
    error.request = undefined;
  }
  return Promise.reject(error);
});
export default api;
