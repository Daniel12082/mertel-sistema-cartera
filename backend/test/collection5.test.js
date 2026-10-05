import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveCollectionPolicy } from "../src/services/collectionPolicy.js";
import { evaluatePromptPayment, calculatePromptPaymentDiscount, dateDay, dateFromDay } from "../src/services/promptPayment.service.js";
import { evaluateConditionalDiscount, representCollectionBenefits } from "../src/services/collectionBenefits.service.js";
import { buildCollectionResult } from "../src/services/collection.service.js";
import { evaluateCollectionInvoice } from "../src/services/collectionEngine.service.js";

const config = JSON.parse(await readFile(new URL("../config/mertel-collection-rules.json", import.meta.url), "utf8"));
const policy = resolveCollectionPolicy(config);
const invoice = extra => ({ id: 1, company_id: "7", customer_id: 1, invoice_number: "FIXTURE", issue_date: "2026-10-05", due_date: "2026-11-05", base_value: "1016.67", balance: "1190.00", ...extra });
const after = (date, days) => dateFromDay(dateDay(date) + days);
const prompt = (referenceDate, extra = {}, products = "eligible") => evaluatePromptPayment({ referenceDate, invoice: invoice(extra), policy: policy.promptPayment, products });

for (const day of [0, 1, 9, 10, 11]) test(`Pronto Pago elapsed day ${day} respects inclusive ten calendar days`, () => {
  const result = prompt(after("2026-10-05", day));
  assert.equal(result.eligibility.status, day <= 10 ? "eligible" : "not_eligible");
  assert.equal(result.window.end_date, "2026-10-15");
  assert.equal(result.discount.amount, null);
  assert.equal(result.discount.preview_amount, day <= 10 ? "31" : null);
});
test("Pronto Pago includes weekends and crosses month/year without timezone shifts", () => {
  for (const [issue, end] of [["2026-10-25", "2026-11-04"], ["2026-12-25", "2027-01-04"], ["2028-02-20", "2028-03-01"]]) {
    const result = prompt(end, { issue_date: issue }); assert.equal(result.eligibility.status, "eligible"); assert.equal(result.window.end_date, end);
  }
  assert.equal(prompt("2026-10-04").eligibility.status, "not_eligible");
});

for (const [base, expected] of [["48.00", "1"], ["50.00", "2"], ["1015.00", "30"], ["1016.50", "30"], ["1016.67", "31"], ["1.01", "0"], ["9999999999999.99", "300000000000"]]) test(`3% of ${base} rounds half-up to whole COP ${expected}`, () => {
  const result = calculatePromptPaymentDiscount(base); assert.equal(result.amount, expected); assert.equal(result.decimal_places, 0); assert.equal(result.currency, "COP");
});
test("invalid monetary precision is rejected instead of silently rounded", () => {
  for (const base of ["1.001", "-1.00", Infinity, "bad"]) assert.throws(() => calculatePromptPaymentDiscount(base));
});

for (const [description, vehicle_type] of [["PROMO 18", null], ["Alternador", "car"], ["Arranque", "car"], ["Motoventilador", "car"], ["Set piñón", "motorcycle"], ["Kit piñón-cadenas", "motorcycle"]]) test(`confirmed exclusion ${description} cannot receive Pronto Pago`, () => {
  const result = prompt("2026-10-15", {}, { complete: true, items: [{ description, vehicle_type }] });
  assert.equal(result.eligibility.status, "not_eligible"); assert.equal(result.discount.preview_amount, null);
});
test("actual promo_18 marker overrides a positive product assessment; absence is not eligibility", () => {
  assert.equal(prompt("2026-10-15", { promo_18: "18.00" }).eligibility.status, "not_eligible");
  assert.equal(prompt("2026-10-15", { promo_18: "0.00" }, "unknown").eligibility.status, "manual_review");
});
test("unknown/incomplete/mixed products require manual review and never invent a partial amount", () => {
  for (const products of ["unknown", "mixed", { complete: false, items: [] }, { complete: true, items: [{ description: "Producto desconocido" }] },
    { complete: true, items: [{ description: "Alternador", vehicle_type: "car" }, { description: "Otro producto", assessment: "eligible" }] }]) {
    const result = prompt("2026-10-15", {}, products); assert.equal(result.eligibility.status, "manual_review"); assert.equal(result.discount.preview_amount, null);
  }
  assert.equal(prompt("2026-10-15", {}, { complete: true, items: [{ description: "Producto revisado", assessment: "eligible" }] }).eligibility.status, "eligible");
});

for (const day of [59, 60, 69, 70, 71]) test(`conditioned 10% day ${day} evaluates 60–70 inclusive without applying money`, () => {
  const result = evaluateConditionalDiscount({ referenceDate: after("2026-10-05", day), invoice: invoice(), policy: policy.conditionalDiscount });
  assert.equal(result.eligibility.status, day >= 60 && day <= 70 ? "eligible" : "not_eligible"); assert.equal(result.discount.amount, null);
});
test("independent benefits can coexist as separate dated facts without an invented 13%", () => {
  const early = prompt("2026-10-15");
  const late = evaluateConditionalDiscount({ referenceDate: after("2026-10-05", 60), invoice: invoice(), policy: policy.conditionalDiscount });
  const result = representCollectionBenefits(early, late);
  assert.equal(result.prompt_payment_discount.eligibility.status, "eligible"); assert.equal(result.conditional_discount.eligibility.status, "eligible");
  assert.notEqual(early.reference_date, late.reference_date);
  assert.equal(result.combination.combined_percentage, null); assert.equal(result.combination.combined_amount, null);
  assert.equal(result.combination.status, "pending_financial_specification");
});
for (const days of [4, 5, 6]) test(`five-days stage is a calendar event only at ${days} days before due`, () => {
  const result = evaluateCollectionInvoice({ referenceDate: "2026-10-20", invoice: invoice({ due_date: after("2026-10-20", days) }), rules: config });
  assert.equal(result.stage, days === 5 ? "five_days_before_due" : "no_eligible");
});
test("pipeline hierarchy, oldest overdue and pending operating group retain one card per customer", () => {
  const source = [invoice({ id: 1, due_date: "2026-09-01" }), invoice({ id: 2, due_date: "2026-10-01" }), invoice({ id: 3, due_date: "2026-11-10", issue_date: "2026-09-01" }),
    invoice({ id: 4, customer_id: 2, due_date: "2026-11-10", issue_date: "2026-09-01" })];
  const before = structuredClone(source);
  const result = buildCollectionResult({ company: { id: "7" }, referenceDate: "2026-10-20", customers: [{ id: 1, company_id: "7" }, { id: 2, company_id: "7" }], invoices: source, rules: config });
  assert.equal(result.customers.length, 1); assert.equal(result.customers[0].main_invoice.invoice.id, 1);
  assert.equal(result.non_overdue_pending.total_invoices, 2); assert.equal(result.non_overdue_pending.customers.length, 1);
  assert.equal(result.non_overdue_pending.customers[0].customer.id, 2);
  assert.deepEqual(source, before);
  assert.equal(evaluateCollectionInvoice({ referenceDate: "2026-10-05", invoice: invoice({ due_date: "2026-10-05" }), rules: config }).stage, "due_today");
  assert.equal(evaluateCollectionInvoice({ referenceDate: "2026-10-05", invoice: invoice(), rules: config }).stage, "prompt_payment");
});
test("approved configuration cannot substitute business days, another stage order or another five-days window", () => {
  for (const change of [value => { value.prompt_payment.window.day_type = "business"; }, value => { value.rules[2].days_before_due = 6; }, value => { value.stage_order.reverse(); }]) {
    const value = structuredClone(config); change(value); assert.throws(() => resolveCollectionPolicy(value));
  }
});
