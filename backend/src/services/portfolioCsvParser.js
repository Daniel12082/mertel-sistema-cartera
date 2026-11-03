const MAX_ROWS = 10000;
const MAX_COLUMNS = 200;

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
