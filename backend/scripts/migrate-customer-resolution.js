import "dotenv/config";
import pool from "../src/config/database.js";
import { applyCustomerResolutionMigration } from "../src/services/portfolioImportMigration.service.js";

try { console.log(JSON.stringify(await applyCustomerResolutionMigration(pool))); }
catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await pool.end(); }
