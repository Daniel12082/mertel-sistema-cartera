import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateCollectionCase,
  evaluateCollectionInvoice,
  evaluateCollectionInvoices,
  groupCollectionCandidatesByCustomer,
  selectCustomerStage,
} from "../src/services/collectionEngine.service.js";

const referenceDate = "2026-10-02";
const customer = { id: 7, name: "Cliente de prueba" };
const baseRules = [
  { key: "prompt_payment", active: true, priority: 10, days_before_due: 10 },
  { key: "five_days_before_due", active: true, priority: 20, days_before_due: 5 },
  { key: "due_today", active: true, priority: 30 },
  { key: "overdue", active: true, priority: 40 },
];

function invoice(overrides = {}) {
  return {
    invoice_id: 1,
    customer_id: customer.id,
    invoice_number: "TEST-1",
    due_date: "2026-10-10",
    balance: "1000000.00",
    ...overrides,
  };
}

test("future invoice outside configured windows is not overdue or eligible", () => {
  const result = evaluateCollectionInvoice({ referenceDate, invoice: invoice(), rules: baseRules });
  assert.equal(result.stage, "no_eligible");
  assert.equal(result.eligible, false);
  assert.match(result.reason, /Ninguna regla activa/);
});

test("due today is classified using the configured due_today rule", () => {
  const result = evaluateCollectionInvoice({
    referenceDate,
    invoice: invoice({ due_date: referenceDate }),
    rules: baseRules,
  });
  assert.equal(result.stage, "due_today");
  assert.equal(result.priority, 30);
  assert.equal(result.reason, "La factura vence hoy.");
});

test("past due invoice is classified as overdue", () => {
  const result = evaluateCollectionInvoice({
    referenceDate,
    invoice: invoice({ due_date: "2026-09-30" }),
    rules: baseRules,
  });
  assert.equal(result.stage, "overdue");
  assert.equal(result.reason, "Factura vencida con saldo pendiente.");
});

test("days before due is configurable and does not hardcode the stage key", () => {
  const rules = [{ key: "five_days_before_due", active: true, priority: 20, days_before_due: 5 }];
  const result = evaluateCollectionInvoice({
    referenceDate,
    invoice: invoice({ due_date: "2026-10-07" }),
    rules,
  });
  assert.equal(result.stage, "five_days_before_due");
  assert.equal(result.reason, "Faltan 5 días para el vencimiento.");
});

test("zero-balance invoice receives no collection stage", () => {
  const result = evaluateCollectionInvoice({
    referenceDate,
    invoice: invoice({ due_date: "2026-09-30", balance: "0.00" }),
    rules: baseRules,
  });
  assert.equal(result.stage, "no_eligible");
  assert.equal(result.eligible, false);
  assert.match(result.reason, /no tiene saldo pendiente/);
});

test("invoice without due date receives no collection stage", () => {
  const result = evaluateCollectionInvoice({
    referenceDate,
    invoice: invoice({ due_date: null }),
    rules: baseRules,
  });
  assert.equal(result.stage, "no_eligible");
  assert.equal(result.eligible, false);
  assert.match(result.reason, /no tiene fecha de vencimiento/);
});

test("highest supplied priority wins when multiple rules match one invoice", () => {
  const rules = [
    { key: "due_today", active: true, priority: 10 },
    { key: "zero_days_before_due", active: true, priority: 20, days_before_due: 0 },
  ];
  const result = evaluateCollectionInvoice({
    referenceDate,
    invoice: invoice({ due_date: referenceDate }),
    rules,
  });
  assert.equal(result.stage, "zero_days_before_due");
  assert.equal(result.priority, 20);
  assert.deepEqual(result.stageCandidates.map(({ stage }) => stage), ["zero_days_before_due", "due_today"]);
});

test("customer stage follows configured priorities and keeps every eligible invoice", () => {
  const invoices = [
    invoice({ invoice_id: 1, due_date: "2026-09-30" }),
    invoice({ invoice_id: 2, due_date: referenceDate }),
    invoice({ invoice_id: 3, due_date: "2026-10-07" }),
  ];
  const result = evaluateCollectionCase({ referenceDate, customer, invoices, rules: [
    { key: "overdue", active: true, priority: 10 },
    { key: "due_today", active: true, priority: 20 },
    { key: "five_days_before_due", active: true, priority: 30, days_before_due: 5 },
  ] });
  assert.equal(result.stage, "five_days_before_due");
  assert.equal(result.primaryInvoice.invoice_id, 3);
  assert.equal(result.invoices.length, 3);
  assert.deepEqual(result.invoices.map(({ stage }) => stage), ["overdue", "due_today", "five_days_before_due"]);
});

test("primary invoice tie-break uses nearest due date, then larger balance, then invoice id", () => {
  const rules = [{ key: "overdue", active: true, priority: 5 }];
  const nearestDueDate = evaluateCollectionInvoices({
    referenceDate,
    rules,
    invoices: [
      invoice({ invoice_id: 4, due_date: "2026-09-27", balance: "900.00" }),
      invoice({ invoice_id: 5, due_date: "2026-10-01", balance: "100.00" }),
    ],
  });
  const nearestGroup = groupCollectionCandidatesByCustomer(nearestDueDate, [customer])[0];
  assert.equal(selectCustomerStage(nearestGroup, referenceDate).primaryInvoice.invoice_id, 5);

  const largerBalance = evaluateCollectionInvoices({
    referenceDate,
    rules,
    invoices: [
      invoice({ invoice_id: 9, due_date: "2026-10-01", balance: "100.00" }),
      invoice({ invoice_id: 8, due_date: "2026-10-01", balance: "200.00" }),
    ],
  });
  const balanceGroup = groupCollectionCandidatesByCustomer(largerBalance, [customer])[0];
  assert.equal(selectCustomerStage(balanceGroup, referenceDate).primaryInvoice.invoice_id, 8);

  const stableId = evaluateCollectionInvoices({
    referenceDate,
    rules,
    invoices: [
      invoice({ invoice_id: 9, due_date: "2026-10-01", balance: "200.00" }),
      invoice({ invoice_id: 3, due_date: "2026-10-01", balance: "200.00" }),
    ],
  });
  const idGroup = groupCollectionCandidatesByCustomer(stableId, [customer])[0];
  assert.equal(selectCustomerStage(idGroup, referenceDate).primaryInvoice.invoice_id, 3);
});

test("different customers remain in separate groups", () => {
  const classified = evaluateCollectionInvoices({
    referenceDate,
    rules: baseRules,
    invoices: [
      invoice({ invoice_id: 1, customer_id: 7, due_date: "2026-09-30" }),
      invoice({ invoice_id: 2, customer_id: 8, due_date: referenceDate }),
    ],
  });
  const groups = groupCollectionCandidatesByCustomer(classified, [customer, { id: 8, name: "Otro cliente" }]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map(({ customerId }) => customerId), [7, 8]);
  assert.deepEqual(groups.map(({ invoices }) => invoices.length), [1, 1]);
  assert.equal(selectCustomerStage(groups[0], referenceDate).stage, "overdue");
  assert.equal(selectCustomerStage(groups[1], referenceDate).stage, "due_today");
});

test("deleted invoices are ignored and the original invoice is not mutated", () => {
  const source = invoice({ deleted_at: "2026-10-01T00:00:00.000Z" });
  const before = { ...source };
  const result = evaluateCollectionInvoice({ referenceDate, invoice: source, rules: baseRules });
  assert.equal(result.eligible, false);
  assert.match(result.reason, /no está activa/);
  assert.notEqual(result.invoice, source);
  assert.deepEqual(source, before);
});

test("invalid or missing reference dates return a controlled error", () => {
  assert.throws(() => evaluateCollectionInvoice({ invoice: invoice(), rules: baseRules }), /referenceDate/);
  assert.throws(() => evaluateCollectionInvoice({ referenceDate: "2026-02-30", invoice: invoice(), rules: baseRules }), /calendario/);
});
