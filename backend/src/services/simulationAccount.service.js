import pool from '../config/database.js';
import { hashPassword } from '../utils/password.js';
import { findUserById, isActiveUser, userRoles } from '../models/auth.model.js';
import { validCompanyId } from '../utils/companyScope.js';
import { isSimulationAccount, SIMULATION_ROLE } from '../utils/simulationAccount.js';

export async function provisionSimulationAccount({ companyId, actorId, email, username, password }, dbPool = pool) {
  if (!validCompanyId(companyId) || !validCompanyId(actorId) ||
      typeof email !== 'string' || email.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      typeof username !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,49}$/.test(username) ||
      typeof password !== 'string' || !password || Buffer.byteLength(password) > 1024) throw new Error('Datos de la cuenta de demostración inválidos.');
  const hash = await hashPassword(password);
  const db = await dbPool.getConnection();
  try {
    await db.beginTransaction();
    // Serialize provisioning for this company; no existing account is converted.
    const [[company]] = await db.query("SELECT id FROM companies WHERE id=? AND status='active' AND deleted_at IS NULL FOR UPDATE", [companyId]);
    const actor = await findUserById(actorId, db, true), roles = await userRoles(actorId, db);
    if (!company || !isActiveUser(actor) || isSimulationAccount(roles) || !roles.some(role => role.name === 'admin') ||
        (actor.company_id !== null && String(actor.company_id) !== String(companyId))) throw new Error('Se requiere un administrador activo de MERTEL.');
    const [existing] = await db.query("SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.company_id=? AND r.name=? AND u.deleted_at IS NULL", [companyId, SIMULATION_ROLE]);
    if (existing.length) throw new Error('MERTEL ya tiene una cuenta exclusiva de simulación.');
    await db.query('INSERT INTO roles(name,description) VALUES (?,?) ON DUPLICATE KEY UPDATE name=name', [SIMULATION_ROLE, 'Cuenta exclusiva de demostración sin acceso operativo']);
    const [created] = await db.query("INSERT INTO users(company_id,first_name,last_name,username,email,password_hash,status) VALUES (?,'Presentación','MERTEL',?,?,?,'active')", [companyId, username, email, hash]);
    const id = String(created.insertId);
    await db.query('INSERT INTO user_roles(user_id,role_id) SELECT ?,id FROM roles WHERE name=?', [id, SIMULATION_ROLE]);
    await db.query("INSERT INTO audit_logs(company_id,user_id,entity_type,entity_id,action,new_values) VALUES (?,?,'user',?,'USER_CREATED',?)", [companyId, actorId, id, JSON.stringify({ username, email, simulation_only: true, roles: [SIMULATION_ROLE] })]);
    await db.commit();
    return { id, email, username, simulation_only: true };
  } catch (error) { await db.rollback(); throw error; }
  finally { db.release(); }
}
