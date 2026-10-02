import { createHash, randomBytes, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import pool from "../config/database.js";
import { auditAuth, findRefreshSession, findUserByLogin, findUserById, insertRefreshSession,
  isActiveUser, publicUser, revokeRefreshFamily } from "../models/auth.model.js";
import { verifyPassword } from "../utils/password.js";
const invalidCredentials = () => Object.assign(new Error("Credenciales inválidas"), { status: 401 });
const invalidSession = () => Object.assign(new Error("Sesión inválida o expirada"), { status: 401 });
export const refreshHash = token => createHash("sha256").update(token).digest("hex");
const validRefresh = token => typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
export function issueAccessToken(userId, config) {
  return jwt.sign({}, config.secret, { algorithm: "HS256", subject: String(userId),
    issuer: config.issuer, audience: config.audience, expiresIn: config.accessSeconds });
}
export function verifyAccessToken(token, config) {
  const claims = jwt.verify(token, config.secret, { algorithms: ["HS256"],
    issuer: config.issuer, audience: config.audience, maxAge: config.accessSeconds });
  if (typeof claims.sub !== "string" || !/^[1-9]\d{0,19}$/.test(claims.sub) ||
      BigInt(claims.sub) > 18446744073709551615n || !Number.isInteger(claims.iat) ||
      !Number.isInteger(claims.exp) || claims.exp <= claims.iat ||
      claims.exp - claims.iat > config.accessSeconds || claims.iat > Math.floor(Date.now() / 1000) + 5) throw invalidSession();
  return claims.sub;
}
async function tokenResponse(user, config, db) {
  return { access_token: issueAccessToken(user.id, config), token_type: "Bearer",
    expires_in: config.accessSeconds, user: await publicUser(user, db) };
}
export async function login(identifier, password, config, ip) {
  const candidate = await findUserByLogin(identifier);
  const matches = await verifyPassword(candidate?.password_hash, password);
  if (!matches || !isActiveUser(candidate)) {
    await auditAuth("login_failed", null, ip); throw invalidCredentials();
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const current = await findUserById(candidate.id, connection, true, true);
    if (!isActiveUser(current) || current.password_hash !== candidate.password_hash) {
      await auditAuth("login_failed", null, ip, connection);
      await connection.commit(); throw invalidCredentials();
    }
    const refreshToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + config.refreshSeconds * 1000);
    await insertRefreshSession(current.id, randomUUID(), refreshHash(refreshToken), expiresAt, connection);
    await connection.query("UPDATE users SET last_login_at = UTC_TIMESTAMP() WHERE id = ?", [current.id]);
    await auditAuth("login_success", current, ip, connection);
    const response = await tokenResponse(current, config, connection);
    await connection.commit(); return { response, refreshToken, expiresAt };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
export async function refresh(token, config, ip) {
  const hash = validRefresh(token) ? refreshHash(token) : null;
  const known = hash ? await findRefreshSession(hash) : null;
  if (!known) { await auditAuth("refresh_rejected", null, ip); throw invalidSession(); }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // Refresh/logout lock user before session to serialize rotations.
    const user = await findUserById(known.user_id, connection, true);
    const session = await findRefreshSession(hash, connection, true);
    if (!session || !session.unexpired || session.revoked_at !== null || !isActiveUser(user)) {
      if (session) await revokeRefreshFamily(session.family_id, connection);
      await auditAuth("refresh_rejected", user, ip, connection);
      await connection.commit(); throw invalidSession();
    }
    const refreshToken = randomBytes(32).toString("base64url");
    // Rotation preserves the original absolute expiration, in UTC.
    const [expiration] = await connection.query(
      "SELECT DATE_FORMAT(expires_at, '%Y-%m-%d %H:%i:%s.%f') AS utc_expiration FROM auth_refresh_sessions WHERE id = ?", [session.id]);
    const utcExpiration = expiration[0].utc_expiration.slice(0, 23);
    const expiresAt = new Date(utcExpiration.replace(" ", "T") + "Z");
    await connection.query("UPDATE auth_refresh_sessions SET revoked_at = UTC_TIMESTAMP(3) WHERE id = ?", [session.id]);
    await insertRefreshSession(user.id, session.family_id, refreshHash(refreshToken), utcExpiration, connection);
    const response = await tokenResponse(user, config, connection);
    await connection.commit(); return { response, refreshToken, expiresAt };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
export async function logout(token, ip) {
  const known = validRefresh(token) ? await findRefreshSession(refreshHash(token)) : null;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const user = known ? await findUserById(known.user_id, connection, true) : null;
    if (known) await revokeRefreshFamily(known.family_id, connection);
    await auditAuth("logout", user, ip, connection);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
