import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildReconciliation } from "../src/services/portfolioReconciliation.service.js";
import { normalizeMertelNit } from "../src/services/mertelPortfolioXlsxParser.js";

const source = (overrides = {}) => ({ row_number: 8, type: "DOCUMENT", movement_type: "invoice", customer_nit_original: "800.001.269-0", customer_nit_normalized: "8000012690", document_number: "ME-1", movement: "012 Factura de venta credito", issue_date: "2026-09-01", due_date: "2026-10-01", document_value: 3482310, iva: 567932, values: { "Nombre cliente": "ABC", Direccion: "Cra 1", Ciudad: "Bogotá", Observaciones: "ok", Vendedor: "Venta", Cobrador: "Cobro", Zona: "Norte" }, ...overrides });
const invoice = (overrides = {}) => ({ id: 1, customer_id: 2, invoice_number: "ME-1", issue_date: "2026-09-01", due_date: "2026-10-01", document_value: "3482310.00", base_value: "2914378.00", iva_value: "567932.00", balance: "3482310.00", status: "pending", notes: "ok", nit: "800001269-0", name: "ABC", address: "Cra 1", city: "Bogotá", phone: null, ...overrides });
const parsed = documents => ({ report: { report_date: "2026-10-06" }, documents });

describe("MERTEL portfolio reconciliation (read only comparison model)", () => {
  test("normalizes numeric/text NIT punctuation consistently", () => {
    for (const value of ["800.001.269-0", "800001269-0", 8000012690, "8000012690"]) assert.equal(normalizeMertelNit(value).normalized, "8000012690");
    assert.equal(normalizeMertelNit("").normalized, "");
  });
  test("classifies new, updated, unchanged, disappeared, return and debit note exactly once", () => {
    const docs = [source({ row_number: 8, document_number: "NEW" }), source({ row_number: 9, issue_date: "2026-09-02", due_date: "2026-10-02" }), source({ row_number: 10, document_number: "ME-2" }),
      source({ row_number: 11, document_number: "RET", movement_type: "return", movement: "023 Devolucion de clientes" }),
      source({ row_number: 12, document_number: "DBT", movement_type: "debit_note", movement: "014 Nota debito cliente" })];
    const db = [invoice(), invoice({ id: 2, invoice_number: "ME-2" }), invoice({ id: 3, invoice_number: "MISSING" })];
    const result = buildReconciliation(parsed(docs), db);
    assert.deepEqual(result.results.map(item => item.category), ["NEW", "UPDATED", "UNCHANGED", "RETURN", "DEBIT_NOTE", "DISAPPEARED"]);
    assert.equal(result.summary.total, 6); assert.equal(result.summary.new, 1); assert.equal(result.summary.updated, 1);
    assert.equal(result.summary.unchanged, 1); assert.equal(result.summary.disappeared, 1);
    assert.equal(result.results[1].differences.some(item => item.field === "dueDate"), true);
    assert.equal(result.results.at(-1).document.balance, 3482310);
    assert.match(result.results.at(-1).reason, /no indica pago/);
  });
  test("detects duplicate keys, invalid NITs, unknown movements and ambiguous DB matches", () => {
    const duplicate = source(); const docs = [duplicate, { ...duplicate, row_number: 9 }, source({ row_number: 10, customer_nit_normalized: "", customer_nit_original: "" }),
      source({ row_number: 11, movement_type: "unknown", movement: "999 Otro" }), source({ row_number: 12, document_number: "AMB" })];
    const result = buildReconciliation(parsed(docs), [invoice(), invoice({ id: 3, invoice_number: "AMB" }), invoice({ id: 4, invoice_number: "AMB" })]);
    assert.deepEqual(result.results.map(item => item.category), ["DUPLICATE", "DUPLICATE", "ERROR", "ERROR", "ERROR"]);
    assert.deepEqual(result.results[0].duplicateSourceRows, [8, 9]);
    assert.match(result.results[2].reason, /NIT/); assert.match(result.results[3].reason, /Movimiento/); assert.match(result.results[4].reason, /ambigua/);
    const ambiguousCustomer = buildReconciliation(parsed([source()]), [invoice()], [
      { id: 2, nit: "800001269-0" }, { id: 3, nit: "800.001.269-0" },
    ]);
    assert.equal(ambiguousCustomer.results[0].category, "ERROR");
    assert.match(ambiguousCustomer.results[0].reason, /NIT ambiguo/);
  });
  test("compares money as cents without formatting false positives and does not mutate its inputs", () => {
    const before = JSON.stringify(invoice()); const current = invoice();
    const result = buildReconciliation(parsed([source()]), [current]);
    assert.equal(result.results[0].category, "UNCHANGED");
    assert.equal(JSON.stringify(current), before);
    assert.equal(result.metadata.readOnly, true);
  });
});
