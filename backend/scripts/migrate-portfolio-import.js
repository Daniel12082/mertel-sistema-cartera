import "dotenv/config";
import pool from "../src/config/database.js";
import { applyPortfolioImportMigration } from "../src/services/portfolioImportMigration.service.js";

try {
  console.log(JSON.stringify(await applyPortfolioImportMigration(pool)));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
