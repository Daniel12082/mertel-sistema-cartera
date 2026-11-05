import { validateXlsxArchive } from "../utils/xlsxSecurity.js";
import ExcelJS from "exceljs";
import { parseMertelPortfolioWorkbook } from "./mertelPortfolioWorkbookParser.js";
export { MERTEL_SHEET_NAME, MERTEL_COLUMNS, normalizeMertelNit, parseMertelAmount } from "./mertelPortfolioWorkbookParser.js";

export async function parseMertelPortfolioXlsx(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw Object.assign(new Error("El archivo no es un libro XLSX válido"), { status: 400, code: "INVALID_XLSX" });
  validateXlsxArchive(bytes);
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(bytes); }
  catch { throw Object.assign(new Error("No se pudo leer el libro XLSX"), { status: 400, code: "INVALID_XLSX" }); }
  return parseMertelPortfolioWorkbook(workbook);
}
