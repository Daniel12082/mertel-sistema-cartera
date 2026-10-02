import pool from "../config/database.js";
const userColumns = `CAST(id AS CHAR) AS id, CAST(company_id AS CHAR) AS company_id,
  first_name, last_name, email, status, deleted_at`;
export async function findUserByEmail(email, db = pool) {
  const [rows] = await db.query(`SELECT ${userColumns}, password_hash FROM users WHERE email = ? LIMIT 1`, [email]);
  return rows[0] ?? null;
}
export async function findUserById(id, db = pool, lock = false, includeHash = false) {
  const [rows] = await db.query(`SELECT ${userColumns}${includeHash ? ", password_hash" : ""}
    FROM users WHERE id = ? LIMIT 1 ${lock ? "FOR UPDATE" : ""}`, [id]);
  return rows[0] ?? null;
}
export function isActiveUser(user) { return Boolean(user && user.status === "active" && user.deleted_at === null); }
export async function publicUser(user, db = pool) {
  const [roles] = await db.query(`SELECT CAST(r.id AS CHAR) AS id, r.name FROM roles r
    INNER JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ? ORDER BY r.id`, [user.id]);
  return { id: user.id, email: user.email, name: [user.first_name, user.last_name].filter(Boolean).join(" "), company_id: user.company_id, roles };
}
export async function findRefreshSession(hash, db = pool, lock = false) {
  const [rows] = await db.query(`SELECT CAST(id AS CHAR) AS id, CAST(user_id AS CHAR) AS user_id,
    family_id, token_hash, expires_at, revoked_at, expires_at > UTC_TIMESTAMP(3) AS unexpired
    FROM auth_refresh_sessions WHERE token_hash = ? LIMIT 1 ${lock ? "FOR UPDATE" : ""}`, [hash]);
  return rows[0] ?? null;
}
export async function insertRefreshSession(userId, familyId, hash, expiresAt, db) {
  // UTC strings avoid dependence on the host/driver timezone.
  const expiration = expiresAt instanceof Date ? expiresAt.toISOString().slice(0, 23).replace("T", " ") : expiresAt;
  await db.query(`INSERT INTO auth_refresh_sessions (user_id, family_id, token_hash, expires_at)
    VALUES (?, ?, ?, ?)`, [userId, familyId, hash, expiration]);
}
export async function revokeRefreshFamily(familyId, db) {
  await db.query(`UPDATE auth_refresh_sessions SET revoked_at = UTC_TIMESTAMP(3)
    WHERE family_id = ? AND revoked_at IS NULL`, [familyId]);
}
export async function auditAuth(action, user = null, ip = null, db = pool) {
  // Never store request bodies, headers, email attempts, cookies or tokens.
  await db.query(`INSERT INTO audit_logs (company_id, user_id, entity_type, entity_id, action, ip_address)
    VALUES (?, ?, 'auth', ?, ?, ?)`, [user?.company_id ?? null, user?.id ?? null, user?.id ?? null, action, ip?.slice(0, 45) ?? null]);
}
