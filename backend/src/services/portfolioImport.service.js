import { createHash } from "node:crypto";
import pool from "../config/database.js";
import { parseMertelPortfolioXlsx } from "./mertelPortfolioXlsxParser.js";

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 10000;
const MAX_COLUMNS = 200;
const MAX_ERRORS = 500;

export function parseCsv(buffer) {
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/, ""); }
  catch { throw Object.assign(new Error("El archivo no contiene texto UTF-8 válido"), { status: 400, code: "INVALID_ENCODING" }); }
  const records = []; let row = []; let field = ""; let quoted = false; let afterQuote = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') { quoted = false; afterQuote = true; }
      else field += char;
      continue;
    }
    if (afterQuote && char !== "," && char !== "\r" && char !== "\n") throw Object.assign(new Error("Estructura CSV inválida"), { status: 400, code: "INVALID_CSV" });
    if (char === '"' && field === "" && !afterQuote) quoted = true;
    else if (char === ",") { row.push(field); field = ""; afterQuote = false; }
    else if (char === "\r" || char === "\n") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.length > MAX_COLUMNS) throw Object.assign(new Error("El archivo supera el máximo de columnas permitido"), { status: 400, code: "TOO_MANY_COLUMNS" });
      records.push(row); row = []; field = ""; afterQuote = false;
      if (records.length > MAX_ROWS + 1) throw Object.assign(new Error("El archivo supera el máximo de filas permitido"), { status: 400, code: "TOO_MANY_ROWS" });
    } else { if (char === '"') throw Object.assign(new Error("Estructura CSV inválida"), { status: 400, code: "INVALID_CSV" }); field += char; }
    if (row.length > MAX_COLUMNS) throw Object.assign(new Error("El archivo supera el máximo de columnas permitido"), { status: 400, code: "TOO_MANY_COLUMNS" });
  }
  if (quoted) throw Object.assign(new Error("El archivo termina con una comilla CSV sin cerrar"), { status: 400, code: "INVALID_CSV" });
  if (field !== "" || row.length || (text && !/[\r\n]$/.test(text))) {
    row.push(field);
    if (row.length > MAX_COLUMNS) throw Object.assign(new Error("El archivo supera el máximo de columnas permitido"), { status: 400, code: "TOO_MANY_COLUMNS" });
    records.push(row);
    if (records.length > MAX_ROWS + 1) throw Object.assign(new Error("El archivo supera el máximo de filas permitido"), { status: 400, code: "TOO_MANY_ROWS" });
  }
  if (!records.length || records.every(record => record.every(value => value.trim() === ""))) throw Object.assign(new Error("El archivo está vacío"), { status: 400, code: "EMPTY_FILE" });
  return records;
}

function inspectRecords(records) {
  const issues = [];
  const add = (row_number, field_name, error_code, message, severity = "error") => {
    if (issues.length < MAX_ERRORS) issues.push({ row_number, field_name, error_code, message, severity });
  };
  const headerIndex = records.findIndex(record => record.some(value => value.trim() !== ""));
  const sourceHeaders = records[headerIndex].map(value => value.trim());
  const headers = sourceHeaders.map(value => value.slice(0, 255));
  if (!headers.length || headers.every(value => !value)) add(headerIndex + 1, null, "INVALID_STRUCTURE", "No se detectaron encabezados", "error");
  const seen = new Set();
  headers.forEach((header, index) => {
    if (sourceHeaders[index].length > 255) add(headerIndex + 1, String(index + 1), "HEADER_TOO_LONG", "El encabezado supera 255 caracteres");
    if (!header) add(headerIndex + 1, String(index + 1), "EMPTY_HEADER", "Se detectó un encabezado vacío");
    else if (seen.has(header.toLowerCase())) add(headerIndex + 1, header, "DUPLICATE_HEADER", "Se detectó un encabezado repetido");
    seen.add(header.toLowerCase());
  });
  const rows = records.slice(headerIndex + 1);
  const preview = [];
  let emptyRows = 0; let validRows = 0; let invalidRows = 0;
  if (!rows.length) add(headerIndex + 1, null, "NO_DATA_ROWS", "No se detectaron filas de datos");
  rows.forEach((values, index) => {
    const rowNumber = headerIndex + index + 2;
    if (values.every(value => value.trim() === "")) { emptyRows += 1; add(rowNumber, null, "EMPTY_ROW", "Fila vacía", "warning"); return; }
    if (values.length !== headers.length) { invalidRows += 1; add(rowNumber, null, "RAGGED_ROW", "La cantidad de celdas no coincide con los encabezados"); }
    else validRows += 1;
    if (preview.length < 10) preview.push(values.slice(0, headers.length).map(value => value.slice(0, 300)));
  });
  return { headers, total_rows: rows.length, empty_rows: emptyRows, successful_rows: validRows, failed_rows: invalidRows, preview, issues };
}

function safeFileName(name) {
  const base = String(name || "").replaceAll("\\", "/").split("/").at(-1).trim();
  if (!base || base.length > 255 || /[\u0000-\u001f\u007f]/.test(base)) throw Object.assign(new Error("Nombre de archivo inválido"), { status: 400 });
  return base;
}

async function companyIsActive(db, companyId) {
  const [rows] = await db.query("SELECT id FROM companies WHERE id=? AND status='active' AND deleted_at IS NULL", [companyId]);
  return rows.length > 0;
}

export async function analyzePortfolioFile({ scope, actorId, fileName: suppliedName, mimeType, bytes, ipAddress = null, userAgent = null }) {
  if (!scope?.companyId) throw Object.assign(new Error("El contexto MERTEL no está disponible"), { status: 403 });
  if (!(bytes instanceof Buffer) || bytes.length === 0) throw Object.assign(new Error("Selecciona un archivo CSV o XLSX no vacío"), { status: 400 });
  if (bytes.length > MAX_IMPORT_BYTES) throw Object.assign(new Error("El archivo supera el límite de 2 MiB"), { status: 413 });
  const fileName = safeFileName(suppliedName);
  const normalizedMime = String(mimeType || "").toLowerCase();
  const extension = fileName.split(".").at(-1).toLowerCase();
  let analysis; let storedFileType;
  if (extension === "csv" && ["text/csv", "application/csv", "application/vnd.ms-excel"].includes(normalizedMime)) {
    analysis = inspectRecords(parseCsv(bytes)); storedFileType = "text/csv";
  } else if (extension === "xlsx" && normalizedMime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    analysis = await parseMertelPortfolioXlsx(bytes); storedFileType = "xlsx";
  } else {
    throw Object.assign(new Error("Solo se aceptan archivos .csv UTF-8 o .xlsx de cartera MERTEL con su tipo MIME correspondiente"), { status: 400, code: "UNSUPPORTED_FILE" });
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  const db = await pool.getConnection();
  const lockName = `mertel_import_${createHash("sha256").update(String(scope.companyId)).digest("hex").slice(0, 32)}`;
  let locked = false;
  try {
    if (!(await companyIsActive(db, scope.companyId))) throw Object.assign(new Error("Empresa no disponible"), { status: 404 });
    const [[lock]] = await db.query("SELECT GET_LOCK(?, 10) AS acquired", [lockName]);
    if (lock.acquired !== 1) throw Object.assign(new Error("Ya hay un análisis en curso para esta empresa"), { status: 409 });
    locked = true;
    const [existing] = await db.query("SELECT id,status,created_at FROM import_batches WHERE company_id=? AND file_sha256=? ORDER BY id DESC LIMIT 1", [scope.companyId, digest]);
    if (existing.length) {
      const duplicate = existing[0];
      await db.query("INSERT INTO audit_logs (company_id,user_id,action,entity_type,entity_id,new_values,ip_address,user_agent) VALUES (?,?,'duplicate_attempt','import_batch',?,?,?,?)",
        [scope.companyId, actorId, duplicate.id, JSON.stringify({ file_sha256: digest }), ipAddress, userAgent?.slice(0, 500) || null]);
      return { ...analysis, batch_id: String(duplicate.id), status: duplicate.status, duplicate: true, file: { name: fileName, size_bytes: bytes.length, sha256: digest }, format_configured: extension === "xlsx" };
    }
    await db.beginTransaction();
    try {
      const [insert] = await db.query("INSERT INTO import_batches(company_id,user_id,file_name,file_type,total_rows,processed_rows,successful_rows,failed_rows,status,started_at,completed_at,file_sha256) VALUES (?,?,?,?,?,?,?,?, 'analyzed_unconfigured',NOW(),NOW(),?)",
        [scope.companyId, actorId, fileName, storedFileType, analysis.total_rows, analysis.total_rows, analysis.successful_rows, analysis.failed_rows, digest]);
      for (const issue of analysis.issues.filter(item => item.severity === "error")) await db.query("INSERT INTO import_errors(import_batch_id,`row_number`,field_name,field_value,error_code,error_message) VALUES (?,?,?,NULL,?,?)",
        [insert.insertId, issue.row_number, issue.field_name?.slice(0, 100) || null, issue.error_code, issue.message]);
      await db.query("INSERT INTO audit_logs (company_id,user_id,action,entity_type,entity_id,new_values,ip_address,user_agent) VALUES (?,?,'analyzed','import_batch',?,?,?,?)",
        [scope.companyId, actorId, insert.insertId, JSON.stringify({ status: "analyzed_unconfigured", file_sha256: digest, total_rows: analysis.total_rows, successful_rows: analysis.successful_rows, failed_rows: analysis.failed_rows }), ipAddress, userAgent?.slice(0, 500) || null]);
      await db.commit();
      return { ...analysis, batch_id: String(insert.insertId), status: "analyzed_unconfigured", duplicate: false,
        file: { name: fileName, size_bytes: bytes.length, sha256: digest }, format_configured: extension === "xlsx" };
    } catch (error) { await db.rollback(); throw error; }
  } finally {
    if (locked) await db.query("SELECT RELEASE_LOCK(?)", [lockName]);
    db.release();
  }
}

export async function listPortfolioImports(scope) {
  if (!scope?.companyId) throw Object.assign(new Error("El contexto MERTEL no está disponible"), { status: 403 });
  const [companies] = await pool.query("SELECT id FROM companies WHERE id=? AND status='active' AND deleted_at IS NULL", [scope.companyId]);
  if (!companies.length) throw Object.assign(new Error("Empresa no disponible"), { status: 404 });
  const [rows] = await pool.query("SELECT b.id,b.file_name,b.file_type,b.total_rows,b.successful_rows,b.failed_rows,b.status,b.created_at,b.user_id,u.first_name,COUNT(e.id) AS error_count FROM import_batches b LEFT JOIN users u ON u.id=b.user_id LEFT JOIN import_errors e ON e.import_batch_id=b.id WHERE b.company_id=? GROUP BY b.id,b.file_name,b.file_type,b.total_rows,b.successful_rows,b.failed_rows,b.status,b.created_at,b.user_id,u.first_name ORDER BY b.id DESC LIMIT 50", [scope.companyId]);
  return rows.map(row => ({ ...row, id: String(row.id), user_id: row.user_id == null ? null : String(row.user_id), error_count: Number(row.error_count) }));
}
