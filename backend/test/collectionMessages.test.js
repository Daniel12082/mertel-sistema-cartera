import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import { renderMessageTemplate } from "../src/utils/messageTemplate.js";
import { loadAuthConfig } from "../src/config/auth.js";
import { applyAuthMigrations } from "../src/services/authMigrations.service.js";
dotenv.config({ path: new URL("../.env", import.meta.url), quiet: true });

test("message substitution is literal, does not recurse/evaluate and preserves absent/unsupported variables", () => {
  const preview = renderMessageTemplate("{{cliente}} / {{saldo}} / {{factura}} / {{otra}}", { cliente: "<script>{{saldo}}</script>", saldo: "$ 150,00", factura: null });
  assert.equal(preview.content, "<script>{{saldo}}</script> / $ 150,00 / {{factura}} / {{otra}}");
  assert.deepEqual(preview.missing_variables, ["factura"]); assert.deepEqual(preview.unsupported_variables, ["otra"]);
  assert.equal(renderMessageTemplate("{{cliente", { cliente: "A" }).malformed_variables, true);
  assert.equal(renderMessageTemplate("{{ dias_mora }} {{dias_mora}}", { dias_mora: 0 }).content, "0 0");
  assert.deepEqual(renderMessageTemplate("{{cliente}}", { cliente: "   " }).missing_variables, ["cliente"]);
});

// Disposable fixtures only; no seeding, migration or messaging against the business schema.
describe("5.1 message preparation HTTP / MySQL", { skip: !(process.env.DB_HOST && process.env.DB_USER) }, () => {
  const schema = `mertel_messages_test_${randomUUID().replaceAll("-", "")}`;
  const original = process.env.DB_NAME;
  const config = loadAuthConfig({ JWT_SECRET: randomBytes(48).toString("base64url"), FRONTEND_URL: "http://localhost:5173", NODE_ENV: "test", AUTH_COOKIE_SAME_SITE: "lax" });
  let db, pool, server, root, a, b, global, roleless, customer, foreignCustomer, primary, template, foreignTemplate;
  before(async () => {
    db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD, multipleStatements: true });
    await db.query(`CREATE DATABASE \`${schema}\``); await db.query(`USE \`${schema}\``);
    const initial = await readFile(new URL("../../database/migrations/001_initial_schema.sql", import.meta.url), "utf8");
    const tables = new Set(["companies", "roles", "users", "user_roles", "customers", "invoices", "payments", "payment_allocations", "collection_actions", "payment_promises", "message_templates", "messages", "settings", "audit_logs"]);
    for (const match of initial.matchAll(/CREATE TABLE (\w+) \([\s\S]*?;/g)) if (tables.has(match[1])) await db.query(match[0]);
    await db.query("INSERT INTO roles(name) VALUES ('admin'),('collector')"); await applyAuthMigrations(db);
    process.env.DB_NAME = schema; ({ default: pool } = await import("../src/config/database.js"));
    const { issueAccessToken } = await import("../src/services/auth.service.js");
    const { createApp } = await import("../src/app.js");
    server = await new Promise(resolve => { const listener = createApp(config).listen(0, "127.0.0.1", () => resolve(listener)); });
    root = `http://127.0.0.1:${server.address().port}/api/collection`;
    const [ca] = await db.query("INSERT INTO companies(name) VALUES ('Messages fixture A')");
    const [cb] = await db.query("INSERT INTO companies(name) VALUES ('Messages fixture B')");
    async function actor(companyId, role) {
      const [user] = await db.query("INSERT INTO users(company_id,first_name,email,password_hash) VALUES (?,'Fixture',?,'unusable-fixture-hash')", [companyId, `${randomUUID()}@example.test`]);
      if (role) await db.query("INSERT INTO user_roles(user_id,role_id) SELECT ?,id FROM roles WHERE name=?", [user.insertId, role]);
      return { id: user.insertId, companyId, token: issueAccessToken(String(user.insertId), config) };
    }
    a = await actor(ca.insertId, "collector"); b = await actor(cb.insertId, "collector"); global = await actor(null, "admin"); roleless = await actor(a.companyId, null);
    const [client] = await db.query("INSERT INTO customers(company_id,nit,name,phone) VALUES (?,'FIXTURE-A','Fixture cliente','300 000 0000')", [a.companyId]); customer = String(client.insertId);
    const [other] = await db.query("INSERT INTO customers(company_id,nit,name,phone) VALUES (?,'FIXTURE-B','Fixture ajeno','3010000000')", [b.companyId]); foreignCustomer = String(other.insertId);
    const [invoice] = await db.query("INSERT INTO invoices(company_id,customer_id,invoice_number,issue_date,due_date,document_value,base_value,balance) VALUES (?,?,'OLD-FIXTURE','2026-08-01','2026-09-01',100,100,100)", [a.companyId, customer]); primary = String(invoice.insertId);
    await db.query("INSERT INTO invoices(company_id,customer_id,invoice_number,issue_date,due_date,document_value,base_value,balance) VALUES (?,?,'NEW-FIXTURE','2026-09-01','2026-09-25',50,50,50)", [a.companyId, customer]);
    const rules = await readFile(new URL("../config/mertel-collection-rules.json", import.meta.url), "utf8");
    await db.query("INSERT INTO settings(company_id,setting_key,setting_value,value_type) VALUES (?,'collection_rules',?,'json')", [a.companyId, rules]);
    const [message] = await db.query("INSERT INTO message_templates(company_id,name,content) VALUES (?,'Plantilla de prueba','{{cliente}} | {{factura}} | {{saldo}} | {{fecha_vencimiento}} | {{dias_mora}}')", [a.companyId]); template = String(message.insertId);
    const [foreign] = await db.query("INSERT INTO message_templates(company_id,name,content) VALUES (?,'Ajena','Solo fixture')", [b.companyId]); foreignTemplate = String(foreign.insertId);
    await db.query("INSERT INTO message_templates(company_id,name,content,status) VALUES (?,'Inactiva','Solo fixture','inactive')", [a.companyId]);
    await db.query("INSERT INTO message_templates(company_id,name,content,channel) VALUES (?,'Email','Solo fixture','email')", [a.companyId]);
    await db.query("INSERT INTO message_templates(company_id,name,content,stage) VALUES (?,'Otra etapa','Solo fixture','due_today')", [a.companyId]);
    await db.query("INSERT INTO message_templates(name,content) VALUES ('Sin empresa','Solo fixture')");
  });
  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve)); if (pool) await pool.end();
    if (db) { assert.match(schema, /^mertel_messages_test_[a-f0-9]{32}$/); assert.notEqual(schema, original); await db.query(`DROP DATABASE IF EXISTS \`${schema}\``); await db.end(); }
    if (original === undefined) delete process.env.DB_NAME; else process.env.DB_NAME = original;
  });
  const listPath = () => `/customers/${customer}/message-templates?reference_date=2026-10-05`;
  const body = extra => ({ template_id: template, reference_date: "2026-10-05", ...extra });
  async function request(method, path, actor = a, payload) {
    const response = await fetch(root + path, { method, headers: { "Content-Type": "application/json", ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
    return { status: response.status, cache: response.headers.get("cache-control"), body: await response.json() };
  }
  async function snapshot() {
    const tables = ["customers", "invoices", "payments", "payment_allocations", "collection_actions", "payment_promises", "messages", "audit_logs"];
    const [rows] = await db.query("CHECKSUM TABLE " + tables.map(table => `\`${table}\``).join(",")); return rows;
  }
  test("active WhatsApp templates are company/stage scoped, without legacy NULL fallback", async () => {
    const response = await request("GET", listPath()); assert.equal(response.status, 200); assert.equal(response.cache, "no-store");
    assert.deepEqual(response.body.data.map(item => item.id), [template]); assert.deepEqual(response.body.data[0].variables, ["cliente", "factura", "saldo", "fecha_vencimiento", "dias_mora"]);
  });
  test("preview and preparation use backend main_invoice, preserve exact phone and write nothing", async () => {
    const before = await snapshot();
    for (const step of ["preview", "prepare"]) {
      const result = await request("POST", `/customers/${customer}/messages/${step}`, a, body()); assert.equal(result.status, 200);
      const data = result.body.data;
      assert.equal(data.customer.id, customer); assert.equal(data.customer.phone, "300 000 0000"); assert.equal(data.main_invoice.id, primary);
      assert.match(data.content, /OLD-FIXTURE/); assert.match(data.content, /150/); assert.match(data.content, /2026-09-01 \| 34$/);
      assert.equal(data.prepared, step === "prepare"); assert.equal(data.can_prepare, true); assert.equal(data.sent_at, undefined); assert.equal(data.status, undefined);
    }
    assert.deepEqual(await snapshot(), before);
  });
  test("unauthenticated, roleless and view-only requests cannot consult or prepare messages", async () => {
    assert.equal((await request("GET", listPath(), null)).status, 401); assert.equal((await request("GET", listPath(), roleless)).status, 403);
    const { collectionMessageController } = await import("../src/controllers/collectionMessages.controller.js"); assert.equal(typeof collectionMessageController, "function");
    // Route-level manage guard is independently tested against view-only permissions.
    const { requirePermission } = await import("../src/middleware/requirePermission.js"); let code;
    requirePermission("collection.manage")({ user: { permissions: ["collection.view"] } }, { status(value) { code = value; return this; }, json() {} }, () => assert.fail()); assert.equal(code, 403);
  });
  test("foreign clients/templates and forged content/actor/financial fields are rejected", async () => {
    const before = await snapshot();
    assert.equal((await request("GET", `/customers/${foreignCustomer}/message-templates?reference_date=2026-10-05`)).status, 404);
    assert.equal((await request("POST", `/customers/${customer}/messages/preview`, a, body({ template_id: foreignTemplate }))).status, 404);
    for (const key of ["company_id", "content", "customer_id", "balance", "invoice_id", "created_by"]) assert.equal((await request("POST", `/customers/${customer}/messages/prepare`, a, body({ [key]: b.companyId }))).status, 400);
    const spoofed = await request("GET", listPath()+`&company_id=${b.companyId}`); assert.deepEqual(spoofed.body, (await request("GET", listPath())).body);
    assert.deepEqual(await snapshot(), before);
  });
  test("global admin requires company scope; inactive template is rechecked at preparation", async () => {
    assert.equal((await request("GET", listPath(), global)).status, 400);
    assert.equal((await request("GET", listPath()+`&company_id=${a.companyId}`, global)).status, 200);
    await db.query("UPDATE message_templates SET status='inactive' WHERE id=?", [template]);
    try { assert.deepEqual((await request("GET", listPath())).body.data, []); assert.equal((await request("POST", `/customers/${customer}/messages/prepare`, a, body())).status, 404); }
    finally { await db.query("UPDATE message_templates SET status='active' WHERE id=?", [template]); }
  });
  test("missing phone, missing invoice variables and unsupported/malformed placeholders block preparation", async () => {
    await db.query("UPDATE customers SET phone=NULL WHERE id=?", [customer]);
    try {
      const preview = await request("POST", `/customers/${customer}/messages/preview`, a, body()); assert.equal(preview.body.data.can_prepare, false);
      assert.equal((await request("POST", `/customers/${customer}/messages/prepare`, a, body())).status, 409);
    } finally { await db.query("UPDATE customers SET phone='300 000 0000' WHERE id=?", [customer]); }
    for (const content of ["", "{{desconocida}}", "{{cliente", "{{factura}} {{fecha_vencimiento}} {{dias_mora}}"] ) {
      const [row] = await db.query("INSERT INTO message_templates(company_id,name,content) VALUES (?,'Variables fixture',?)", [a.companyId, content]);
      const payload = body({ template_id: String(row.insertId) });
      if (content.includes("factura")) await db.query("UPDATE invoices SET due_date='2026-12-01' WHERE customer_id=?", [customer]);
      try {
        const result = await request("POST", `/customers/${customer}/messages/preview`, a, payload); assert.equal(result.status, 200); assert.equal(result.body.data.can_prepare, false);
        assert.equal((await request("POST", `/customers/${customer}/messages/prepare`, a, payload)).status, 409);
      } finally { if (content.includes("factura")) { await db.query("UPDATE invoices SET due_date=IF(id=?,'2026-09-01','2026-09-25') WHERE customer_id=?", [primary, customer]); } }
    }
  });
  test("invalid identifiers/dates, removed client, disabled user and database failures fail safely", async () => {
    assert.equal((await request("POST", `/customers/${customer}/messages/preview`, a, body({ reference_date: "2026-02-30" }))).status, 400);
    assert.equal((await request("POST", `/customers/${customer}/messages/preview`, a, body({ template_id: "1 OR 1" }))).status, 400);
    await db.query("UPDATE users SET status='inactive' WHERE id=?", [a.id]);
    try { assert.equal((await request("GET", listPath())).status, 401); } finally { await db.query("UPDATE users SET status='active' WHERE id=?", [a.id]); }
    await db.query("UPDATE customers SET deleted_at=NOW() WHERE id=?", [customer]);
    try { assert.equal((await request("GET", listPath())).status, 404); } finally { await db.query("UPDATE customers SET deleted_at=NULL WHERE id=?", [customer]); }
    await db.query("RENAME TABLE message_templates TO fixture_templates_unavailable");
    try { const failure = await request("GET", listPath()); assert.equal(failure.status, 500); assert.doesNotMatch(failure.body.message, /SELECT|sql|message_templates/i); }
    finally { await db.query("RENAME TABLE fixture_templates_unavailable TO message_templates"); }
  });
});
