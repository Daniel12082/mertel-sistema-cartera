import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import { loadAuthConfig } from "../src/config/auth.js";
import { hashPassword } from "../src/utils/password.js";
import { applyAuthMigrations } from "../src/services/authMigrations.service.js";
import { operationId, validateOperation } from "../src/services/collectionOperations.validation.js";
import { requirePermission } from "../src/middleware/requirePermission.js";
dotenv.config({ path: new URL("../.env", import.meta.url), quiet: true });

test("manual validation rejects bad identifiers, dates, amounts and forged actors/status", () => {
  for (const id of [0, -1, "1 OR 1", "0", "18446744073709551616", [], true]) assert.throws(() => operationId(id, "id"));
  for (const promised_amount of [0, "0.00", "1.001", "1e3", -2, true, []]) assert.throws(() => validateOperation("promise", { promised_date: "2026-10-05", promised_amount }));
  for (const promised_date of ["2026-02-30", "2026-13-01", "05/10/2026", null]) assert.throws(() => validateOperation("promise", { promised_date, promised_amount: "1.00" }));
  assert.throws(() => validateOperation("action", { action_type: "nota", description: "observación", user_id: 9 }));
  assert.throws(() => validateOperation("promise", { promised_date: "2026-10-05", promised_amount: "1", status: "fulfilled" }));
  assert.equal(validateOperation("promise", { promised_date: "2026-10-05", promised_amount: "1.01" }).promised_amount, "1.01");
});
test("collection.manage is required independently of collection.view", () => {
  let status;
  requirePermission("collection.manage")({ user: { permissions: ["collection.view"] }, body: { permissions: ["collection.manage"] } }, { status(code) { status = code; return this; }, json() {} }, () => assert.fail("guard bypass"));
  assert.equal(status, 403);
});

// Every fixture exists only in a generated disposable schema, never the configured business database.
describe("4.9 manual collection HTTP / MySQL", { skip: !(process.env.DB_HOST && process.env.DB_USER) }, () => {
  const schemaName = `mertel_operations_test_${randomUUID().replaceAll("-", "")}`;
  const original = process.env.DB_NAME;
  const password = randomBytes(32).toString("base64url");
  const config = loadAuthConfig({ JWT_SECRET: randomBytes(48).toString("base64url"), FRONTEND_URL: "http://localhost:5173", AUTH_COOKIE_SAME_SITE: "lax", NODE_ENV: "test", AUTH_RATE_LIMIT_MAX: "1000" });
  let db, pool, server, url, a, b, global, roleless, customerA, customerB = "999999999", invoiceA, invoiceB = "999999999";
  before(async () => {
    db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD, multipleStatements: true });
    await db.query(`CREATE DATABASE \`${schemaName}\``); await db.query(`USE \`${schemaName}\``);
    const schema = await readFile(new URL("../../database/migrations/001_initial_schema.sql", import.meta.url), "utf8");
    const tables = new Set(["companies", "roles", "users", "user_roles", "customers", "invoices", "payments", "payment_allocations", "payment_promises", "collection_actions", "audit_logs", "settings", "messages", "message_templates"]);
    for (const match of schema.matchAll(/CREATE TABLE (\w+) \([\s\S]*?;/g)) if (tables.has(match[1])) await db.query(match[0]);
    await db.query("INSERT INTO roles(name) VALUES ('admin'),('collector')"); await applyAuthMigrations(db);
    process.env.DB_NAME = schemaName;
    ({ default: pool } = await import("../src/config/database.js"));
    const { createApp } = await import("../src/app.js");
    server = await new Promise(resolve => { const listener = createApp(config).listen(0, "127.0.0.1", () => resolve(listener)); });
    url = `http://127.0.0.1:${server.address().port}/api/collection`;
    const hash = await hashPassword(password);
    async function actor(companyId, role) {
      const email = `${randomUUID()}@example.test`;
      const [user] = await db.query("INSERT INTO users(company_id,first_name,email,password_hash) VALUES (?,'Actor fixture',?,?)", [companyId, email, hash]);
      if (role) await db.query("INSERT INTO user_roles(user_id,role_id) SELECT ?,id FROM roles WHERE name=?", [user.insertId, role]);
      const login = await fetch(url.replace(/\/collection$/, "/auth/login"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      assert.equal(login.status, 200); const session = await login.json(); return { id: String(user.insertId), token: session.data.access_token, companyId };
    }
    const [company1] = await db.query("INSERT INTO companies(name) VALUES ('MERTEL IMPORTACIONES')");
    a = await actor(company1.insertId, "collector"); b = await actor(company1.insertId, "collector"); global = await actor(null, "admin"); roleless = await actor(a.companyId, null);
    const [ca] = await db.query("INSERT INTO customers(company_id,nit,name) VALUES (?,'a','A')", [a.companyId]); customerA = String(ca.insertId);
    const [ia] = await db.query("INSERT INTO invoices(company_id,customer_id,invoice_number,document_value,base_value,iva_value,balance) VALUES (?,?,'A-1',119,100,19,119)", [a.companyId, customerA]); invoiceA = String(ia.insertId);
    await db.query("UPDATE invoices SET issue_date='2026-08-01',due_date='2026-09-01' WHERE id=?", [invoiceA]);
    await db.query("INSERT INTO settings(company_id,setting_key,setting_value,value_type) VALUES (?,'collection_rules',?,'json')", [a.companyId, JSON.stringify([{ key: "overdue", active: true }])]);
  });
  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve)); if (pool) await pool.end();
    if (db) { assert.match(schemaName, /^mertel_operations_test_[a-f0-9]{32}$/); assert.notEqual(schemaName, original); await db.query(`DROP DATABASE IF EXISTS \`${schemaName}\``); await db.end(); }
    if (original === undefined) delete process.env.DB_NAME; else process.env.DB_NAME = original;
  });
  async function request(method, path, actor, body) {
    const response = await fetch(url + path, { method, headers: { "Content-Type": "application/json", ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }
  const action = () => ({ invoice_id: invoiceA, action_type: "nota técnica", description: "Nota de fixture aislada" });
  const promise = () => ({ invoice_id: invoiceA, promised_date: "2026-10-15", promised_amount: "12.34", notes: "Nota de promesa de fixture" });
  const path = kind => `/customers/${customerA}/${kind}`;
  async function count(table) { const [[row]] = await db.query(`SELECT COUNT(*) AS total FROM \`${table}\``); return row.total; }
  async function state() {
    const [invoices] = await db.query("SELECT id,balance,status FROM invoices ORDER BY id");
    return { invoices, payments: await count("payments"), allocations: await count("payment_allocations"), messages: await count("messages") };
  }
  test("all operation routes reject missing auth and roleless actors", async () => {
    for (const kind of ["actions", "promises"]) for (const method of ["GET", "POST"]) {
      assert.equal((await request(method, path(kind), null, method === "POST" ? kind === "actions" ? action() : promise() : undefined)).status, 401);
      assert.equal((await request(method, path(kind), roleless, method === "POST" ? kind === "actions" ? action() : promise() : undefined)).status, 403);
    }
  });
  test("records action with trusted actor, server UTC time and transactional audit", async () => {
    const before = await state(); const result = await request("POST", path("actions"), a, action());
    assert.equal(result.status, 201); assert.equal(result.body.data.user_id, a.id); assert.equal(result.body.data.status, "completed");
    assert.match(result.body.data.action_date, /^\d{4}-\d{2}-\d{2}T.*Z$/);
    assert.equal(result.body.data.invoice_number, "A-1");
    const [logs] = await db.query("SELECT company_id,user_id,new_values FROM audit_logs WHERE entity_type='collection_action' AND entity_id=?", [result.body.data.id]);
    assert.equal(logs.length, 1); assert.equal(String(logs[0].company_id), String(a.companyId)); assert.equal(String(logs[0].user_id), a.id);
    assert.deepEqual(await state(), before);
  });
  test("records pending promise without fulfillment, priority changes or financial side effects", async () => {
    const before = await state(); const pipeline = await request("GET", "?reference_date=2026-10-05", a);
    const result = await request("POST", path("promises"), a, promise());
    assert.equal(result.status, 201); assert.equal(result.body.data.promised_amount, "12.34");
    assert.equal(result.body.data.promised_date, "2026-10-15"); assert.equal(result.body.data.status, "pending");
    assert.equal(result.body.data.user_id, a.id); assert.deepEqual(await state(), before);
    const [rows] = await db.query("SELECT fulfilled_at FROM payment_promises WHERE id=?", [result.body.data.id]); assert.equal(rows[0].fulfilled_at, null);
    const updatedPipeline = await request("GET", "?reference_date=2026-10-05", a);
    assert.equal(String(updatedPipeline.body.data.customers[0].current_promise.id), String(result.body.data.id));
    assert.equal(updatedPipeline.body.data.customers[0].current_promise.status, "pending");
    assert.equal(pipeline.body.data.customers[0].current_promise, null);
  });
  test("same-company invoices from another customer and malformed historical joins are isolated", async () => {
    const [other] = await db.query("INSERT INTO customers(company_id,nit,name) VALUES (?,'other','Other fixture')", [a.companyId]);
    const [otherInvoice] = await db.query("INSERT INTO invoices(company_id,customer_id,invoice_number,document_value,base_value,iva_value,balance) VALUES (?,?,'Other-1',10,10,0,10)", [a.companyId, other.insertId]);
    for (const kind of ["actions", "promises"]) assert.equal((await request("POST", path(kind), a, { ...(kind === "actions" ? action() : promise()), invoice_id: String(otherInvoice.insertId) })).status, 404);
    await db.query("INSERT INTO collection_actions(company_id,customer_id,invoice_id,user_id,action_type,description) VALUES (?,?,?,?,'malformed','foreign fixture note')", [a.companyId, customerA, otherInvoice.insertId, a.id]);
    const history = await request("GET", path("actions"), a); assert.equal(history.status, 200);
    assert.ok(history.body.data.every(row => row.description !== "foreign fixture note"));
  });
  test("lists histories by customer or invoice and leaves state unchanged", async () => {
    await request("POST", path("actions"), a, { action_type: "registro cliente", description: "Sin factura" });
    const before = await state();
    const all = await request("GET", path("actions"), a); const filtered = await request("GET", path("actions") + `?invoice_id=${invoiceA}`, a);
    assert.equal(all.status, 200); assert.ok(all.body.data.length > filtered.body.data.length); assert.equal(filtered.body.data[0].invoice_id, invoiceA);
    assert.ok((await request("GET", path("promises"), a)).body.data.length); assert.deepEqual(await state(), before);
  });
  test("foreign customer, foreign invoice and company spoofing never disclose or write records", async () => {
    for (const kind of ["actions", "promises"]) {
      assert.equal((await request("GET", `/customers/${customerB}/${kind}`, a)).status, 404);
      assert.equal((await request("POST", path(kind), a, { ...(kind === "actions" ? action() : promise()), invoice_id: invoiceB })).status, 404);
      assert.equal((await request("GET", path(kind) + `?invoice_id=${invoiceB}`, a)).status, 404);
      assert.equal((await request("GET", path(kind) + `?company_id=999999999`, a)).status, 403);
      assert.equal((await request("POST", `/customers/${customerB}/${kind}`, a, kind === "actions" ? action() : promise())).status, 404);
    }
  });
  test("global admin receives MERTEL automatically and cannot switch company", async () => {
    assert.equal((await request("GET", path("actions"), global)).status, 200);
    assert.equal((await request("POST", path("actions") + `?company_id=${a.companyId}`, global, action())).status, 201);
    assert.equal((await request("POST", path("actions") + `?company_id=999999999`, global, action())).status, 403);
    assert.equal((await request("GET", `/customers/${customerB}/actions?company_id=${a.companyId}`, global)).status, 404);
  });
  test("invalid payloads, missing resources, forged status and inactive customer are rejected", async () => {
    assert.equal((await request("POST", path("promises"), a, { ...promise(), promised_date: "2026-02-30" })).status, 400);
    assert.equal((await request("POST", path("actions"), a, { ...action(), user_id: b.id })).status, 400);
    assert.equal((await request("POST", path("promises"), a, { ...promise(), status: "fulfilled" })).status, 400);
    assert.equal((await request("GET", "/customers/999999/actions", a)).status, 404);
    assert.equal((await request("POST", path("actions"), a, { ...action(), invoice_id: "999999" })).status, 404);
    assert.equal((await request("GET", path("actions") + "?invoice_id=bad", a)).status, 400);
    await db.query("UPDATE customers SET status='inactive' WHERE id=?", [customerA]);
    assert.equal((await request("POST", path("actions"), a, action())).status, 409); await db.query("UPDATE customers SET status='active' WHERE id=?", [customerA]);
  });
  test("audit failure rolls back both action and promise without exposing SQL", async () => {
    await db.query("CREATE TRIGGER reject_operation_audit BEFORE INSERT ON audit_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='private_sql_fixture'");
    try {
      for (const kind of ["actions", "promises"]) {
        const table = kind === "actions" ? "collection_actions" : "payment_promises"; const beforeCount = await count(table); const before = await state();
        const result = await request("POST", path(kind), a, kind === "actions" ? action() : promise());
        assert.equal(result.status, 500); assert.doesNotMatch(result.body.message, /private|SQL|INSERT/);
        assert.equal(await count(table), beforeCount); assert.deepEqual(await state(), before);
      }
    } finally { await db.query("DROP TRIGGER reject_operation_audit"); }
  });
});
