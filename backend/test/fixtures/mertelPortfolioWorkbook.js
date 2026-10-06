import ExcelJS from "exceljs";

export const MERTEL_FIXTURE_COLUMNS = [
  "Cobrador", "Nit Cliente", "Nombre cliente", "Rep Legal", "Direccion", "Ciudad", "Departamento", "Telefono", "Celular", "Cupo",
  "Numero", "Movimiento", "Emitida", "Vence", "Días Emitida", "días Vencida", "Corriente", "1-30 días", "30-45 días", "45-60 días",
  "60-90 días", "+90 días", "Valor doc.", "IVA", "Observaciones", "Vendedor", "Zona",
];

export async function makeMertelWorkbook({ rows, columns = MERTEL_FIXTURE_COLUMNS, sheetName = "cartera de clientes NIIF0", company = "MERTEL IMPORTACIONES S.A.S.", nit = "900.499.744-8" } = {}) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.getCell("A1").value = "Fecha: 06/10/2026  14:16:16";
  sheet.getCell("AA1").value = company;
  sheet.getCell("AA2").value = `NIT: ${nit}`;
  sheet.getCell("A3").value = "CARTERA DE CLIENTES DEL 06/10/2026";
  sheet.getCell("A4").value = "FILTROS: CARTERA DETALLADA";
  sheet.addRow([]); sheet.addRow([]); sheet.addRow(columns);
  for (const row of rows || []) {
    const values = Object.fromEntries(MERTEL_FIXTURE_COLUMNS.map((column, index) => [column, Array.isArray(row) ? row[index] : row[column]]));
    sheet.addRow(columns.map(column => values[column] ?? ""));
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function mertelRow(overrides = {}) {
  const values = {
    "Cobrador": "COBRADOR PRUEBA", "Nit Cliente": "800.001.269-0", "Nombre cliente": "CLIENTE DEMOSTRACIÓN",
    "Rep Legal": "REPRESENTANTE", "Direccion": "DIRECCIÓN", "Ciudad": "BOGOTÁ", "Departamento": "CUNDINAMARCA",
    "Telefono": "6011234567", "Celular": "3001234567", "Cupo": "10,000,000.00 compartido", "Numero": "ME-12345",
    "Movimiento": "012 Factura de venta credito", "Emitida": "06/10/2026", "Vence": "21/11/2026", "Días Emitida": "0",
    "días Vencida": "", "Corriente": "3,482,310", "1-30 días": "", "30-45 días": "", "45-60 días": "", "60-90 días": "",
    "+90 días": "", "Valor doc.": "3,482,310", "IVA": "567,932", "Observaciones": "FACTURA CLIENTE POR MAYOR",
    "Vendedor": "VENDEDOR PRUEBA", "Zona": "ZONA PRUEBA", ...overrides,
  };
  return MERTEL_FIXTURE_COLUMNS.map(column => values[column] ?? "");
}
