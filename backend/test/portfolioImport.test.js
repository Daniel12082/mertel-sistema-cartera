import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import { loadAuthConfig } from "../src/config/auth.js";
import { applyAuthMigrations } from "../src/services/authMigrations.service.js";
import { applyPortfolioImportMigration } from "../src/services/portfolioImportMigration.service.js";
dotenv.config({ path: new URL("../.env", import.meta.url), quiet: true });

describe("Fase 5.3 portfolio import HTTP / isolated MySQL", { skip: !(process.env.DB_HOST && process.env.DB_USER) }, () => {
  const schema = `mertel_portfolio_import_test_${randomUUID().replaceAll("-", "")}`;
  const originalDatabase = process.env.DB_NAME;
  const config = loadAuthConfig({ JWT_SECRET: randomBytes(48).toString("base64url"), FRONTEND_URL: "http://localhost:5173", AUTH_COOKIE_SAME_SITE: "lax", NODE_ENV: "test" });
  let db, pool, server, root, companyA, companyB, adminA, collectorA, adminB, globalAdmin;
  before(async () => {
    db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD, multipleStatements: true });
    await db.query(`CREATE DATABASE \`${schema}\``); await db.query(`USE \`${schema}\``);
    const sql = await readFile(new URL("../../database/migrations/001_initial_schema.sql", import.meta.url), "utf8");
    const required = new Set(["companies", "roles", "users", "user_roles", "customers", "invoices", "payments", "payment_allocations", "import_batches", "import_errors", "audit_logs"]);
    for (const match of sql.matchAll(/CREATE TABLE (\w+) \([\s\S]*?;/g)) if (required.has(match[1])) {
      const statement = match[1] === "import_errors" ? match[0].replace("row_number INT", "`row_number` INT").replace("KEY idx_import_errors_row (row_number)", "KEY idx_import_errors_row (`row_number`)") : match[0];
      await db.query(statement);
    }
    await db.query("INSERT INTO roles(name) VALUES ('admin'),('supervisor'),('collector')");
    await applyAuthMigrations(db); assert.equal((await applyPortfolioImportMigration(db)).applied, true); assert.equal((await applyPortfolioImportMigration(db)).applied, false);
    const [a] = await db.query("INSERT INTO companies(name) VALUES ('Import fixture A')"); companyA = String(a.insertId);
    const [b] = await db.query("INSERT INTO companies(name) VALUES ('Import fixture B')"); companyB = String(b.insertId);
    const [customer] = await db.query("INSERT INTO customers(company_id,nit,name,phone) VALUES (?,'F-IMPORT','Fixture','3000000000')", [companyA]);
    await db.query("INSERT INTO invoices(company_id,customer_id,invoice_number,issue_date,due_date,document_value,base_value,balance) VALUES (?,?,'F-IMPORT','2026-09-01','2026-10-01',100,100,73)", [companyA, customer.insertId]);
    async function actor(companyId, role) {
      const [user] = await db.query("INSERT INTO users(company_id,first_name,email,password_hash) VALUES (?,'Fixture',?,'fixture-hash')", [companyId, `${randomUUID()}@example.test`]);
      await db.query("INSERT INTO user_roles(user_id,role_id) SELECT ?,id FROM roles WHERE name=?", [user.insertId, role]); return { id: String(user.insertId) };
    }
    process.env.DB_NAME = schema; ({ default: pool } = await import("../src/config/database.js"));
    const { issueAccessToken } = await import("../src/services/auth.service.js");
    adminA = await actor(companyA, "admin"); collectorA = await actor(companyA, "collector"); adminB = await actor(companyB, "admin"); globalAdmin = await actor(null, "admin");
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
  async function request(method, user = adminA, { companyId, body = "", fileName = "fixture.csv", mime = "text/csv" } = {}) {
    const url = new URL(`${root}${method === "POST" ? "/analyze" : ""}`);
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
  test("rejects unsafe files before creating batches", async () => {
    const [[before]] = await db.query("SELECT COUNT(*) AS n FROM import_batches");
    assert.equal((await request("POST", adminA, { body: "abc", fileName: "bad.xlsx", mime: "application/octet-stream" })).status, 400);
    assert.equal((await request("POST", adminA, { body: "", fileName: "empty.csv" })).status, 400);
    assert.equal((await request("POST", adminA, { body: 'a,b\n"broken' })).status, 400);
    assert.equal((await request("POST", adminA, { body: Buffer.alloc(2 * 1024 * 1024 + 1) })).status, 413);
    const [[afterRows]] = await db.query("SELECT COUNT(*) AS n FROM import_batches"); assert.equal(afterRows.n, before.n);
  });
  test("deduplicates identical files, isolates company history and requires global scope", async () => {
    const first = await request("POST", adminA, { body: "H1,H2\na,b\n" });
    const duplicate = await request("POST", adminA, { body: "H1,H2\na,b\n", fileName: "renamed.csv" });
    assert.equal(duplicate.body.data.duplicate, true); assert.equal(duplicate.body.data.batch_id, first.body.data.batch_id);
    assert.equal((await request("GET", collectorA)).status, 403);
    assert.equal((await request("GET", adminA)).body.data.some(row => row.id === first.body.data.batch_id), true);
    assert.equal((await request("GET", adminB)).body.data.length, 0);
    assert.equal((await request("GET", globalAdmin)).status, 400);
    assert.equal((await request("GET", globalAdmin, { companyId: companyA })).status, 200);
    assert.equal((await request("POST", globalAdmin, { body: "H\na\n" })).status, 400);
    assert.equal((await request("POST", globalAdmin, { body: "H\na\n", companyId: companyA })).status, 200);
  });
});
