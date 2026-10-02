import dotenv from "dotenv";
import mysql from "mysql2/promise";
import { applyAuthMigrations } from "../src/services/authMigrations.service.js";
dotenv.config({ path: new URL("../.env", import.meta.url), quiet: true });
let db;
try {
  if (process.argv.length !== 2) throw new Error("Este comando no admite argumentos ni ejecuta otras migraciones");
  db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME, multipleStatements: true });
  for (const result of await applyAuthMigrations(db)) console.log(`${result.migration}: ${result.applied ? "aplicada" : "ya aplicada"}`);
} catch {
  console.error("No se completaron las migraciones de auth. Revisa el esquema y los permisos internos; una DDL previa puede haberse aplicado.");
  process.exitCode = 1;
} finally { if (db) await db.end(); }
