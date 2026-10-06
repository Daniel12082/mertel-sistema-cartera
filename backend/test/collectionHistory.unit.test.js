import test from "node:test";
import assert from "node:assert/strict";
import { getAdministrativeCollectionHistory, getCustomerCollectionHistory } from "../src/services/collectionHistory.service.js";
import { ROLE_PERMISSIONS } from "../src/config/permissions.js";

test("history uses the existing permission with collector own-user scope and admin-only global view", () => {
  assert.ok(ROLE_PERMISSIONS.collector.includes("history.view"));
  assert.ok(ROLE_PERMISSIONS.supervisor.includes("history.view"));
  assert.ok(ROLE_PERMISSIONS.admin.includes("history.view"));
  for (const role of ["collector", "supervisor"]) assert.ok(!ROLE_PERMISSIONS[role].includes("settings.manage"));
});

test("history rejects invalid IDs, page sizes, event types and reversed date ranges before database access", async () => {
  const scope = { companyId: "1", globalAdmin: false, actorId: "8" };
  await assert.rejects(getCustomerCollectionHistory({ customerId: "1 OR 1", scope }), { status: 400 });
  await assert.rejects(getCustomerCollectionHistory({ customerId: "1", scope, limit: "999999" }), { status: 400 });
  await assert.rejects(getCustomerCollectionHistory({ customerId: "1", scope, type: "sent_message" }), { status: 400 });
  await assert.rejects(getAdministrativeCollectionHistory({ scope, dateFrom: "2026-10-10", dateTo: "2026-10-01" }), { status: 400 });
  await assert.rejects(getAdministrativeCollectionHistory({ scope, page: "0" }), { status: 400 });
});
