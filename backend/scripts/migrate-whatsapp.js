import 'dotenv/config';
import pool from '../src/config/database.js';
import { applyWhatsAppMigration } from '../src/services/whatsappMigration.service.js';
const db = await pool.getConnection();
try { console.log(JSON.stringify(await applyWhatsAppMigration(db))); }
catch { console.error('No se pudo aplicar la migración WhatsApp. Revisa el esquema y la conexión.'); process.exitCode = 1; }
finally { db.release(); await pool.end(); }
