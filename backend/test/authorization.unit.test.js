import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PERMISSIONS, ROLE_PERMISSIONS, permissionsForRoles, roleCatalog } from "../src/config/permissions.js";
import { requirePermission } from "../src/middleware/requirePermission.js";

test("policy has exactly the three existing roles and unique described permissions", () => {
  assert.deepEqual(Object.keys(ROLE_PERMISSIONS).sort(), ["admin", "collector", "supervisor"]);
  assert.equal(new Set(PERMISSIONS.map(item => item.name)).size, PERMISSIONS.length);
  for (const item of PERMISSIONS) { assert.ok(item.description); assert.ok(item.moduleLabel); }
  for (const names of Object.values(ROLE_PERMISSIONS)) for (const name of names) assert.ok(PERMISSIONS.some(item => item.name === name));
});
test("collector and supervisor receive the exact initial active grants", () => {
  assert.deepEqual(permissionsForRoles([{ name: "collector" }]).sort(), ["customers.view", "invoices.view", "payments.create", "payments.view",
    "payment_allocations.create", "payment_allocations.view", "portfolio.view", "collection.view", "collection.manage"].sort());
  assert.deepEqual(permissionsForRoles([{ name: "supervisor" }]).sort(), ["customers.view", "customers.update", "invoices.view", "invoices.update",
    "payments.create", "payments.view", "payments.update", "payment_allocations.create", "payment_allocations.view", "payment_allocations.reverse", "portfolio.view", "collection.view", "collection.manage"].sort());
  assert.equal(permissionsForRoles([{ name: "admin" }]).length, 20);
});
test("unknown/missing roles fail closed; multi-role grants are a unique union", () => {
  assert.deepEqual(permissionsForRoles(), []);
  assert.deepEqual(permissionsForRoles([{ name: "unknown" }, { name: "toString" }]), []);
  assert.deepEqual(permissionsForRoles([{ name: "collector" }, { name: "supervisor" }, { name: "collector" }]), permissionsForRoles([{ name: "supervisor" }]));
});
test("catalog includes enabled/disabled state and own-user history scope without activating planned endpoints", () => {
  const catalog = roleCatalog();
  assert.deepEqual(catalog.map(role => role.label), ["Admin", "Supervisor", "Collector"]);
  const collector = catalog.find(role => role.name === "collector");
  assert.equal(collector.permissions.find(permission => permission.name === "history.view").scope, "own_user");
  assert.equal(collector.permissions.find(permission => permission.name === "history.view").implemented, false);
  assert.equal(collector.permissions.find(permission => permission.name === "roles.view").enabled, false);
  assert.equal(collector.permissions.find(permission => permission.name === "collection.view").implemented, true);
  assert.equal(collector.permissions.find(permission => permission.name === "collection.manage").implemented, true);
  assert.ok(catalog.find(role => role.name === "admin").permissions.every(permission => permission.enabled));
  assert.equal(permissionsForRoles([{ name: "admin" }]).includes("users.create"), false);
});
test("permission guard differentiates 401/403 and ignores client-supplied grants", () => {
  const guard = requirePermission("customers.create");
  for (const [user, expected] of [[undefined, 401], [{ permissions: [] }, 403], [{ permissions: ["customers.create"] }, 0]]) {
    let status = 0; let passed = false;
    const response = { status(value) { status = value; return this; }, json() {} };
    guard({ user, body: { roles: ["admin"], permissions: ["customers.create"] } }, response, () => { passed = true; });
    assert.equal(status, expected); assert.equal(passed, expected === 0);
  }
  assert.throws(() => requirePermission("portfolio.export"));
  assert.throws(() => requirePermission("invented.permission"));
});
test("provisioning CLI rejects piped credentials and password arguments before connecting", () => {
  const script = fileURLToPath(new URL("../scripts/provision-admin.js", import.meta.url));
  const privateInput = "private_cli_fixture";
  for (const args of [[], ["--email", "owner@example.test"], ["--password", privateInput]]) {
    const result = spawnSync(process.execPath, [script, ...args], { input: privateInput, encoding: "utf8",
      env: { ...process.env, DB_HOST: "127.0.0.1", DB_PORT: "1", DB_USER: "invalid_cli_fixture", DB_PASSWORD: "", DB_NAME: "invalid_cli_fixture" } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /terminal interactiva/);
    assert.equal((result.stdout + result.stderr).includes(privateInput), false);
  }
});
