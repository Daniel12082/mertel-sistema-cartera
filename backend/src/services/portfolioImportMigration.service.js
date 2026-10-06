import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

export async function applyPortfolioImportMigration(db) {
  const [[{ databaseName }]] = await db.query("SELECT DATABASE() AS databaseName");
  if (!databaseName) throw new Error("Selecciona una base de datos para la migración de importación");
  const lockName = `mertel_import_migrate_${createHash("sha256").update(databaseName).digest("hex").slice(0, 28)}`;
  const [[{ acquired }]] = await db.query("SELECT GET_LOCK(?, 10) AS acquired", [lockName]);
  if (acquired !== 1) throw new Error("Otra migración de importación está en curso");
  try {
    const [tables] = await db.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('import_batches','import_errors')");
    if (tables.length !== 2) throw new Error("Faltan las tablas base de importación; no se ejecuta la migración 001");
    const [columns] = await db.query("SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('import_batches','import_errors') AND ((TABLE_NAME='import_batches' AND COLUMN_NAME='file_sha256') OR (TABLE_NAME='import_errors' AND COLUMN_NAME='error_code'))");
    const [indexes] = await db.query("SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='import_batches' AND INDEX_NAME='idx_import_batches_company_sha256'");
    const hasHash = columns.some(column => column.TABLE_NAME === "import_batches" && column.COLUMN_NAME === "file_sha256");
    const hasCode = columns.some(column => column.TABLE_NAME === "import_errors" && column.COLUMN_NAME === "error_code");
    if (!hasHash && !hasCode && indexes.length === 0) {
      const migration = await readFile(new URL("../../../database/migrations/006_portfolio_import_analysis.sql", import.meta.url), "utf8");
      for (const statement of migration.split(";").map(part => part.trim()).filter(Boolean)) await db.query(statement);
    } else if (!(hasHash && hasCode && indexes.length)) throw new Error("El esquema de importación está incompleto o es incompatible; requiere revisión manual");
    return { migration: "006_portfolio_import_analysis.sql", applied: !(hasHash && hasCode && indexes.length) };
  } finally { await db.query("SELECT RELEASE_LOCK(?)", [lockName]); }
}
