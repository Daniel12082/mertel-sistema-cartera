import test from "node:test";
import assert from "node:assert/strict";
import { makeMertelWorkbook, mertelRow } from "./fixtures/mertelPortfolioWorkbook.js";
import { parseMertelPortfolioXlsx } from "../src/services/mertelPortfolioXlsxParser.js";
import { buildPortfolioPipeline } from "../src/services/portfolioPipeline.service.js";

const companyId = "7"; const referenceDate = "2026-10-06";
const rules = { version: 2, commercial_policy: "mertel_phase_5", stage_order: ["overdue", "due_today", "days_before_due", "prompt_payment"],
  rules: [{ key: "overdue", active: true }, { key: "due_today", active: true }, { key: "five_days_before_due", active: true, condition: { type: "days_before_due", days: 5 } }, { key: "prompt_payment", active: true, condition: "days_since_issue" }],
  prompt_payment: { window: { day_type: "calendar", include_issue_date: true, include_day_ten: true } } };
async function build(rows) {
  const parsed = await parseMertelPortfolioXlsx(await makeMertelWorkbook({ rows }));
  return buildPortfolioPipeline({ parsed, referenceDate, fileName: "fixture.xlsx", processedAt: "2026-10-06T12:00:00.000Z", companyId, rules });
}

test("reuses parser, explicit reference date and engine classifications for all four stages", async () => {
  const data = await build([
    mertelRow({ Numero: "OVERDUE", Emitida: "01/09/2026", Vence: "01/10/2026", Corriente: "", "60-90 días": "200", "Valor doc.": "500" }),
    mertelRow({ "Nit Cliente": "800002001", Numero: "TODAY", Emitida: "01/10/2026", Vence: "06/10/2026", Corriente: "200" }),
    mertelRow({ "Nit Cliente": "800002002", Numero: "FIVE", Emitida: "01/10/2026", Vence: "11/10/2026", Corriente: "200" }),
    mertelRow({ "Nit Cliente": "800002000", Numero: "PROMPT", Emitida: "01/10/2026", Vence: "21/11/2026", Corriente: "200" }),
  ]);
  assert.equal(data.source.reference_date, referenceDate);
  assert.deepEqual([data.summary.overdue, data.summary.due_today, data.summary.due_in_five_days, data.summary.prompt_payment], [1, 1, 1, 1]);
  assert.equal(data.pipeline.find(item => item.stage === "prompt_payment").main_invoice.prompt_payment.eligibility.status, "manual_review");
});

test("groups several invoices under one NIT and the engine chooses the overdue main document", async () => {
  const data = await build([
    mertelRow({ Numero: "FUTURE", Vence: "21/11/2026" }),
    mertelRow({ Numero: "OLD", Emitida: "01/08/2026", Vence: "01/09/2026", Corriente: "", "60-90 días": "300" }),
  ]);
  assert.equal(data.pipeline.length, 1); assert.equal(data.pipeline[0].invoices.length, 2);
  assert.equal(data.pipeline[0].main_invoice.invoice.invoice_number, "OLD");
});

test("aging buckets determine balance, while return and debit note remain informational", async () => {
  const data = await build([
    mertelRow({ Numero: "INV", Corriente: "100", "60-90 días": "25", "Valor doc.": "500" }),
    mertelRow({ Numero: "RETURN", Movimiento: "023 Devolucion de clientes", "Valor doc.": "-50" }),
    mertelRow({ Numero: "DEBIT", Movimiento: "014 Nota debito cliente", "Valor doc.": "50" }),
  ]);
  assert.equal(data.pipeline[0].total_balance, "125.00");
  assert.equal(data.pipeline[0].documents.filter(item => item.movement_type !== "invoice").length, 2);
  assert.equal(data.informational_documents, 2); assert.equal(data.metadata.document_value_used_as_balance, false);
});

test("bad aging and duplicate invoices become row errors while other valid records continue", async () => {
  const data = await build([
    mertelRow({ Numero: "DUP", Corriente: "100" }), mertelRow({ Numero: "DUP", Corriente: "100" }),
    mertelRow({ Numero: "BAD", Corriente: "texto" }), mertelRow({ "Nit Cliente": "800009999", Numero: "GOOD", Vence: "06/10/2026", Corriente: "50" }),
  ]);
  assert.equal(data.pipeline.length, 1); assert.equal(data.pipeline[0].stage, "due_today");
  assert.ok(data.errors.some(item => item.code === "DUPLICATE_DOCUMENT"));
  assert.ok(data.errors.some(item => item.code === "INVALID_AGING_BALANCE"));
});

test("invalid reference date and mismatched report identity are rejected", async () => {
  const parsed = await parseMertelPortfolioXlsx(await makeMertelWorkbook({ rows: [mertelRow()] }));
  assert.throws(() => buildPortfolioPipeline({ parsed, referenceDate: "06/10/2026", companyId, rules }), /reference_date/);
  const wrong = await parseMertelPortfolioXlsx(await makeMertelWorkbook({ rows: [mertelRow()], company: "OTRA EMPRESA" }));
  assert.throws(() => buildPortfolioPipeline({ parsed: wrong, referenceDate, companyId, rules }), /no identifica a MERTEL/);
});
