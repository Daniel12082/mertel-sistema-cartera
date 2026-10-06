import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, MAX_IMPORT_BYTES } from "../src/services/portfolioImport.service.js";
import { normalizeMertelNit, parseMertelAmount, parseMertelPortfolioXlsx } from "../src/services/mertelPortfolioXlsxParser.js";
import { makeMertelWorkbook, mertelRow, MERTEL_FIXTURE_COLUMNS } from "./fixtures/mertelPortfolioWorkbook.js";
import { PERMISSIONS, ROLE_PERMISSIONS, permissionsForRoles } from "../src/config/permissions.js";

describe("portfolio import structure analysis", () => {
  test("parses UTF-8 CSV quoting, escaped quotes and line breaks structurally", () => {
    assert.deepEqual(parseCsv(Buffer.from('Nombre,Nota\r\n"Cliente, S.A.","Línea 1\nLínea ""2"""\r\n', "utf8")), [
      ["Nombre", "Nota"], ["Cliente, S.A.", 'Línea 1\nLínea "2"'],
    ]);
  });
  test("rejects empty, invalid UTF-8 and malformed CSV safely", () => {
    for (const [input, code] of [[Buffer.alloc(0), "EMPTY_FILE"], [Buffer.from([0xff]), "INVALID_ENCODING"], [Buffer.from('a,b\n"x,y\n'), "INVALID_CSV"]]) {
      assert.throws(() => parseCsv(input), error => error.code === code && error.status === 400);
    }
  });
  test("bounds row and column counts and records oversized headers as structural errors", () => {
    assert.throws(() => parseCsv(Buffer.from(`${Array(202).fill("x").join(",")}\n`)), error => error.code === "TOO_MANY_COLUMNS");
    assert.throws(() => parseCsv(Buffer.from(`h\n${"x\n".repeat(10002)}`)), error => error.code === "TOO_MANY_ROWS");
  });
  test("keeps the upload bounded and grants the dedicated permission only to admin", () => {
    assert.equal(MAX_IMPORT_BYTES, 2 * 1024 * 1024);
    assert.ok(PERMISSIONS.some(permission => permission.name === "portfolio.import" && permission.implemented));
    assert.ok(permissionsForRoles([{ name: "admin" }]).includes("portfolio.import"));
    assert.equal(ROLE_PERMISSIONS.supervisor.includes("portfolio.import"), false);
    assert.equal(ROLE_PERMISSIONS.collector.includes("portfolio.import"), false);
    assert.equal(permissionsForRoles([{ name: "collector" }]).includes("portfolio.import"), false);
  });

  test("reads the MERTEL sheet after report rows and distinguishes documents, customer summaries, report totals and blanks", async () => {
    const invoice = mertelRow();
    const duplicateInvoice = mertelRow();
    const returnRow = mertelRow({ Numero: "DVC-0000013835", Movimiento: "023 Devolucion de clientes", Emitida: "01/10/2026", Vence: "01/10/2026", "Valor doc.": "-165,065", IVA: "26,355" });
    const debitNote = mertelRow({ Numero: "NDC-0000000003", Movimiento: "014 Nota debito cliente" });
    const unknownMovement = mertelRow({ Numero: "DOC-OTRO", Movimiento: "999 Movimiento pendiente" });
    const invalidDocument = mertelRow({ "Nit Cliente": "", Numero: "", Movimiento: "012 Factura de venta credito" });
    const customerSummary = mertelRow({ Numero: "", Movimiento: "", Emitida: "", Vence: "", "Valor doc.": "", IVA: "" });
    const buffer = await makeMertelWorkbook({ rows: [invoice, duplicateInvoice, returnRow, debitNote, unknownMovement, invalidDocument, customerSummary, [],
      mertelRow({ Cobrador: "T O T A L   G E N E R A L", "Nit Cliente": "", "Nombre cliente": "", Numero: "", Movimiento: "", Emitida: "", Vence: "" }),
      mertelRow({ Cobrador: "Porcentaje", "Nit Cliente": "", "Nombre cliente": "", Numero: "", Movimiento: "", Emitida: "", Vence: "" })] });
    const result = await parseMertelPortfolioXlsx(buffer);
    assert.equal(result.format, "mertel_xlsx");
    assert.equal(result.selected_sheet, "cartera de clientes NIIF0");
    assert.deepEqual(result.report, { company_name: "MERTEL IMPORTACIONES S.A.S.", company_nit: "900.499.744-8", report_date: "2026-10-06", title: "CARTERA DE CLIENTES DEL 06/10/2026" });
    assert.deepEqual(result.classifications, { document_rows: 5, customer_summary_rows: 1, report_summary_rows: 2, summary_rows: 3, empty_rows: 1, invalid_rows: 1 });
    assert.equal(result.summary.clients_detected, 1);
    assert.equal(result.summary.unique_documents, 4);
    assert.equal(result.summary.invoices, 2);
    assert.equal(result.summary.returns, 1);
    assert.equal(result.summary.debit_notes, 1);
    assert.equal(result.summary.unknown_movements, 1);
    assert.equal(result.summary.duplicate_documents, 1);
    assert.ok(result.issues.some(issue => issue.error_code === "DUPLICATE_DOCUMENT" && issue.severity === "warning"));
    assert.ok(result.issues.some(issue => issue.error_code === "UNKNOWN_MOVEMENT"));
    assert.equal(result.preview[0].issue_date, "2026-10-06");
    assert.equal(result.preview[0].cupo_amount, 10000000);
    assert.equal(result.preview[0].cupo_condition, "compartido");
    assert.equal(result.preview[2].movement_type, "return");
    assert.equal(result.preview[3].movement_type, "debit_note");
  });

  test("validates the expected sheet, company identity, date fields, amounts, headers and file signature", async () => {
    const wrongCompany = await parseMertelPortfolioXlsx(await makeMertelWorkbook({ company: "OTRA EMPRESA", nit: "111.222.333-4", rows: [mertelRow({ Vence: "31/02/2026", "Valor doc.": "invalido", IVA: "" })] }));
    assert.ok(wrongCompany.issues.some(issue => issue.error_code === "SOURCE_COMPANY_MISMATCH"));
    assert.ok(wrongCompany.issues.some(issue => issue.error_code === "SOURCE_NIT_MISMATCH"));
    assert.ok(wrongCompany.issues.some(issue => issue.error_code === "INVALID_DUE_DATE"));
    assert.ok(wrongCompany.issues.some(issue => issue.error_code === "INVALID_DOCUMENT_VALUE"));
    assert.ok(wrongCompany.issues.some(issue => issue.error_code === "INVALID_IVA"));
    const missingColumn = await parseMertelPortfolioXlsx(await makeMertelWorkbook({ columns: MERTEL_FIXTURE_COLUMNS.filter(column => column !== "Zona"), rows: [mertelRow()] }));
    assert.ok(missingColumn.issues.some(issue => issue.error_code === "MISSING_COLUMN" && issue.field_name === "Zona"));
    await assert.rejects(parseMertelPortfolioXlsx(Buffer.from("not an xlsx")), error => error.code === "INVALID_XLSX" && error.status === 400);
    await assert.rejects(parseMertelPortfolioXlsx(await makeMertelWorkbook({ sheetName: "Hoja1", rows: [mertelRow()] })), error => error.code === "MISSING_SHEET");
    assert.deepEqual(normalizeMertelNit("  800.001.269-0  "), { original: "800.001.269-0", normalized: "8000012690" });
    assert.equal(parseMertelAmount("10,000,000.00 compartido"), 10000000);
    assert.equal(parseMertelAmount("-165.065,25"), -165065.25);
  });
});
