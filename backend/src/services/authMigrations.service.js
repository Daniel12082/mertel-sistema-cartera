import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

export async function applyAuthMigrations(db) {
  const [[{ databaseName }]] = await db.query("SELECT DATABASE() AS databaseName");
  if (!databaseName) throw new Error("Selecciona una base de datos para las migraciones");
  const lockName = `mertel_migrate_${createHash("sha256").update(databaseName).digest("hex").slice(0, 32)}`;
  const [[{ acquired }]] = await db.query("SELECT GET_LOCK(?, 10) AS acquired", [lockName]);
  if (acquired !== 1) throw new Error("Otra migración de auth está en curso");
  const results = [];
  try {
    const [tables] = await db.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('users','roles','user_roles')");
    if (tables.length !== 3) throw new Error("Faltan tablas base de usuarios/roles; no se ejecuta la migración 001");
    const [sessions] = await db.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='auth_refresh_sessions'");
    if (!sessions.length) {
      await db.query(await readFile(new URL("../../../database/migrations/004_auth_refresh_sessions.sql", import.meta.url), "utf8"));
      results.push({ migration: "004_auth_refresh_sessions.sql", applied: true });
    } else results.push({ migration: "004_auth_refresh_sessions.sql", applied: false });
    const [columns] = await db.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='username'");
    if (!columns.length) {
      await db.query(await readFile(new URL("../../../database/migrations/005_users_username.sql", import.meta.url), "utf8"));
      results.push({ migration: "005_users_username.sql", applied: true });
    } else results.push({ migration: "005_users_username.sql", applied: false });
    const [username] = await db.query("SELECT COLUMN_TYPE,IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='username'");
    const [indexes] = await db.query("SELECT COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND INDEX_NAME='uk_users_username' AND NON_UNIQUE=0");
    const [sessionColumns] = await db.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='auth_refresh_sessions'");
    const [sessionHash] = await db.query("SELECT COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='auth_refresh_sessions' AND INDEX_NAME='uk_auth_refresh_token_hash' AND NON_UNIQUE=0");
    const [sessionUser] = await db.query("SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='auth_refresh_sessions' AND COLUMN_NAME='user_id' AND REFERENCED_TABLE_NAME='users' AND REFERENCED_COLUMN_NAME='id'");
    if (username[0]?.COLUMN_TYPE !== "varchar(50)" || username[0]?.IS_NULLABLE !== "YES" || indexes.length !== 1 || indexes[0].COLUMN_NAME !== "username" ||
        !["id", "user_id", "family_id", "token_hash", "expires_at", "revoked_at", "created_at"].every(name => sessionColumns.some(column => column.COLUMN_NAME === name)) ||
        sessionHash.length !== 1 || sessionHash[0].COLUMN_NAME !== "token_hash" || sessionUser.length !== 1) throw new Error("El esquema de auth existente es incompatible; requiere revisión manual");
    return results;
  } finally { await db.query("SELECT RELEASE_LOCK(?)", [lockName]); }
}
