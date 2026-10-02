import { createHash } from "node:crypto";
import { hashPassword } from "../utils/password.js";

// Solo para CLI interna. No se expone mediante HTTP ni acepta contraseñas por ENV/argumentos.
export async function provisionFirstAdmin(db, { email, passwordProvider }) {
  const [[{ databaseName }]] = await db.query("SELECT DATABASE() AS databaseName");
  if (!databaseName) throw new Error("Selecciona una base de datos antes del provisioning");
  const lockName = `mertel_admin_${createHash("sha256").update(databaseName).digest("hex").slice(0, 32)}`;
  const [[{ acquired }]] = await db.query("SELECT GET_LOCK(?, 10) AS acquired", [lockName]);
  if (acquired !== 1) throw new Error("Otro provisioning está en curso; vuelve a intentarlo");
  let transaction = false;
  let password;
  try {
    const [existing] = await db.query(`SELECT CAST(u.id AS CHAR) AS id, u.username, u.email, u.status
      FROM users u INNER JOIN user_roles ur ON ur.user_id=u.id INNER JOIN roles r ON r.id=ur.role_id
      WHERE r.name='admin' ORDER BY u.id LIMIT 1`);
    if (existing.length) return { created: false, user: existing[0], role: "admin" };
    const [reserved] = await db.query("SELECT id FROM users WHERE username='admin' LIMIT 1");
    if (reserved.length) throw new Error("El username admin ya está ocupado; requiere revisión interna");
    if (typeof email !== "string" || email.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new Error("Se requiere el email real del propietario");
    const [taken] = await db.query("SELECT id FROM users WHERE email=? LIMIT 1", [email.trim()]);
    if (taken.length) throw new Error("El email ya está registrado; no se modifica ese usuario");
    const [roles] = await db.query("SELECT CAST(id AS CHAR) AS id FROM roles WHERE name='admin'");
    if (roles.length !== 1) throw new Error("Debe existir exactamente el rol admin antes del provisioning");
    if (typeof passwordProvider !== "function") throw new Error("La contraseña debe introducirse de forma segura en tiempo de ejecución");
    password = await passwordProvider();
    const passwordHash = await hashPassword(password);
    password = undefined;
    await db.beginTransaction(); transaction = true;
    await db.query("INSERT INTO users (username, first_name, email, password_hash, status) VALUES ('admin', 'Admin', ?, ?, 'active')", [email.trim(), passwordHash]);
    const [[{ userId }]] = await db.query("SELECT CAST(LAST_INSERT_ID() AS CHAR) AS userId");
    await db.query("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [userId, roles[0].id]);
    const [[user]] = await db.query("SELECT CAST(id AS CHAR) AS id, username, email, status FROM users WHERE id=?", [userId]);
    await db.commit(); transaction = false;
    return { created: true, user, role: "admin" };
  } catch (error) {
    if (transaction) await db.rollback();
    // Los errores de SQL pueden contener valores del INSERT: nunca propagarlos a la CLI.
    if (error.code || error.sql) throw new Error("No se pudo provisionar admin; la transacción fue revertida");
    throw error;
  } finally {
    password = undefined;
    await db.query("SELECT RELEASE_LOCK(?)", [lockName]);
  }
}
