import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import { loadAuthConfig } from "../src/config/auth.js";
import { applyAuthMigrations } from "../src/services/authMigrations.service.js";
import { collectionStageCatalog } from "../src/services/collectionPolicy.js";
import { evaluateCollectionInvoice } from "../src/services/collectionEngine.service.js";
dotenv.config({ path: new URL("../.env", import.meta.url), quiet: true });

describe("5.1A template and 5.2 collection settings administration HTTP / MySQL", { skip: !(process.env.DB_HOST && process.env.DB_USER) }, () => {
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

  test("settings admin exposes supported stage controls, enforces scope and audits changes", async () => {
    assert.equal((await request("GET", "/admin/settings", null)).status, 401);
    assert.equal((await request("GET", "/admin/settings", collectorA)).status, 403);
    assert.equal((await request("GET", "/admin/settings", supervisorA)).status, 403);
    const requestStages = JSON.parse(await readFile(new URL("../config/mertel-collection-rules.json", import.meta.url), "utf8")).rules.map(item => ({ key: item.key, active: item.active }));
    assert.equal((await request("PUT", "/admin/settings/collection-rules", collectorA, { stages: requestStages })).status, 403);
    assert.equal((await request("PUT", "/admin/settings/collection-rules", supervisorA, { stages: requestStages })).status, 403);
    assert.equal((await request("GET", "/admin/settings", globalAdmin)).status, 400);
    assert.equal((await request("GET", `/admin/settings?company_id=${companyA}`, globalAdmin)).status, 200);
    const before = await request("GET", `/admin/settings?company_id=${companyA}`);
    assert.equal(before.status, 200); assert.equal(before.cache, "no-store");
    assert.equal(before.body.data.configured, true);
    assert.equal(before.body.data.settings.find(item => item.key === "prompt_payment.percentage").value, 3);
    assert.equal(before.body.data.settings.find(item => item.key === "prompt_payment.percentage").editable, false);
    assert.deepEqual(before.body.data.stages.map(item => item.key), ["overdue", "due_today", "five_days_before_due", "prompt_payment"]);

    const stages = before.body.data.stages.map(item => ({ key: item.key, active: item.key === "due_today" ? false : item.value }));
    const engineInvoice = { id: "fixture-engine", customer_id: customer, company_id: companyA, issue_date: "2026-09-01", due_date: "2026-10-05", balance: "100.00" };
    const financialSnapshot = async () => {
      const [[invoices]] = await db.query("SELECT COUNT(*) AS count,COALESCE(SUM(balance),0) AS balance FROM invoices WHERE company_id=?", [companyA]);
      const [[payments]] = await db.query("SELECT COUNT(*) AS count,COALESCE(SUM(amount),0) AS amount FROM payments WHERE company_id=?", [companyA]);
      const [[allocations]] = await db.query("SELECT COUNT(*) AS count,COALESCE(SUM(pa.amount),0) AS amount FROM payment_allocations pa JOIN payments p ON p.id=pa.payment_id WHERE p.company_id=?", [companyA]);
      return { invoices: { count: invoices.count, balance: String(invoices.balance) }, payments: { count: payments.count, amount: String(payments.amount) }, allocations: { count: allocations.count, amount: String(allocations.amount) } };
    };
    const financialBefore = await financialSnapshot();
    assert.equal(evaluateCollectionInvoice({ referenceDate: "2026-10-05", invoice: engineInvoice, rules: JSON.parse((await db.query("SELECT setting_value FROM settings WHERE company_id=? AND setting_key='collection_rules'", [companyA]))[0][0].setting_value) }).stage, "due_today");
    const updated = await request("PUT", `/admin/settings/collection-rules?company_id=${companyA}`, adminA, { stages });
    assert.equal(updated.status, 200); assert.equal(updated.body.data.stages.find(item => item.key === "due_today").value, false);
    const persistedRules = JSON.parse((await db.query("SELECT setting_value FROM settings WHERE company_id=? AND setting_key='collection_rules'", [companyA]))[0][0].setting_value);
    assert.equal(evaluateCollectionInvoice({ referenceDate: "2026-10-05", invoice: engineInvoice, rules: persistedRules }).stage, "no_eligible");
    assert.equal((await request("PUT", `/admin/settings/collection-rules?company_id=${companyB}`, adminA, { stages })).body.data.stages.find(item => item.key === "due_today").value, false);
    assert.equal((await request("GET", `/admin/settings?company_id=${companyB}`, adminA)).body.data.stages.find(item => item.key === "due_today").value, false);
    assert.equal((await request("GET", `/admin/settings?company_id=${companyA}`, adminB)).body.data.stages.find(item => item.key === "due_today").value, true);
    assert.equal((await request("PUT", "/admin/settings/collection-rules", globalAdmin, { stages })).status, 400);
    assert.deepEqual(await financialSnapshot(), financialBefore);

    const [logs] = await db.query("SELECT company_id,user_id,action,old_values,new_values FROM audit_logs WHERE entity_type='setting' AND entity_id=(SELECT id FROM settings WHERE company_id=? AND setting_key='collection_rules') ORDER BY id DESC LIMIT 1", [companyA]);
    assert.equal(String(logs[0].company_id), companyA); assert.equal(String(logs[0].user_id), adminA.id); assert.equal(logs[0].action, "update");
    const oldValues = typeof logs[0].old_values === "string" ? JSON.parse(logs[0].old_values) : logs[0].old_values;
    const newValues = typeof logs[0].new_values === "string" ? JSON.parse(logs[0].new_values) : logs[0].new_values;
    assert.equal(oldValues.stages.find(item => item.key === "due_today").active, true);
    assert.equal(newValues.stages.find(item => item.key === "due_today").active, false);
  });

  test("settings admin rejects unknown keys, forged scope fields and malformed values", async () => {
    const stages = [{ key: "overdue", active: true }, { key: "due_today", active: true }, { key: "five_days_before_due", active: true }, { key: "prompt_payment", active: true }];
    const invalid = [
      { stages, company_id: companyB },
      { stages: [...stages, { key: "reminder_days_before_due", active: true }] },
      { stages: stages.map(item => item.key === "due_today" ? { ...item, active: 1 } : item) },
      { stages: stages.map(item => item.key === "five_days_before_due" ? { ...item, days_before_due: 6 } : item) },
      { stages: stages.map(item => item.key === "prompt_payment" ? { ...item, percentage: 15 } : item) },
      { stages: stages.slice(1) },
    ];
    for (const body of invalid) {
      const result = await request("PUT", "/admin/settings/collection-rules", adminA, body);
      assert.equal(result.status, 400, JSON.stringify(body));
    }
    const scopedToB = await request("PUT", `/admin/settings/collection-rules?company_id=${companyA}`, adminB, { stages });
    assert.equal(scopedToB.status, 200);
    assert.equal((await request("GET", `/admin/settings?company_id=${companyA}`, adminB)).body.data.stages.find(item => item.key === "due_today").value, true);
  });
});
