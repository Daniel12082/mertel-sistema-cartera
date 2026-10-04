function duration(value, fallback, maximum, name) {
  const match = String(value ?? fallback).match(/^([1-9]\d*)(s|m|h|d)$/);
  if (!match) throw new Error(`Configuración inválida: ${name}`);
  const seconds = Number(match[1]) * { s: 1, m: 60, h: 3600, d: 86400 }[match[2]];
  if (!Number.isSafeInteger(seconds) || seconds > maximum) throw new Error(`Configuración inválida: ${name}`);
  return seconds;
}
function integer(value, fallback, min, max, name) {
  const text = String(value ?? fallback);
  const number = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`Configuración inválida: ${name}`);
  }
  return number;
}
export function loadAuthConfig(env = process.env) {
  if (env.NODE_ENV !== undefined && !["development", "test", "production"].includes(env.NODE_ENV)) {
    throw new Error("NODE_ENV debe ser development, test o production");
  }
  if (typeof env.JWT_SECRET !== "string" || Buffer.byteLength(env.JWT_SECRET) < 32) {
    throw new Error("JWT_SECRET es obligatorio y debe contener al menos 32 bytes aleatorios");
  }
  const production = env.NODE_ENV === "production";
  // Missing NODE_ENV follows Node's existing local-development convention.
  // Test and production still require explicit origins and cookie policy.
  const development = env.NODE_ENV === undefined || env.NODE_ENV === "development";
  const origins = String(env.FRONTEND_URL ?? (development ? "http://localhost:5173" : "")).split(",").map(value => value.trim()).filter(Boolean);
  if (!origins.length) throw new Error("FRONTEND_URL debe definir al menos un origen explícito");
  for (const origin of origins) {
    let url;
    try { url = new URL(origin); } catch { throw new Error("FRONTEND_URL contiene un origen inválido"); }
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin || (production && url.protocol !== "https:")) {
      throw new Error("FRONTEND_URL debe contener orígenes exactos; HTTPS en producción");
    }
  }
  if (production && (origins.length !== 1 || origins[0] !== "https://mertelimportaciones.com")) {
    throw new Error("FRONTEND_URL en producción debe ser únicamente https://mertelimportaciones.com");
  }
  const sameSite = (env.AUTH_COOKIE_SAME_SITE ?? (development ? "lax" : undefined))?.trim().toLowerCase();
  if (!["lax", "strict", "none"].includes(sameSite)) {
    throw new Error("AUTH_COOKIE_SAME_SITE es obligatorio y debe ser lax, strict o none");
  }
  if (sameSite === "none" && !production) {
    throw new Error("AUTH_COOKIE_SAME_SITE=none requiere Secure; solo se admite con NODE_ENV=production");
  }
  const issuer = env.JWT_ISSUER ?? "mertel-api";
  const audience = env.JWT_AUDIENCE ?? "mertel-access";
  if (!issuer.trim() || !audience.trim()) throw new Error("JWT_ISSUER y JWT_AUDIENCE deben estar definidos");
  return Object.freeze({
    secret: env.JWT_SECRET, issuer, audience, origins: Object.freeze(origins),
    accessSeconds: duration(env.JWT_ACCESS_EXPIRES_IN, "15m", 3600, "JWT_ACCESS_EXPIRES_IN"),
    refreshSeconds: duration(env.AUTH_REFRESH_EXPIRES_IN, "7d", 90 * 86400, "AUTH_REFRESH_EXPIRES_IN"),
    cookieName: "mertel_refresh",
    cookieOptions: Object.freeze({ httpOnly: true, secure: production, sameSite, path: "/api/auth" }),
    rateWindowMs: integer(env.AUTH_RATE_LIMIT_WINDOW_MS, 900000, 1000, 86400000, "AUTH_RATE_LIMIT_WINDOW_MS"),
    rateMax: integer(env.AUTH_RATE_LIMIT_MAX, 10, 1, 10000, "AUTH_RATE_LIMIT_MAX"),
    trustProxyHops: integer(env.TRUST_PROXY_HOPS, 0, 0, 10, "TRUST_PROXY_HOPS"),
  });
}
