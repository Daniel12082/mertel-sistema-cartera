import ExcelJS from "exceljs";

export const MERTEL_SHEET_NAME = "cartera de clientes NIIF0";
export const MERTEL_COLUMNS = Object.freeze([
  "Cobrador", "Nit Cliente", "Nombre cliente", "Rep Legal", "Direccion", "Ciudad", "Departamento",
  "Telefono", "Celular", "Cupo", "Numero", "Movimiento", "Emitida", "Vence", "Días Emitida",
  "días Vencida", "Corriente", "1-30 días", "30-45 días", "45-60 días", "60-90 días", "+90 días",
  "Valor doc.", "IVA", "Observaciones", "Vendedor", "Zona",
]);
const CORE_HEADERS = ["nit cliente", "numero", "movimiento", "emitida"];
const MAX_ROWS = 10_000;
const MAX_COLUMNS = 200;
const MAX_ERRORS = 500;
const MOVEMENTS = Object.freeze({
  "012 factura de venta credito": "invoice",
  "023 devolucion de clientes": "return",
  "014 nota debito cliente": "debit_note",
});

const error = (message, code = "INVALID_XLSX") => Object.assign(new Error(message), { status: 400, code });
const empty = value => value == null || String(value).trim() === "";
const normalizedHeader = value => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
const textValue = value => {
  if (value == null) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
  }
  if (typeof value === "object") {
    if (Array.isArray(value.richText)) return value.richText.map(part => part.text ?? "").join("");
    if ("text" in value) return String(value.text ?? "");
    if ("result" in value) return textValue(value.result);
    return "";
  }
  return String(value).trim();
};

export function normalizeMertelNit(value) {
  const original = textValue(value);
  const normalized = original.normalize("NFKC").replace(/\D/g, "");
  return { original, normalized };
}

export function parseMertelAmount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const source = textValue(value).replace(/\s/g, "").replace(/[^\d,.-]/g, "");
  if (!source || !/\d/.test(source)) return null;
  const comma = source.lastIndexOf(","); const dot = source.lastIndexOf(".");
  let numeric = source;
  if (comma >= 0 && dot >= 0) {
    numeric = comma > dot ? source.replace(/\./g, "").replace(",", ".") : source.replace(/,/g, "");
  } else if (comma >= 0) {
    numeric = /,\d{1,2}$/.test(source) ? source.replace(",", ".") : source.replace(/,/g, "");
  } else if (dot >= 0 && !/\.\d{1,2}$/.test(source)) numeric = source.replace(/\./g, "");
  const amount = Number(numeric);
  return Number.isFinite(amount) ? amount : null;
}

function parseBusinessDate(value) {
  const raw = textValue(value);
  if (!raw) return null;
  let year; let month; let day;
  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dmy) [, day, month, year] = dmy;
  else if (iso) [, year, month, day] = iso;
  else return null;
  const y = Number(year); const m = Number(month); const d = Number(day);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function reportDate(value) {
  const raw = textValue(value);
  const match = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return match ? parseBusinessDate(`${match[1]}/${match[2]}/${match[3]}`) : null;
}

function classifyWorksheet(sheet) {
  let headerRow = 0;
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const values = sheet.getRow(rowNumber).values.slice(1).map(normalizedHeader);
    if (CORE_HEADERS.every(header => values.includes(header))) { headerRow = rowNumber; break; }
  }
  if (!headerRow) throw error(`No se encontró el encabezado MERTEL (${CORE_HEADERS.join(", ")}) en la hoja ${MERTEL_SHEET_NAME}`, "MISSING_HEADER");
  const rawHeaders = sheet.getRow(headerRow).values.slice(1, sheet.columnCount + 1).map(textValue);
  if (rawHeaders.length > MAX_COLUMNS) throw error("El archivo supera el máximo de columnas permitido", "TOO_MANY_COLUMNS");
  const headerMap = new Map();
  rawHeaders.forEach((header, index) => {
    const key = normalizedHeader(header);
    if (key && !headerMap.has(key)) headerMap.set(key, index);
  });
  const missing = MERTEL_COLUMNS.filter(header => !headerMap.has(normalizedHeader(header)));
  const duplicateHeaders = rawHeaders.filter((header, index) => header && rawHeaders.slice(0, index).some(previous => normalizedHeader(previous) === normalizedHeader(header)));
  return { headerRow, rawHeaders, headerMap, missing, duplicateHeaders };
}

export async function parseMertelPortfolioXlsx(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw error("El archivo no es un libro XLSX válido", "INVALID_XLSX");
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(bytes); }
  catch { throw error("No se pudo leer el libro XLSX", "INVALID_XLSX"); }
  const sheetNames = workbook.worksheets.map(sheet => sheet.name);
  const sheet = workbook.getWorksheet(MERTEL_SHEET_NAME);
  if (!sheet) throw error(`Falta la hoja requerida «${MERTEL_SHEET_NAME}»`, "MISSING_SHEET");
  if (sheet.columnCount > MAX_COLUMNS) throw error("El archivo supera el máximo de columnas permitido", "TOO_MANY_COLUMNS");
  const { headerRow, rawHeaders, headerMap, missing, duplicateHeaders } = classifyWorksheet(sheet);
  const issues = [];
  const rowsWithErrors = new Set();
  const addIssue = (row_number, field_name, error_code, message, severity = "error") => {
    if (severity === "error" && row_number > headerRow) rowsWithErrors.add(row_number);
    if (issues.length < MAX_ERRORS) issues.push({ row_number, field_name: field_name || null, error_code, message, severity });
  };
  missing.forEach(name => addIssue(headerRow, name, "MISSING_COLUMN", `Falta la columna requerida «${name}»`));
  duplicateHeaders.forEach(name => addIssue(headerRow, name, "DUPLICATE_HEADER", `La columna «${name}» está repetida`));

  const cell = (row, name) => {
    const index = headerMap.get(normalizedHeader(name));
    return index == null ? "" : row.getCell(index + 1).value;
  };
  const counts = { document_rows: 0, customer_summary_rows: 0, report_summary_rows: 0, empty_rows: 0, invalid_rows: 0,
    clients_detected: 0, unique_documents: 0, invoices: 0, returns: 0, debit_notes: 0, unknown_movements: 0, duplicate_documents: 0 };
  const nits = new Set(); const documentKeys = new Set(); const seenDocuments = new Set();
  const preview = []; const documents = []; const maxPreview = 25;
  const rowTotal = Math.max(0, sheet.rowCount - headerRow);
  if (rowTotal > MAX_ROWS) throw error("El archivo supera el máximo de filas permitido", "TOO_MANY_ROWS");
  if (!rowTotal) addIssue(headerRow, null, "NO_DATA_ROWS", "No se detectaron filas después del encabezado");
  for (let rowIndex = headerRow + 1; rowIndex <= sheet.rowCount; rowIndex += 1) {
    const row = sheet.getRow(rowIndex);
    const source = Object.fromEntries(MERTEL_COLUMNS.map(name => [name, textValue(cell(row, name))]));
    const isEmpty = Object.values(source).every(empty);
    if (isEmpty) { counts.empty_rows += 1; continue; }
    const nit = normalizeMertelNit(source["Nit Cliente"]);
    if (nit.normalized) nits.add(nit.normalized);
    const number = source.Numero.trim(); const movement = source.Movimiento.trim();
    const emitted = parseBusinessDate(source.Emitida); const due = parseBusinessDate(source.Vence);
    const looksLikeDocument = Boolean(number || movement || source.Emitida.trim() || source.Vence.trim());
    const reportLabel = source.Cobrador.trim().toUpperCase();
    let rowType; let movementType = null;

    if (!looksLikeDocument && !nit.normalized && ["PORCENTAJE", "T O T A L"].some(label => reportLabel.startsWith(label))) {
      rowType = "REPORT_SUMMARY"; counts.report_summary_rows += 1;
    } else if (!looksLikeDocument && nit.normalized) {
      rowType = "CUSTOMER_SUMMARY"; counts.customer_summary_rows += 1;
    } else if (looksLikeDocument) {
      const requiredMissing = [];
      if (!nit.normalized) requiredMissing.push("Nit Cliente");
      if (!number) requiredMissing.push("Numero");
      if (!movement) requiredMissing.push("Movimiento");
      if (!source.Emitida.trim()) requiredMissing.push("Emitida");
      if (requiredMissing.length) {
        rowType = "INVALID"; counts.invalid_rows += 1;
        requiredMissing.forEach(field => addIssue(rowIndex, field, field === "Nit Cliente" ? "MISSING_CUSTOMER_NIT" : field === "Numero" ? "MISSING_DOCUMENT_NUMBER" : field === "Movimiento" ? "MISSING_MOVEMENT" : "MISSING_ISSUE_DATE", `Documento sin el campo requerido «${field}»`));
      } else {
        rowType = "DOCUMENT"; counts.document_rows += 1;
        const keyMovement = normalizedHeader(movement);
        movementType = MOVEMENTS[keyMovement] || "unknown";
        if (movementType === "invoice") counts.invoices += 1;
        else if (movementType === "return") counts.returns += 1;
        else if (movementType === "debit_note") counts.debit_notes += 1;
        else { counts.unknown_movements += 1; addIssue(rowIndex, "Movimiento", "UNKNOWN_MOVEMENT", `Movimiento desconocido: ${movement}`); }
        const key = [nit.normalized, number, movement, emitted].join("|");
        documentKeys.add(key);
        if (seenDocuments.has(key)) { counts.duplicate_documents += 1; addIssue(rowIndex, "Numero", "DUPLICATE_DOCUMENT", "Documento repetido según NIT, número, movimiento y fecha; no se elimina", "warning"); }
        else seenDocuments.add(key);
        if (!due && movementType === "invoice") addIssue(rowIndex, "Vence", source.Vence.trim() ? "INVALID_DUE_DATE" : "MISSING_DUE_DATE", source.Vence.trim() ? "Fecha de vencimiento inválida" : "Factura sin fecha de vencimiento");
        if (!emitted) addIssue(rowIndex, "Emitida", "INVALID_ISSUE_DATE", "Fecha de emisión inválida");
        if (parseMertelAmount(source["Valor doc."]) == null) addIssue(rowIndex, "Valor doc.", "INVALID_DOCUMENT_VALUE", "Valor de documento vacío o no numérico");
        if (parseMertelAmount(source.IVA) == null) addIssue(rowIndex, "IVA", "INVALID_IVA", "IVA vacío o no numérico");
      }
    } else {
      const hasCustomerName = !empty(source["Nombre cliente"]);
      if (hasCustomerName && !nit.normalized) {
        rowType = "INVALID"; counts.invalid_rows += 1;
        addIssue(rowIndex, "Nit Cliente", "MISSING_CUSTOMER_NIT", "Fila de cliente sin NIT");
      } else {
        rowType = "INVALID"; counts.invalid_rows += 1;
        addIssue(rowIndex, null, "UNCLASSIFIED_ROW", "Fila no vacía sin identidad de cliente, documento o marcador de total del reporte");
      }
    }

    if (rowType === "DOCUMENT" || (rowType === "INVALID" && looksLikeDocument)) documents.push({ row_number: rowIndex, type: rowType, movement_type: movementType,
      customer_nit_original: nit.original, customer_nit_normalized: nit.normalized, document_number: number || null,
      movement, issue_date: emitted, due_date: due, document_value: parseMertelAmount(source["Valor doc."]), iva: parseMertelAmount(source.IVA), values: source });
    const originalCupo = source.Cupo;
    const cupoAmount = parseMertelAmount(originalCupo);
    const cupoCondition = cupoAmount == null ? originalCupo.trim() : originalCupo.replace(/[-+]?\d[\d.,]*/, "").trim();
    if (preview.length < maxPreview) preview.push({ row_number: rowIndex, type: rowType, movement_type: movementType,
      customer_nit_original: nit.original, customer_nit_normalized: nit.normalized, document_number: number || null,
      movement, issue_date: emitted, due_date: due, document_value: parseMertelAmount(source["Valor doc."]), iva: parseMertelAmount(source.IVA),
      cupo_amount: cupoAmount, cupo_condition: cupoCondition || null, values: source });
  }
  counts.clients_detected = nits.size;
  counts.unique_documents = documentKeys.size;
  const reportMeta = workbook.getWorksheet(MERTEL_SHEET_NAME);
  const companyName = textValue(reportMeta.getRow(1).getCell(27).value);
  const companyTaxText = textValue(reportMeta.getRow(2).getCell(27).value);
  const companyNit = companyTaxText.match(/NIT:\s*(.+)$/i)?.[1]?.trim() || "";
  const reportTitle = textValue(reportMeta.getRow(3).getCell(1).value);
  if (companyName.trim().toUpperCase() !== "MERTEL IMPORTACIONES S.A.S.") {
    addIssue(1, "Empresa", "SOURCE_COMPANY_MISMATCH", "El reporte no identifica a MERTEL IMPORTACIONES S.A.S.");
  }
  const sourceNit = normalizeMertelNit(companyNit).normalized;
  if (sourceNit !== "9004997448") addIssue(2, "NIT empresa", "SOURCE_NIT_MISMATCH", "El NIT del reporte no coincide con MERTEL IMPORTACIONES S.A.S. (900.499.744-8)");
  const failedRows = [...rowsWithErrors].filter(rowNumber => rowNumber > headerRow && rowNumber <= sheet.rowCount).length;
  const classificationSuccess = Math.max(0, rowTotal - counts.empty_rows - failedRows);
  return {
    format: "mertel_xlsx", sheet_names: sheetNames, selected_sheet: MERTEL_SHEET_NAME,
    report: { company_name: companyName, company_nit: companyNit, report_date: reportDate(reportTitle), title: reportTitle },
    headers: rawHeaders, missing_columns: missing, total_rows: rowTotal,
    empty_rows: counts.empty_rows, successful_rows: classificationSuccess, failed_rows: failedRows,
    classifications: { document_rows: counts.document_rows, customer_summary_rows: counts.customer_summary_rows,
      report_summary_rows: counts.report_summary_rows, summary_rows: counts.customer_summary_rows + counts.report_summary_rows,
      empty_rows: counts.empty_rows, invalid_rows: counts.invalid_rows },
    summary: { ...counts }, preview, documents, issues,
  };
}
