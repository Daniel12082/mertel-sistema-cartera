import dotenv from "dotenv";
import mysql from "mysql2/promise";
import { provisionMertelCompany } from "../src/services/mertelCompany.service.js";

dotenv.config({ path: new URL("../.env", import.meta.url), quiet: true });
let db;
try {
  db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  const { company, created } = await provisionMertelCompany(db);
  console.log(JSON.stringify({ created, id: company.id, name: company.name, status: company.status }));
} catch (error) {
  console.error(error.code || error.sql ? "No se pudo provisionar MERTEL; revisa la conexión y el esquema." : error.message);
  process.exitCode = 1;
} finally { if (db) await db.end(); }
