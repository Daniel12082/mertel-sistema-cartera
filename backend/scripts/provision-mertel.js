import dotenv from "dotenv";
import mysql from "mysql2/promise";
import { provisionMertelCompany, provisionMertelCollectionRules } from "../src/services/mertelCompany.service.js";

dotenv.config({ path: new URL("../.env", import.meta.url), quiet: true });
let db;
try {
  db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  const rulesOnly=process.argv.includes('--collection-rules-only');
  if(process.argv.slice(2).some(argument=>argument!=='--collection-rules-only'))throw new Error('Opción de provisioning no reconocida.');
  const { company, created, configured } = rulesOnly ? await provisionMertelCollectionRules(db) : await provisionMertelCompany(db);
  console.log(JSON.stringify({ created, ...(rulesOnly?{configured,target:'collection_rules'}:{}), id: company.id, name: company.name, status: company.status }));
} catch (error) {
  console.error(error.code || error.sql ? "No se pudo provisionar MERTEL; revisa la conexión y el esquema." : error.message);
  process.exitCode = 1;
} finally { if (db) await db.end(); }
