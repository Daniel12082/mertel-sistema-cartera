import 'dotenv/config';
import pool from '../src/config/database.js';
import {applyCollectionResultsMigration} from '../src/services/collectionResultsMigration.service.js';
const db = await pool.getConnection();
try { console.log(JSON.stringify(await applyCollectionResultsMigration(db))); }
catch { console.error('No se pudo aplicar la migración de resultados de gestión. Revisa la conexión y el esquema.'); process.exitCode=1; }
finally { db.release(); await pool.end(); }
