import test from "node:test";
import assert from "node:assert/strict";
import { calculatePortfolioState } from "../src/services/portfolio.calculation.js";

const referenceDate = "2026-10-02";
const balance = "1000000.00";

test("future due date is current", () => {
  assert.deepEqual(calculatePortfolioState({ dueDate: "2026-10-03", balance, referenceDate }), {
    portfolio_status: "current", days_overdue: 0, days_until_due: 1,
  });
});

test("due today has no overdue days", () => {
  assert.deepEqual(calculatePortfolioState({ dueDate: referenceDate, balance, referenceDate }), {
    portfolio_status: "due_today", days_overdue: 0, days_until_due: 0,
  });
});

test("one day past due is overdue by one day", () => {
  assert.deepEqual(calculatePortfolioState({ dueDate: "2026-10-01", balance, referenceDate }), {
    portfolio_status: "overdue", days_overdue: 1, days_until_due: null,
  });
});

test("thirty days past due is overdue by thirty days", () => {
  assert.deepEqual(calculatePortfolioState({ dueDate: "2026-09-02", balance, referenceDate }), {
    portfolio_status: "overdue", days_overdue: 30, days_until_due: null,
  });
});

test("zero balance is identified as paid", () => {
  assert.deepEqual(calculatePortfolioState({ dueDate: "2026-09-02", balance: "0.00", referenceDate }), {
    portfolio_status: "paid", days_overdue: null, days_until_due: null,
  });
});

test("missing due date is not considered overdue", () => {
  assert.deepEqual(calculatePortfolioState({ dueDate: null, balance, referenceDate }), {
    portfolio_status: "no_due_date", days_overdue: null, days_until_due: null,
  });
});

test("invalid reference dates are rejected", () => {
  assert.throws(() => calculatePortfolioState({ dueDate: null, balance, referenceDate: "2026-02-30" }), /calendario/);
});
