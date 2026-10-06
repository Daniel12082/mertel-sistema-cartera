import { test } from "node:test";
import assert from "node:assert/strict";
import { companyFilter, companyContext } from "../src/utils/companyScope.js";
import { MERTEL_COMPANY_NAME } from "../src/services/mertelCompany.service.js";

test("MERTEL company scope is fixed internally and never derived from request data", () => {
  const adminIdentity = companyContext({ id: 1, company_id: null, roles: [{ name: "admin" }] });
  const collectorIdentity = companyContext({ id: 2, company_id: null, roles: [{ name: "collector" }] });
  const fixedScope = identity => Object.freeze({ ...identity, companyId: "17", companyName: MERTEL_COMPANY_NAME });
  assert.deepEqual(companyFilter(fixedScope(adminIdentity), "c.company_id"), { sql: " AND c.company_id = ?", values: ["17"] });
  assert.deepEqual(companyFilter(fixedScope(collectorIdentity), "company_id"), { sql: " AND company_id = ?", values: ["17"] });
  const request = { company_id: "18" };
  assert.equal(request.company_id, "18");
  assert.deepEqual(companyFilter(fixedScope(adminIdentity), "company_id").values, ["17"]);
});
