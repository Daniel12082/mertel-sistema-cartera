import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { MERTEL_COMPANY_NAME, provisionMertelCompany, resolveMertelCompany } from "../src/services/mertelCompany.service.js";

describe("MERTEL single-company context", () => {
  test("resolves exactly one active MERTEL company", async () => {
    const db = { query: async (sql, values) => {
      assert.match(sql, /FROM companies WHERE name=/); assert.deepEqual(values, [MERTEL_COMPANY_NAME]);
      return [[{ id: "9", name: MERTEL_COMPANY_NAME, status: "active", deleted_at: null }]];
    } };
    assert.equal((await resolveMertelCompany(db)).id, "9");
  });
  test("fails closed if missing, duplicated, or inactive", async () => {
    for (const rows of [[], [{ id: "1", name: MERTEL_COMPANY_NAME, status: "active", deleted_at: null }, { id: "2", name: MERTEL_COMPANY_NAME, status: "active", deleted_at: null }], [{ id: "1", name: MERTEL_COMPANY_NAME, status: "inactive", deleted_at: null }]]) {
      await assert.rejects(resolveMertelCompany({ query: async () => [rows] }), error => error.status === 503);
    }
  });
  test("provisioning creates once, then reuses the active record", async () => {
    let row; let inserts = 0;
    const db = { query: async (sql, values) => {
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
      if (sql.includes("RELEASE_LOCK")) return [[{ released: 1 }]];
      if (sql.startsWith("SELECT CAST(id AS CHAR) AS id, name, status, deleted_at FROM companies WHERE name=")) return [row ? [row] : []];
      if (sql.startsWith("INSERT INTO companies")) { inserts++; row = { id: "23", name: values[0], status: "active", deleted_at: null }; return [{ insertId: 23 }]; }
      if (sql.includes("WHERE id=?")) return [[row]];
      throw new Error(`Unexpected SQL: ${sql}`);
    } };
    assert.equal((await provisionMertelCompany(db)).created, true);
    assert.equal((await provisionMertelCompany(db)).created, false);
    assert.equal(inserts, 1);
  });
});
