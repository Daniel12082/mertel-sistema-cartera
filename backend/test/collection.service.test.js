import test from "node:test";
import assert from "node:assert/strict";
import { buildCollectionResult } from "../src/services/collection.service.js";

const referenceDate = "2026-10-02";
const company = { id: "7" };
const customers = [{ id: 1, company_id: "7", name: "Cliente A", nit: "NIT-A", status: "active" }];
const rules = [
  { key: "two_days_before", active: true, days_before_due: 2 },
  { key: "overdue", active: true, condition: "overdue" },
];
function invoice(invoice_id, due_date, balance, extra = {}) {
  return { invoice_id, company_id: "7", customer_id: 1, invoice_number: `F-${invoice_id}`, due_date, balance, ...extra };
}

test("groups a customer's invoices once and separates outstanding from eligible balance", () => {
  const result = buildCollectionResult({ company, referenceDate, customers, rules, invoices: [
    invoice(1, "2026-10-04", "10.00"), invoice(2, "2026-09-30", "20.00"), invoice(3, null, "30.00"),
  ] });
  assert.equal(result.reference_date, referenceDate);
  assert.equal(result.summary.total_customers, 1);
  assert.equal(result.summary.total_balance, "60.00");
  assert.equal(result.summary.eligible_balance, "30.00");
  assert.equal(result.customers.length, 1);
  assert.equal(result.customers[0].total_balance, "60.00");
  assert.equal(result.customers[0].eligible_balance, "30.00");
  assert.equal(result.customers[0].stage, "overdue");
  assert.equal(result.customers[0].main_invoice.invoice.invoice_id, 2);
  assert.equal(result.customers[0].invoices.length, 3);
  assert.equal(result.customers[0].invoices.find(item => item.invoice.invoice_id === 3).stage, "no_eligible");
});

test("keeps engine primary-invoice tie break and customer/stage read filters", () => {
  const invoices = [invoice(8, "2026-10-01", "40.00"), invoice(3, "2026-10-01", "40.00")];
  const result = buildCollectionResult({ company, referenceDate, customers, rules: [{ key: "overdue", active: true, priority: 1 }], invoices });
  assert.equal(result.customers[0].main_invoice.invoice.invoice_id, 3);
  assert.deepEqual(buildCollectionResult({ company, referenceDate, customers, rules, invoices, filters: { stage: "overdue", customerId: 99 } }).customers, []);
});

test("zero balances are excluded from pending balances and invoice classifications", () => {
  const result = buildCollectionResult({ company, referenceDate, customers, rules, invoices: [
    invoice(1, "2026-09-30", "10.00"), invoice(2, "2026-09-30", "0.00"),
  ] });
  assert.equal(result.summary.total_balance, "10.00");
  assert.equal(result.customers[0].invoices.length, 1);
});

test("reports missing company rules explicitly without inventing a stage", () => {
  const result = buildCollectionResult({ company, referenceDate, customers, rules: [], invoices: [invoice(1, "2026-09-30", "25.00")] });
  assert.equal(result.status, "no_rules_configured");
  assert.equal(result.rules_configured, false);
  assert.match(result.message, /No hay reglas/);
  assert.equal(result.summary.total_balance, "25.00");
  assert.equal(result.summary.eligible_balance, "0.00");
  assert.deepEqual(result.customers, []);
});

test("leaves the source invoice balance unchanged", () => {
  const source = invoice(1, "2026-09-30", "25.00");
  const before = structuredClone(source);
  buildCollectionResult({ company, referenceDate, customers, rules, invoices: [source] });
  assert.deepEqual(source, before);
});

test("attaches only the latest pending promise for its customer to the pipeline card", () => {
  const result = buildCollectionResult({ company, referenceDate, customers, rules, invoices: [invoice(1, "2026-09-30", "25.00")], pendingPromises: [
    { id: 10, customer_id: 1, status: "fulfilled", promised_date: "2026-10-09", promised_amount: "99.00" },
    { id: 9, customer_id: 1, status: "pending", promised_date: "2026-10-08", promised_amount: "10.00" },
    { id: 8, customer_id: 1, status: "pending", promised_date: "2026-10-07", promised_amount: "5.00" },
  ] });
  assert.equal(result.customers.length, 1);
  assert.equal(result.customers[0].current_promise.id, 9);
  assert.equal(result.customers[0].current_promise.status, "pending");
});
