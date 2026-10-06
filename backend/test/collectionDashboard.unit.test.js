import test from "node:test";
import assert from "node:assert/strict";
import { buildCollectionDashboard } from "../src/services/collectionDashboard.service.js";
import { ROLE_PERMISSIONS } from "../src/config/permissions.js";

test("dashboard groups unique engine customers and their complete pending balances by primary stage", () => {
  const result = buildCollectionDashboard({
    collection: {
      reference_date: "2026-10-06", status: "ready", message: null,
      summary: { total_balance: "175.00", total_customers: 2 },
      stage_catalog: [{ key: "overdue", label: "En mora" }, { key: "due_today", label: "Vence hoy" }],
      customers: [
        { customer: { id: "1" }, stage: "overdue", stage_label: "En mora", total_balance: "125.00" },
        { customer: { id: "2" }, stage: "overdue", stage_label: "En mora", total_balance: "25.00" },
      ], configuration_warnings: ["Config incompleta"],
    },
    promises: { pending_count: 1, pending_amount: "50.00" }, actionsPeriod: 3, activityFrom: "2026-09-30", activityTo: "2026-10-06",
  });
  assert.equal(result.portfolio.total_balance, "175.00");
  assert.equal(result.portfolio.customers_in_collection, 2);
  assert.deepEqual(result.stages, [
    { key: "overdue", label: "En mora", customers: 2, balance: "150.00" },
    { key: "due_today", label: "Vence hoy", customers: 0, balance: "0.00" },
  ]);
  assert.deepEqual(result.promises, { pending_count: 1, pending_amount: "50.00" });
  assert.deepEqual(result.activity, { activity_from: "2026-09-30", activity_to: "2026-10-06", actions_period: 3 });
  assert.deepEqual(result.warnings, ["Config incompleta"]);
});

test("existing admin-only setting permission gates dashboard without changing role grants", () => {
  assert.ok(ROLE_PERMISSIONS.admin.includes("collection.view"));
  assert.ok(ROLE_PERMISSIONS.admin.includes("settings.manage"));
  for (const role of ["supervisor", "collector"]) {
    assert.ok(ROLE_PERMISSIONS[role].includes("collection.view"));
    assert.ok(!ROLE_PERMISSIONS[role].includes("settings.manage"));
  }
});
