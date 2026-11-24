import pool from "../config/database.js";
import { permissionsForRoles } from "../config/permissions.js";
import { companyContext } from "../utils/companyScope.js";
import { isSimulationAccount } from '../utils/simulationAccount.js';
const userColumns = `CAST(id AS CHAR) AS id, CAST(company_id AS CHAR) AS company_id,
  first_name, last_name, username, email, status, deleted_at`;
export async function findUserByLogin(identifier, db = pool) {
  const column = identifier.includes("@") ? "email" : "username";
  const [rows] = await db.query(`SELECT ${userColumns}, password_hash FROM users WHERE ${column} = ? LIMIT 1`, [identifier]);
  return rows[0] ?? null;
}
export async function findUserById(id, db = pool, lock = false, includeHash = false) {
  const [rows] = await db.query(`SELECT ${userColumns}${includeHash ? ", password_hash" : ""}
    FROM users WHERE id = ? LIMIT 1 ${lock ? "FOR UPDATE" : ""}`, [id]);
  return rows[0] ?? null;
}
export function isActiveUser(user) { return Boolean(user && user.status === "active" && user.deleted_at === null); }
export async function userRoles(userId, db = pool) {
  const [roles] = await db.query(`SELECT CAST(r.id AS CHAR) AS id, r.name FROM roles r
    INNER JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ? ORDER BY r.id`, [userId]);
  if (roles.some(role => /^custom_/.test(role.name))) {
    const [custom] = await db.query('SELECT CAST(cr.role_id AS CHAR) role_id,cr.label,cr.permissions FROM custom_roles cr JOIN users u ON u.company_id=cr.company_id JOIN user_roles ur ON ur.user_id=u.id AND ur.role_id=cr.role_id WHERE u.id=? AND cr.active=1',[userId]);
    for (const role of roles) {
      const entry=custom.find(row=>String(row.role_id)===String(role.id));
      if(entry)Object.assign(role,{custom:true,label:entry.label,permissions:typeof entry.permissions==='string'?JSON.parse(entry.permissions):entry.permissions});
    }
  }
  return roles;
}
export async function publicUser(user, db = pool) {
  const roles = user.roles ?? await userRoles(user.id, db);
  const simulationOnly = isSimulationAccount(roles);
  return { id: user.id, username: user.username, email: user.email, name: [user.first_name, user.last_name].filter(Boolean).join(" "),
    company_id: user.company_id, is_global_admin: companyContext({ ...user, roles }).globalAdmin,
    // Display grants open local screens only; middleware denies real API access.
    simulation_only: simulationOnly, roles, permissions: permissionsForRoles(simulationOnly ? [{ name: 'admin' }] : roles) };
}
export async function passwordVersion(userId,db=pool){
  const [[row]]=await db.query("SELECT new_values FROM audit_logs WHERE entity_type='user' AND entity_id=? AND action IN ('USER_PASSWORD_CHANGED','PASSWORD_RESET_COMPLETED') ORDER BY id DESC LIMIT 1",[userId]);
  const data=typeof row?.new_values==='string'?JSON.parse(row.new_values):row?.new_values;
  return data?.password_version??null;
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
