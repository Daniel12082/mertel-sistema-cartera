import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import { loadAuthConfig } from "../src/config/auth.js";
import { applyAuthMigrations } from "../src/services/authMigrations.service.js";
import { applyPortfolioImportMigration } from "../src/services/portfolioImportMigration.service.js";
import { makeMertelWorkbook, mertelRow } from "./fixtures/mertelPortfolioWorkbook.js";
dotenv.config({ path: new URL("../.env", import.meta.url), quiet: true });

describe("Fase 5.3 portfolio import HTTP / isolated MySQL", { skip: !(process.env.DB_HOST && process.env.DB_USER) }, () => {
  const schema = `mertel_portfolio_import_test_${randomUUID().replaceAll("-", "")}`;
  const originalDatabase = process.env.DB_NAME;
  const config = loadAuthConfig({ JWT_SECRET: randomBytes(48).toString("base64url"), FRONTEND_URL: "http://localhost:5173", AUTH_COOKIE_SAME_SITE: "lax", NODE_ENV: "test" });
  let db, pool, server, root, companyA, adminA, collectorA, adminB, globalAdmin;
  before(async () => {
    db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD, multipleStatements: true });
    await db.query(`CREATE DATABASE \`${schema}\``); await db.query(`USE \`${schema}\``);
    const sql = await readFile(new URL("../../database/migrations/001_initial_schema.sql", import.meta.url), "utf8");
    const required = new Set(["companies", "roles", "users", "user_roles", "customers", "invoices", "payments", "payment_allocations", "import_batches", "import_errors", "audit_logs", "settings"]);
    for (const match of sql.matchAll(/CREATE TABLE (\w+) \([\s\S]*?;/g)) if (required.has(match[1])) {
      const statement = match[1] === "import_errors" ? match[0].replace("row_number INT", "`row_number` INT").replace("KEY idx_import_errors_row (row_number)", "KEY idx_import_errors_row (`row_number`)") : match[0];
      await db.query(statement);
    }
    await db.query("INSERT INTO roles(name) VALUES ('admin'),('supervisor'),('collector')");
    await applyAuthMigrations(db); assert.equal((await applyPortfolioImportMigration(db)).applied, true); assert.equal((await applyPortfolioImportMigration(db)).applied, false);
    const [a] = await db.query("INSERT INTO companies(name) VALUES ('MERTEL IMPORTACIONES')"); companyA = String(a.insertId);
    const [customer] = await db.query("INSERT INTO customers(company_id,nit,name,phone) VALUES (?,'F-IMPORT','Fixture','3000000000')", [companyA]);
    await db.query("INSERT INTO invoices(company_id,customer_id,invoice_number,issue_date,due_date,document_value,base_value,balance) VALUES (?,?,'F-IMPORT','2026-09-01','2026-10-01',100,100,73)", [companyA, customer.insertId]);
    async function actor(companyId, role) {
      const [user] = await db.query("INSERT INTO users(company_id,first_name,email,password_hash) VALUES (?,'Fixture',?,'fixture-hash')", [companyId, `${randomUUID()}@example.test`]);
      await db.query("INSERT INTO user_roles(user_id,role_id) SELECT ?,id FROM roles WHERE name=?", [user.insertId, role]); return { id: String(user.insertId) };
    }
    process.env.DB_NAME = schema; ({ default: pool } = await import("../src/config/database.js"));
    const { issueAccessToken } = await import("../src/services/auth.service.js");
    adminA = await actor(companyA, "admin"); collectorA = await actor(companyA, "collector"); adminB = await actor(companyA, "admin"); globalAdmin = await actor(null, "admin");
    for (const user of [adminA, collectorA, adminB, globalAdmin]) user.token = issueAccessToken(user.id, config);
    const { createApp } = await import("../src/app.js");
    server = await new Promise(resolve => { const listener = createApp(config).listen(0, "127.0.0.1", () => resolve(listener)); });
    root = `http://127.0.0.1:${server.address().port}/api/admin/portfolio/imports`;
  });
  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve)); if (pool) await pool.end();
    if (db) { assert.match(schema, /^mertel_portfolio_import_test_[a-f0-9]{32}$/); assert.notEqual(schema, originalDatabase); await db.query(`DROP DATABASE IF EXISTS \`${schema}\``); await db.end(); }
    if (originalDatabase === undefined) delete process.env.DB_NAME; else process.env.DB_NAME = originalDatabase;
  });
  async function request(method, user = adminA, { companyId, body = "", fileName = "fixture.csv", mime = "text/csv", endpoint = "analyze" } = {}) {
    const url = new URL(`${root}${method === "POST" ? `/${endpoint}` : ""}`);
    if (companyId) url.searchParams.set("company_id", companyId); if (method === "POST") url.searchParams.set("file_name", fileName);
    const response = await fetch(url, { method, headers: { ...(user ? { Authorization: `Bearer ${user.token}` } : {}), ...(method === "POST" ? { "Content-Type": mime } : {}) }, ...(method === "POST" ? { body } : {}) });
    return { status: response.status, cache: response.headers.get("cache-control"), body: await response.json() };
  }
  test("analyzes CSV into batches and structured errors without changing financial tables", async () => {
    const snapshot = async () => {
      const [[c]] = await db.query("SELECT COUNT(*) AS n FROM customers"); const [[i]] = await db.query("SELECT COUNT(*) AS n,SUM(balance) AS balance FROM invoices");
      const [[p]] = await db.query("SELECT COUNT(*) AS n FROM payments"); const [[a]] = await db.query("SELECT COUNT(*) AS n FROM payment_allocations");
      return { customers: c.n, invoices: i.n, balance: String(i.balance), payments: p.n, allocations: a.n };
    };
    const before = await snapshot();
    const response = await request("POST", adminA, { body: "Campo A,Campo B\nuno,dos\ntres\n,\n" }); const data = response.body.data;
    assert.equal(response.status, 200); assert.equal(response.cache, "no-store"); assert.deepEqual(data.headers, ["Campo A", "Campo B"]);
    assert.equal(data.total_rows, 3); assert.equal(data.successful_rows, 1); assert.equal(data.failed_rows, 1); assert.equal(data.empty_rows, 1);
    assert.equal(data.format_configured, false); assert.equal(data.status, "analyzed_unconfigured"); assert.ok(data.issues.some(issue => issue.error_code === "RAGGED_ROW"));
    const [batch] = await db.query("SELECT status,file_sha256 FROM import_batches WHERE id=?", [data.batch_id]);
    const [errors] = await db.query("SELECT error_code,field_value FROM import_errors WHERE import_batch_id=?", [data.batch_id]);
    assert.equal(batch[0].status, "analyzed_unconfigured"); assert.match(batch[0].file_sha256, /^[a-f0-9]{64}$/);
    assert.ok(errors.some(row => row.error_code === "RAGGED_ROW")); assert.ok(errors.every(row => row.field_value === null)); assert.deepEqual(await snapshot(), before);
  });
  test("analyzes an MERTEL XLSX through HTTP without writing customers, invoices, payments or allocations", async () => {
    const snapshot = async () => {
      const [[c]] = await db.query("SELECT COUNT(*) AS n FROM customers"); const [[i]] = await db.query("SELECT COUNT(*) AS n,SUM(balance) AS balance FROM invoices");
      const [[p]] = await db.query("SELECT COUNT(*) AS n FROM payments"); const [[a]] = await db.query("SELECT COUNT(*) AS n FROM payment_allocations");
      return { customers: c.n, invoices: i.n, balance: String(i.balance), payments: p.n, allocations: a.n };
    };
    const before = await snapshot();
    const bytes = await makeMertelWorkbook({ rows: [mertelRow(), mertelRow({ Numero: "DVC-123", Movimiento: "023 Devolucion de clientes", "Valor doc.": "-165,065" }),
      mertelRow({ Numero: "NDC-123", Movimiento: "014 Nota debito cliente" }), mertelRow({ Numero: "", Movimiento: "", Emitida: "", Vence: "", "Valor doc.": "" }), []] });
    const response = await request("POST", adminA, { body: bytes, fileName: "cartera al 06-10.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const data = response.body.data;
    assert.equal(response.status, 200); assert.equal(data.format, "mertel_xlsx"); assert.equal(data.report.company_name, "MERTEL IMPORTACIONES S.A.S.");
    assert.equal(data.report.company_nit, "900.499.744-8"); assert.equal(data.report.report_date, "2026-10-06");
    assert.deepEqual(data.classifications, { document_rows: 3, customer_summary_rows: 1, report_summary_rows: 0, summary_rows: 1, empty_rows: 1, invalid_rows: 0 });
    assert.equal(data.summary.clients_detected, 1); assert.equal(data.summary.unique_documents, 3); assert.equal(data.summary.invoices, 1);
    assert.equal(data.summary.returns, 1); assert.equal(data.summary.debit_notes, 1); assert.equal(data.format_configured, true);
    const [batch] = await db.query("SELECT file_type,status FROM import_batches WHERE id=?", [data.batch_id]);
    assert.equal(batch[0].file_type, "xlsx"); assert.equal(batch[0].status, "analyzed_unconfigured");
    assert.deepEqual(await snapshot(), before);
  });
  test("rejects unsafe files before creating batches", async () => {
    const [[before]] = await db.query("SELECT COUNT(*) AS n FROM import_batches");
    assert.equal((await request("POST", adminA, { body: "abc", fileName: "bad.xlsx", mime: "application/octet-stream" })).status, 400);
    assert.equal((await request("POST", adminA, { body: "", fileName: "empty.csv" })).status, 400);
    assert.equal((await request("POST", adminA, { body: 'a,b\n"broken' })).status, 400);
    assert.equal((await request("POST", adminA, { body: Buffer.alloc(2 * 1024 * 1024 + 1) })).status, 413);
    const [[afterRows]] = await db.query("SELECT COUNT(*) AS n FROM import_batches"); assert.equal(afterRows.n, before.n);
  });
  test("deduplicates identical files, keeps MERTEL history scoped and resolves global admin automatically", async () => {
    const first = await request("POST", adminA, { body: "H1,H2\na,b\n" });
    const duplicate = await request("POST", adminA, { body: "H1,H2\na,b\n", fileName: "renamed.csv" });
    assert.equal(duplicate.body.data.duplicate, true); assert.equal(duplicate.body.data.batch_id, first.body.data.batch_id);
    assert.equal((await request("GET", collectorA)).status, 403);
    assert.equal((await request("GET", adminA)).body.data.some(row => row.id === first.body.data.batch_id), true);
    assert.equal((await request("GET", adminB)).body.data.length, 3);
    assert.equal((await request("GET", globalAdmin)).status, 200);
    assert.equal((await request("GET", globalAdmin, { companyId: companyA })).status, 200);
    assert.equal((await request("GET", globalAdmin, { companyId: "999999999" })).status, 403);
    assert.equal((await request("POST", globalAdmin, { body: "H\na\n" })).status, 200);
    assert.equal((await request("POST", globalAdmin, { body: "H\na\n", companyId: companyA })).status, 200);
  });
  test("returns a safe XLSX preview without persistence when the import schema is incomplete", async () => {
    const [[before]] = await db.query("SELECT COUNT(*) AS n FROM import_batches");
    await db.query("RENAME TABLE import_errors TO import_errors_deferred");
    try {
      const bytes = await makeMertelWorkbook({ rows: [mertelRow()] });
      const preview = await request("POST", adminA, { body: bytes, fileName: "cartera.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      assert.equal(preview.status, 200); assert.equal(preview.body.data.status, "preview_only_unpersisted");
      assert.equal(preview.body.data.persistence.saved, false); assert.equal(preview.body.data.summary.invoices, 1);
      const history = await request("GET", adminA);
      assert.equal(history.status, 503); assert.equal(history.body.code, "PORTFOLIO_SCHEMA_UNAVAILABLE");
      const [[after]] = await db.query("SELECT COUNT(*) AS n FROM import_batches"); assert.equal(after.n, before.n);
    } finally {
      await db.query("RENAME TABLE import_errors_deferred TO import_errors");
    }
  });
  test("reconciliation endpoint classifies XLSX read-only and preserves invoice balances and all financial tables", async () => {
    const [customer] = await db.query("INSERT INTO customers(company_id,nit,name,address,city) VALUES (?,'800.001.269-0','CLIENTE DEMOSTRACIÓN','DIRECCIÓN','BOGOTÁ')", [companyA]);
    await db.query("INSERT INTO invoices(company_id,customer_id,invoice_number,issue_date,due_date,document_value,base_value,iva_value,balance,status,notes) VALUES (?,?,'ME-12345','2026-10-06','2026-11-21',3482310,2914378,567932,2500000,'pending','FACTURA CLIENTE POR MAYOR')", [companyA, customer.insertId]);
    const snapshot = async () => {
      const [invoices] = await db.query("SELECT id,document_value,base_value,iva_value,balance,status FROM invoices ORDER BY id");
      const [payments] = await db.query("SELECT * FROM payments ORDER BY id"); const [allocations] = await db.query("SELECT * FROM payment_allocations ORDER BY id");
      const [customers] = await db.query("SELECT id,nit,name,address,city FROM customers ORDER BY id");
      return JSON.stringify({ invoices, payments, allocations, customers });
    };
    const before = await snapshot();
    const bytes = await makeMertelWorkbook({ rows: [mertelRow()] });
    const response = await request("POST", adminA, { body: bytes, fileName: "cartera al 06-10.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", endpoint: "reconcile" });
    assert.equal(response.status, 200); assert.equal(response.cache, "no-store");
    assert.equal(response.body.data.summary.updated, 0); assert.equal(response.body.data.summary.unchanged, 1);
    assert.equal(response.body.data.results[0].category, "UNCHANGED"); assert.equal(response.body.data.metadata.readOnly, true);
    assert.equal(await snapshot(), before);
  });
  test("XLSX pipeline reuses MERTEL rules in read-only mode, groups customers, and preserves financial snapshots", async () => {
    const rules = { version: 2, commercial_policy: "mertel_phase_5", stage_order: ["overdue", "due_today", "days_before_due", "prompt_payment"],
      rules: [{ key: "overdue", active: true }, { key: "due_today", active: true }, { key: "five_days_before_due", active: true, condition: { type: "days_before_due", days: 5 } }, { key: "prompt_payment", active: true, condition: "days_since_issue" }],
      prompt_payment: { window: { day_type: "calendar", include_issue_date: true, include_day_ten: true } } };
    await db.query("INSERT INTO settings(company_id,setting_key,setting_value,value_type) VALUES (?,'collection_rules',?,'json')", [companyA, JSON.stringify(rules)]);
    const snapshot = async () => {
      const [invoices] = await db.query("SELECT id,document_value,base_value,iva_value,balance,status FROM invoices ORDER BY id");
      const [payments] = await db.query("SELECT * FROM payments ORDER BY id"); const [allocations] = await db.query("SELECT * FROM payment_allocations ORDER BY id");
      const [customers] = await db.query("SELECT id,nit,name,address,city,phone FROM customers ORDER BY id");
      return JSON.stringify({ invoices, payments, allocations, customers });
    };
    const before = await snapshot();
    const rows = [
      mertelRow({ Numero: "ME-OVERDUE", Emitida: "01/09/2026", Vence: "01/10/2026", Corriente: "", "60-90 días": "2,500,000", "Valor doc.": "3,000,000" }),
      mertelRow({ "Nit Cliente": "800002001", Numero: "ME-DUE", Emitida: "01/10/2026", Vence: "06/10/2026", Corriente: "250,000", "Valor doc.": "500,000" }),
      mertelRow({ "Nit Cliente": "800002002", Numero: "ME-FIVE", Emitida: "01/10/2026", Vence: "11/10/2026", Corriente: "1,000", "Valor doc.": "1,000" }),
      mertelRow({ "Nit Cliente": "800002000", "Nombre cliente": "CLIENTE PRONTO", Numero: "ME-PROMPT", Emitida: "01/10/2026", Vence: "21/11/2026", Corriente: "900", "Valor doc.": "1,000" }),
      mertelRow({ Numero: "ME-OVERDUE-2", Emitida: "02/09/2026", Vence: "02/10/2026", Corriente: "", "60-90 días": "100", "Valor doc.": "2,000" }),
      mertelRow({ Numero: "DEV-1", Movimiento: "023 Devolucion de clientes", "Valor doc.": "-100" }),
      mertelRow({ Numero: "NDB-1", Movimiento: "014 Nota debito cliente", "Valor doc.": "100" }),
      mertelRow({ Numero: "ME-BAD", Emitida: "", Vence: "", Corriente: "texto" }),
    ];
    const bytes = await makeMertelWorkbook({ rows });
    const pipelineRequest = async (referenceDate) => {
      const url = new URL(`${root}/pipeline`); url.searchParams.set("file_name", "cartera al 06-10.xlsx");
      if (referenceDate) url.searchParams.set("reference_date", referenceDate);
      return fetch(url, { method: "POST", headers: { Authorization: `Bearer ${adminA.token}`, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, body: bytes });
    };
    assert.equal((await pipelineRequest(null)).status, 400); // No implicit server date.
    const accepted = await pipelineRequest("2026-10-06"); const result = await accepted.json(); const data = result.data;
    assert.equal(accepted.status, 200); assert.equal(accepted.headers.get("cache-control"), "no-store");
    assert.deepEqual([data.summary.overdue, data.summary.due_today, data.summary.due_in_five_days, data.summary.prompt_payment], [1, 1, 1, 1]);
    assert.equal(data.pipeline.length, 4); assert.equal(data.pipeline.find(item => item.customer.nit === "800.001.269-0").invoices.length, 2);
    const overdue = data.pipeline.find(item => item.stage === "overdue"); assert.equal(overdue.main_invoice.invoice.invoice_number, "ME-OVERDUE");
    assert.equal(overdue.documents.filter(document => document.movement_type === "return" || document.movement_type === "debit_note").length, 2);
    assert.equal(overdue.invoices.reduce((sum, item) => sum + Number(item.invoice.balance), 0), 2500100);
    const prompt = data.pipeline.find(item => item.stage === "prompt_payment");
    assert.equal(prompt.main_invoice.prompt_payment.eligibility.status, "manual_review"); assert.equal(prompt.main_invoice.prompt_payment.discount.preview_amount, null);
    assert.equal(data.errors.some(error => error.code === "INVALID_AGING_BALANCE" || error.code === "MISSING_ISSUE_DATE"), true);
    assert.equal(data.metadata.persisted, false); assert.equal(data.metadata.document_value_used_as_balance, false);
    assert.equal(await snapshot(), before);
    const invalid = await pipelineRequest("06/10/2026");
    assert.equal(invalid.status, 400); assert.equal(await snapshot(), before);
  });
});
