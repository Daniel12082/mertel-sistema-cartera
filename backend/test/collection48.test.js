import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCollectionCase, evaluateCollectionInvoice } from "../src/services/collectionEngine.service.js";
import { buildCollectionResult } from "../src/services/collection.service.js";
import { MERTEL_STAGE_ORDER, resolveCollectionPolicy } from "../src/services/collectionPolicy.js";
import { calculatePromptPaymentDiscount, evaluatePromptPayment } from "../src/services/promptPayment.service.js";

const referenceDate = "2026-10-05";
const customer = { id: 1, company_id: "7", name: "Fixture" };
const rules = [
  { key: "overdue", active: true }, { key: "due_today", active: true },
  { key: "five_days_before_due", active: true, days_before_due: 5 },
  { key: "prompt_payment", active: true, condition: "days_since_issue" },
];
const configuration = (window = {}) => ({ version: 2, stage_order: [...MERTEL_STAGE_ORDER], rules,
  prompt_payment: { window: { day_type: "pending", include_issue_date: null, include_day_ten: null, ...window } } });
// Explicit calendar/boundaries below are isolated test parameters, not approved MERTEL settings.
const calendarConfig = () => configuration({ day_type: "calendar", include_issue_date: true, include_day_ten: true });
const invoice = (id, dueDate, extra = {}) => ({ id, company_id: "7", customer_id: 1, invoice_number: `F-${id}`, issue_date: "2026-10-03", due_date: dueDate, base_value: "1000.00", document_value: "1190.00", balance: "1190.00", ...extra });
const evaluate = (invoices, config = configuration()) => evaluateCollectionCase({ referenceDate, customer, invoices, rules: config });
const response = (invoices, config = configuration(), customers = [customer]) => buildCollectionResult({ company: { id: "7" }, referenceDate, customers, invoices, rules: config });

test("one customer with multiple invoices uses oldest due date independently of balance and proximity", () => {
  const source = [invoice(8, "2026-10-04", { balance: "9999.00" }), invoice(9, "2026-08-01", { balance: "1.00" }), invoice(1, "2026-10-10")];
  const before = structuredClone(source);
  const result = response(source);
  assert.equal(result.customers.length, 1); assert.equal(result.customers[0].main_invoice.invoice.id, 9);
  assert.equal(result.customers[0].invoices.length, 3); assert.equal(result.customers[0].stage, "overdue");
  assert.deepEqual(source, before);
});
test("overdue beats future and one-invoice clients stay stable", () => {
  assert.equal(evaluate([invoice(2, "2026-10-10"), invoice(3, "2026-09-01")]).primaryInvoice.id, 3);
  assert.equal(evaluate([invoice(4, "2026-09-01")]).primaryInvoice.id, 4);
});
test("equal due dates use stable identifier, not greater debt", () => {
  const result = evaluate([invoice(9, "2026-09-01", { balance: "9000.00" }), invoice(2, "2026-09-01", { balance: "1.00" })]);
  assert.equal(result.primaryInvoice.id, 2);
});
test("future invoices of the same stage use identifier, not invented due-distance preference", () => {
  const result = evaluate([invoice(9, "2026-11-01"), invoice(2, "2026-12-01")], calendarConfig());
  assert.equal(result.primaryInvoice.id, 2); assert.equal(result.stage, "prompt_payment");
});
test("official relative hierarchy derives ordinal ranks instead of numeric commercial weights", () => {
  const config = calendarConfig();
  const stages = [invoice(1, "2026-09-01"), invoice(2, referenceDate), invoice(3, "2026-10-10"), invoice(4, "2026-11-01")]
    .map(item => evaluateCollectionInvoice({ referenceDate, invoice: item, rules: config }));
  assert.deepEqual(stages.map(item => item.stage), ["overdue", "due_today", "five_days_before_due", "prompt_payment"]);
  assert.deepEqual(stages.map(item => item.priority), [4, 3, 2, 1]);
  const legacy = rules.map(rule => ({ ...rule, priority: rule.key === "prompt_payment" ? 999 : -99 }));
  assert.equal(evaluate([invoice(3, referenceDate)], legacy).stage, "due_today");
});
test("stage order is configurable through configuration, never score magnitudes", () => {
  const config = calendarConfig(); config.stage_order = ["overdue", "prompt_payment", "due_today", "days_before_due"];
  const result = evaluateCollectionInvoice({ referenceDate, invoice: invoice(1, referenceDate), rules: config });
  assert.equal(result.stage, "prompt_payment"); assert.equal(result.priority, 3);
});
test("customer ordering comes from oldest main invoice and stage, not alphabetic name or balances", () => {
  const other = { ...customer, id: 2, name: "A first alphabetically" };
  const result = response([invoice(1, "2026-08-01"), invoice(2, "2026-10-04", { customer_id: 2 })], configuration(), [other, customer]);
  assert.deepEqual(result.customers.map(item => item.customer.id), [1, 2]);
  assert.equal(result.stage_catalog[0].label, "En mora");
});
test("pending day type and boundaries are explicit and never create prompt candidates", () => {
  const result = evaluateCollectionInvoice({ referenceDate, invoice: invoice(1, "2026-10-15"), rules: configuration() });
  assert.equal(result.eligible, false); assert.equal(result.promptPayment.window.status, "pending_configuration");
  assert.equal(result.promptPayment.window.days, 10); assert.equal(result.promptPayment.window.reference_basis, "issue_date");
  assert.deepEqual(result.stageCandidates, []); assert.match(response([invoice(1, "2026-10-15")]).configuration_warnings[0], /pendiente/);
});
test("legacy prompt_payment days_before_due does not restore the wrong commercial condition", () => {
  const result = evaluateCollectionInvoice({ referenceDate, invoice: invoice(1, "2026-10-15"), rules: [{ key: "prompt_payment", active: true, priority: 999, days_before_due: 10 }] });
  assert.equal(result.eligible, false); assert.equal(result.promptPayment.window.status, "pending_configuration");
});
test("configured window uses issue_date independently of due_date, promo_18 and conditioned discount", () => {
  const config = calendarConfig();
  const recent = evaluateCollectionInvoice({ referenceDate, invoice: invoice(1, "2027-01-01", { promo_18: "5000", discount: "10" }), rules: config });
  assert.equal(recent.stage, "prompt_payment");
  const expired = evaluateCollectionInvoice({ referenceDate, invoice: invoice(1, "2026-10-15", { issue_date: "2026-08-01", promo_18: "5000" }), rules: config });
  assert.equal(expired.eligible, false); assert.equal(expired.promptPayment.window.status, "outside_window");
  assert.equal(recent.promptPayment.percentage, "3"); assert.equal(recent.promptPayment.discount.amount, null);
});
test("window boundaries only execute when explicitly configured; future emission is outside", () => {
  const item = invoice(1, "2026-12-01", { issue_date: "2026-09-25" });
  const include = evaluatePromptPayment({ referenceDate, invoice: item, policy: resolveCollectionPolicy(calendarConfig()).promptPayment });
  assert.equal(include.window.status, "within_window");
  const exclude = configuration({ day_type: "calendar", include_issue_date: false, include_day_ten: false });
  assert.equal(evaluatePromptPayment({ referenceDate, invoice: item, policy: resolveCollectionPolicy(exclude).promptPayment }).window.status, "outside_window");
  assert.equal(evaluatePromptPayment({ referenceDate, invoice: { ...item, issue_date: "2026-10-06" }, policy: resolveCollectionPolicy(calendarConfig()).promptPayment }).window.status, "outside_window");
});
test("business days require explicit weekdays and holidays, without guessing a calendar", () => {
  const config = configuration({ day_type: "business", include_issue_date: true, include_day_ten: true });
  const assessed = () => evaluatePromptPayment({ referenceDate, invoice: invoice(1, "2026-12-01", { issue_date: "2026-09-19" }), policy: resolveCollectionPolicy(config).promptPayment });
  assert.equal(assessed().window.status, "pending_configuration");
  config.prompt_payment.window.calendar = { working_weekdays: [1, 2, 3, 4, 5], holidays: ["2026-10-02"] };
  assert.equal(assessed().window.status, "within_window");
});
test("missing products remain manual review; mixed and supplied eligibility are separate from classification", () => {
  const args = { referenceDate, invoice: invoice(1, "2026-12-01"), policy: resolveCollectionPolicy(calendarConfig()).promptPayment };
  const unknown = evaluatePromptPayment(args);
  assert.equal(unknown.eligibility.status, "manual_review"); assert.equal(unknown.window.status, "within_window");
  assert.equal(evaluatePromptPayment({ ...args, products: "mixed" }).eligibility.status, "manual_review");
  assert.equal(evaluatePromptPayment({ ...args, products: "not_eligible" }).eligibility.status, "not_eligible");
  assert.equal(evaluatePromptPayment({ ...args, products: "eligible" }).discount.amount, null);
  assert.equal("invoice_items" in unknown, false);
});
test("discount preview is exactly 3% of the provided base before VAT, with no balance application", () => {
  const item = invoice(1, "2026-12-01"); const before = structuredClone(item);
  assert.deepEqual(calculatePromptPaymentDiscount(item.base_value), { percentage: "3", base_calculation: "base_value", exact_amount: "30.0000", amount: "30.00", status: "exact_preview" });
  assert.deepEqual(item, before);
  assert.equal(calculatePromptPaymentDiscount("1.01").status, "pending_rounding");
  assert.equal(calculatePromptPaymentDiscount("1.01").amount, null);
});
test("10 percent, another base or another duration cannot masquerade as Pronto Pago", () => {
  for (const override of [{ percentage: "10" }, { base_calculation: "document_value" }, { days: 5 }]) {
    const config = configuration(); Object.assign(config.prompt_payment, override); assert.throws(() => resolveCollectionPolicy(config));
  }
});
test("ineligible invoices remain visible without contributing to eligible balance or becoming candidates", () => {
  const result = response([invoice(1, "2026-09-01", { balance: "100.00" }), invoice(2, "2026-12-01", { balance: "200.00" })]);
  assert.equal(result.customers[0].total_balance, "300.00"); assert.equal(result.customers[0].eligible_balance, "100.00");
  const pending = result.customers[0].invoices[1]; assert.equal(pending.eligible, false); assert.deepEqual(pending.stage_candidates, []);
  assert.equal(pending.prompt_payment.discount.amount, null);
});
