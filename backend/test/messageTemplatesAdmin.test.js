import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import { loadAuthConfig } from "../src/config/auth.js";
import { applyAuthMigrations } from "../src/services/authMigrations.service.js";
import { collectionStageCatalog } from "../src/services/collectionPolicy.js";
dotenv.config({ path: new URL("../.env", import.meta.url), quiet: true });

describe("5.1A WhatsApp template administration HTTP / MySQL", { skip: !(process.env.DB_HOST && process.env.DB_USER) }, () => {
  const schema = `mertel_templates_admin_test_${randomUUID().replaceAll("-", "")}`;
  const originalDatabase = process.env.DB_NAME;
  const config = loadAuthConfig({ JWT_SECRET: randomBytes(48).toString("base64url"), FRONTEND_URL: "http://localhost:5173",
    AUTH_COOKIE_SAME_SITE: "lax", NODE_ENV: "test", AUTH_RATE_LIMIT_MAX: "1000" });
  let db, pool, server, root, companyA, companyB, adminA, collectorA, supervisorA, adminB, globalAdmin, customer, supportedStage, templateId, foreignTemplate;

  before(async () => {
    db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER,
      password: process.env.DB_PASSWORD, multipleStatements: true });
    await db.query(`CREATE DATABASE \`${schema}\``); await db.query(`USE \`${schema}\``);
    const initial = await readFile(new URL("../../database/migrations/001_initial_schema.sql", import.meta.url), "utf8");
    const tables = new Set(["companies", "roles", "users", "user_roles", "customers", "invoices", "payments", "payment_allocations",
      "collection_actions", "payment_promises", "message_templates", "messages", "settings", "audit_logs"]);
    for (const match of initial.matchAll(/CREATE TABLE (\w+) \([\s\S]*?;/g)) if (tables.has(match[1])) await db.query(match[0]);
    await db.query("INSERT INTO roles(name) VALUES ('admin'),('supervisor'),('collector')");
    await applyAuthMigrations(db);
    const [a] = await db.query("INSERT INTO companies(name) VALUES ('Plantillas fixture A')"); companyA = String(a.insertId);
    const [b] = await db.query("INSERT INTO companies(name) VALUES ('Plantillas fixture B')"); companyB = String(b.insertId);
    const rules = JSON.parse(await readFile(new URL("../config/mertel-collection-rules.json", import.meta.url), "utf8"));
    supportedStage = collectionStageCatalog(rules)[0].key;
    for (const companyId of [companyA, companyB]) await db.query("INSERT INTO settings(company_id,setting_key,setting_value,value_type) VALUES (?,'collection_rules',?,'json')", [companyId, JSON.stringify(rules)]);
    const [client] = await db.query("INSERT INTO customers(company_id,nit,name,phone) VALUES (?,'FIXTURE-ADMIN','Cliente fixture','3000000000')", [companyA]); customer = String(client.insertId);
    await db.query("INSERT INTO invoices(company_id,customer_id,invoice_number,issue_date,due_date,document_value,base_value,balance) VALUES (?,?,'FV-ADMIN','2026-08-01','2026-09-01',100,100,100)", [companyA, customer]);
    async function actor(companyId, role) {
      const [user] = await db.query("INSERT INTO users(company_id,first_name,email,password_hash) VALUES (?,'Fixture',?,'unusable-fixture-hash')", [companyId, `${randomUUID()}@example.test`]);
      await db.query("INSERT INTO user_roles(user_id,role_id) SELECT ?,id FROM roles WHERE name=?", [user.insertId, role]);
      return { id: String(user.insertId), token: null };
    }
    process.env.DB_NAME = schema; ({ default: pool } = await import("../src/config/database.js"));
    const { issueAccessToken } = await import("../src/services/auth.service.js");
    adminA = await actor(companyA, "admin"); collectorA = await actor(companyA, "collector"); supervisorA = await actor(companyA, "supervisor");
    adminB = await actor(companyB, "admin"); globalAdmin = await actor(null, "admin");
    for (const actorUser of [adminA, collectorA, supervisorA, adminB, globalAdmin]) actorUser.token = issueAccessToken(actorUser.id, config);
    const [template] = await db.query("INSERT INTO message_templates(company_id,name,content,stage,status) VALUES (?,'Plantilla de otra empresa','Privada','overdue','active')", [companyB]);
    foreignTemplate = String(template.insertId);
    await db.query("INSERT INTO message_templates(company_id,name,content,channel,status) VALUES (?,'Plantilla de correo','Solo correo','email','active')", [companyA]);
    const { createApp } = await import("../src/app.js");
    server = await new Promise(resolve => { const listener = createApp(config).listen(0, "127.0.0.1", () => resolve(listener)); });
    root = `http://127.0.0.1:${server.address().port}/api`;
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (pool) await pool.end();
    if (db) { assert.match(schema, /^mertel_templates_admin_test_[a-f0-9]{32}$/); assert.notEqual(schema, originalDatabase); await db.query(`DROP DATABASE IF EXISTS \`${schema}\``); await db.end(); }
    if (originalDatabase === undefined) delete process.env.DB_NAME; else process.env.DB_NAME = originalDatabase;
  });

  async function request(method, path, actor = adminA, body) {
    const response = await fetch(root + path, { method, headers: { "Content-Type": "application/json", ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, cache: response.headers.get("cache-control"), body: await response.json() };
  }
  const adminPath = "/collection/message-templates";
  const validTemplate = extra => ({ name: "Recordatorio de pago", channel: "whatsapp", content: "Hola {{nombre_cliente}}, saldo {{saldo_pendiente}}", stage: supportedStage, ...extra });

  test("requires the dedicated admin permission and returns only WhatsApp templates from the company scope", async () => {
    assert.equal((await request("GET", adminPath, null)).status, 401);
    assert.equal((await request("GET", adminPath, collectorA)).status, 403);
    assert.equal((await request("GET", adminPath, supervisorA)).status, 403);
    const own = await request("GET", adminPath);
    assert.equal(own.status, 200); assert.equal(own.cache, "no-store");
    assert.deepEqual(own.body.data.templates, []); assert.ok(own.body.data.stage_catalog.some(stage => stage.key === supportedStage));
    assert.deepEqual(own.body.data.variables.filter(item => !item.legacy).map(item => item.name), [
      "nombre_cliente", "identificacion_cliente", "telefono_cliente", "numero_factura", "fecha_factura", "fecha_vencimiento",
      "valor_factura", "saldo_pendiente", "dias_mora", "dias_para_vencimiento", "etapa_cobranza", "motivo_cobranza",
    ]);
    assert.equal(own.body.data.templates.some(item => item.channel === "email"), false);
    assert.equal((await request("GET", `${adminPath}?company_id=${companyB}`)).body.data.templates.some(item => item.id === foreignTemplate), false);
    assert.equal((await request("GET", adminPath, globalAdmin)).status, 400);
    assert.equal((await request("GET", `${adminPath}?company_id=${companyA}`, globalAdmin)).status, 200);
  });

  test("server rejects empty fields, invalid channels, malformed/unknown variables, invalid stages and forged company fields", async () => {
    const invalid = [
      [{ ...validTemplate(), name: " " }, /nombre/i],
      [{ ...validTemplate(), content: "  " }, /contenido/i],
      [{ ...validTemplate(), channel: "email" }, /canal/i],
      [{ ...validTemplate(), content: "{{variable_inventada}}" }, /no soportada/i],
      [{ ...validTemplate(), content: "{{nombre_cliente" }, /mal formadas/i],
      [{ ...validTemplate(), content: "{{nombre_cliente}} }" }, /mal formadas/i],
      [{ ...validTemplate(), stage: "etapa_inventada" }, /catálogo activo/i],
      [{ ...validTemplate(), company_id: companyB }, /Campos de plantilla/i],
    ];
    for (const [payload, expected] of invalid) {
      const result = await request("POST", adminPath, adminA, payload);
      assert.equal(result.status, 400, JSON.stringify(payload)); assert.match(result.body.message, expected);
    }
  });

  test("creates, edits, activates and deactivates a template without allowing cross-company edits", async () => {
    const created = await request("POST", adminPath, adminA, validTemplate({ status: "inactive" }));
    assert.equal(created.status, 201); assert.equal(created.body.data.status, "inactive"); assert.equal(created.body.data.created_by, adminA.id);
    templateId = created.body.data.id;
    const edit = await request("PUT", `${adminPath}/${templateId}`, adminA, { ...validTemplate(), name: "Recordatorio actualizado", content: "Factura {{numero_factura}}" });
    assert.equal(edit.status, 200); assert.equal(edit.body.data.name, "Recordatorio actualizado"); assert.equal(edit.body.data.content, "Factura {{numero_factura}}");
    const sameEdit = await request("PUT", `${adminPath}/${templateId}`, adminA, { ...validTemplate(), name: "Recordatorio actualizado", content: "Factura {{numero_factura}}" });
    assert.equal(sameEdit.status, 200); assert.equal(sameEdit.body.data.id, templateId);
    assert.equal((await request("PUT", `${adminPath}/${templateId}`, adminB, validTemplate())).status, 404);
    assert.equal((await request("POST", `${adminPath}/${foreignTemplate}/activate`, adminA)).status, 404);
    assert.equal((await request("POST", `${adminPath}/${templateId}/activate`, adminA)).body.data.status, "active");
    assert.equal((await request("POST", `${adminPath}/${templateId}/activate`, adminA)).body.data.status, "active");
    const userTemplates = await request("GET", `/collection/customers/${customer}/message-templates?reference_date=2026-10-05`, collectorA);
    assert.equal(userTemplates.status, 200); assert.ok(userTemplates.body.data.some(item => item.id === templateId));
    assert.equal((await request("POST", `${adminPath}/${templateId}/deactivate`, adminA)).body.data.status, "inactive");
    const afterDeactivate = await request("GET", `/collection/customers/${customer}/message-templates?reference_date=2026-10-05`, collectorA);
    assert.equal(afterDeactivate.status, 200); assert.equal(afterDeactivate.body.data.some(item => item.id === templateId), false);
    const ownList = await request("GET", adminPath, adminA);
    assert.ok(ownList.body.data.templates.some(item => item.id === templateId && item.status === "inactive"));
  });
});
