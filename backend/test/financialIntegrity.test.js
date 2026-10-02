import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import { loadAuthConfig } from "../src/config/auth.js";
import { hashPassword } from "../src/utils/password.js";

dotenv.config({ path: new URL("../.env", import.meta.url), quiet: true });
const configured = Boolean(process.env.DB_HOST && process.env.DB_USER);

// Only disposable fixtures are written. The configured application database
// is never selected by this suite. Missing credentials explicitly skip it.
describe("financial integrity HTTP / MySQL integration", { skip: !configured }, () => {
  const databaseName = `mertel_financial_test_${randomUUID().replaceAll("-", "")}`;
  const originalDatabase = process.env.DB_NAME;
  let admin;
  let pool;
  let server;
  let baseUrl;
  let accessToken;
  let customer;
  let otherCustomer;
  let company;
  let otherCompany;

  before(async () => {
    admin = await mysql.createConnection({
      host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
      user: process.env.DB_USER, password: process.env.DB_PASSWORD,
      multipleStatements: true,
    });
    await admin.query(`CREATE DATABASE \`${databaseName}\``);
    await admin.query(`USE \`${databaseName}\``);
    // Copy only tables used by the financial routes, with their real FKs.
    // Unrelated import tables in migration 001 use a reserved identifier on
    // this MySQL version; their schema is deliberately outside this suite.
    const initial = await readFile(new URL("../../database/migrations/001_initial_schema.sql", import.meta.url), "utf8");
    const tables = new Set(["companies", "roles", "users", "user_roles", "customers", "invoices", "payments", "payment_allocations", "payment_promises", "audit_logs"]);
    for (const match of initial.matchAll(/CREATE TABLE (\w+) \([\s\S]*?;/g)) {
      if (tables.has(match[1])) await admin.query(match[0]);
    }
    for (const migration of ["002_payment_allocations_soft_delete.sql", "003_active_payment_invoice_allocation_unique.sql", "004_auth_refresh_sessions.sql"]) {
      await admin.query(await readFile(new URL(`../../database/migrations/${migration}`, import.meta.url), "utf8"));
    }
    process.env.DB_NAME = databaseName;
    ({ default: pool } = await import("../src/config/database.js"));
    const { createApp } = await import("../src/app.js");
    const app = createApp(loadAuthConfig({ JWT_SECRET: randomBytes(48).toString("base64url"), FRONTEND_URL: "http://localhost:5173", AUTH_COOKIE_SAME_SITE: "lax", NODE_ENV: "test" }));
    const password = randomUUID();
    await pool.query("INSERT INTO users (first_name, email, password_hash) VALUES ('Financial test', 'financial-test@example.test', ?)", [await hashPassword(password)]);
    server = await new Promise((resolve) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}/api`;
    const session = await request("POST", "/auth/login", { email: "financial-test@example.test", password });
    assert.equal(session.status, 200);
    accessToken = session.body.data.access_token;
  });

  after(async () => {
    if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (pool) await pool.end();
    if (admin) {
      // Safety guard: the name must be the exact generated disposable schema.
      assert.match(databaseName, /^mertel_financial_test_[a-f0-9]{32}$/);
      await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
      await admin.end();
    }
    if (originalDatabase === undefined) delete process.env.DB_NAME;
    else process.env.DB_NAME = originalDatabase;
  });

  beforeEach(async () => {
    const [firstCompany] = await pool.query("INSERT INTO companies (name) VALUES ('Test company')");
    const [secondCompany] = await pool.query("INSERT INTO companies (name) VALUES ('Other test company')");
    company = firstCompany.insertId;
    otherCompany = secondCompany.insertId;
    const [first] = await pool.query("INSERT INTO customers (nit, name) VALUES (?, 'Test customer')", [randomUUID()]);
    const [second] = await pool.query("INSERT INTO customers (nit, name) VALUES (?, 'Other customer')", [randomUUID()]);
    customer = first.insertId;
    otherCustomer = second.insertId;
  });

  async function request(method, path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method, headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  }
  async function expectStatus(method, path, body, status) {
    const result = await request(method, path, body);
    assert.equal(result.status, status, JSON.stringify(result.body));
    return result.body?.data;
  }
  async function invoice(overrides = {}) {
    return expectStatus("POST", "/invoices", {
      customer_id: customer, invoice_number: randomUUID(),
      document_value: "100.00", base_value: "100.00", iva_value: "0.00",
      issue_date: "2026-10-01", due_date: "2026-10-31", ...overrides,
    }, 201);
  }
  async function payment(overrides = {}) {
    return expectStatus("POST", "/payments", {
      customer_id: customer, payment_date: "2026-10-02", amount: "100.00", ...overrides,
    }, 201);
  }
  async function allocate(p, i, amount = "50.00", status = 201) {
    return expectStatus("POST", `/payments/${p.id}/allocations`, { invoice_id: i.id, amount }, status);
  }
  async function pair(amount = "50.00") {
    const i = await invoice(); const p = await payment(); const a = await allocate(p, i, amount);
    return { i, p, a };
  }

  test("customer without debt can be soft-deleted; paid invoice and historical promises survive", async () => {
    const i = await invoice();
    await pool.query("UPDATE invoices SET balance = 0 WHERE id = ?", [i.id]);
    await pool.query("INSERT INTO payment_promises (customer_id, invoice_id, promised_date, promised_amount, status) VALUES (?, ?, '2026-10-02', 100, 'fulfilled')", [customer, i.id]);
    await expectStatus("DELETE", `/customers/${customer}`, undefined, 200);
    const [rows] = await pool.query("SELECT deleted_at FROM customers WHERE id = ?", [customer]);
    assert.ok(rows[0].deleted_at);
    const [history] = await pool.query("SELECT id FROM payment_promises WHERE customer_id = ?", [customer]);
    assert.equal(history.length, 1);
  });
  test("customer with one unpaid invoice returns 409", async () => {
    await invoice(); await expectStatus("DELETE", `/customers/${customer}`, undefined, 409);
  });
  test("customer with multiple invoices and any debt returns 409", async () => {
    await invoice(); const paid = await invoice();
    await pool.query("UPDATE invoices SET balance = 0 WHERE id = ?", [paid.id]);
    await expectStatus("DELETE", `/customers/${customer}`, undefined, 409);
  });
  test("customer with payment history returns 409, even for a non-applicable payment", async () => {
    await payment({ status: "legacy_non_applicable" });
    await expectStatus("DELETE", `/customers/${customer}`, undefined, 409);
  });
  test("customer with pending promise returns 409", async () => {
    await pool.query("INSERT INTO payment_promises (customer_id, promised_date, promised_amount) VALUES (?, '2026-10-02', 100)", [customer]);
    await expectStatus("DELETE", `/customers/${customer}`, undefined, 409);
  });
  test("customer with active application through an inconsistent historical invoice is protected", async () => {
    const { i } = await pair("100.00");
    await pool.query("UPDATE invoices SET customer_id = ? WHERE id = ?", [otherCustomer, i.id]);
    await expectStatus("DELETE", `/customers/${otherCustomer}`, undefined, 409);
  });
  test("unpaid invoice deletion returns 409", async () => {
    const i = await invoice(); await expectStatus("DELETE", `/invoices/${i.id}`, undefined, 409);
  });
  test("paid invoice with active application deletion returns 409", async () => {
    const { i } = await pair("100.00");
    await expectStatus("DELETE", `/invoices/${i.id}`, undefined, 409);
  });
  test("paid invoice without active applications is soft-deleted and keeps reversed history", async () => {
    const { i, p, a } = await pair();
    await expectStatus("DELETE", `/payments/${p.id}/allocations/${a.id}`, undefined, 200);
    await pool.query("UPDATE invoices SET balance = 0 WHERE id = ?", [i.id]);
    await expectStatus("DELETE", `/invoices/${i.id}`, undefined, 200);
    const [rows] = await pool.query("SELECT deleted_at FROM payment_allocations WHERE id = ?", [a.id]);
    assert.ok(rows[0].deleted_at);
  });
  test("pending invoice promise prevents deletion without removing history", async () => {
    const i = await invoice(); await pool.query("UPDATE invoices SET balance = 0 WHERE id = ?", [i.id]);
    await pool.query("INSERT INTO payment_promises (customer_id, invoice_id, promised_date, promised_amount) VALUES (?, ?, '2026-10-02', 100)", [customer, i.id]);
    await expectStatus("DELETE", `/invoices/${i.id}`, undefined, 409);
  });
  test("invoice customer and company can change without application history", async () => {
    const i = await invoice();
    const updated = await expectStatus("PUT", `/invoices/${i.id}`, { ...i, customer_id: otherCustomer, company_id: company, issue_date: null, due_date: null }, 200);
    assert.equal(updated.customer_id, otherCustomer); assert.equal(updated.company_id, company);
  });
  test("invoice customer and company cannot change with active or reversed applications", async () => {
    const { i, p, a } = await pair();
    for (const reversed of [false, true]) {
      if (reversed) await expectStatus("DELETE", `/payments/${p.id}/allocations/${a.id}`, undefined, 200);
      await expectStatus("PUT", `/invoices/${i.id}`, { ...i, customer_id: otherCustomer, issue_date: null, due_date: null }, 409);
      await expectStatus("PUT", `/invoices/${i.id}`, { ...i, company_id: company, issue_date: null, due_date: null }, 409);
    }
  });
  test("safe invoice edits remain allowed and backend ignores supplied balance", async () => {
    const { i } = await pair();
    const updated = await expectStatus("PUT", `/invoices/${i.id}`, { ...i, notes: "Edited safely", balance: "99999.00", issue_date: null, due_date: null }, 200);
    assert.equal(updated.balance, "50.00"); assert.equal(updated.notes, "Edited safely");
  });
  test("invoice reassignment preserves customer/company on historical promises", async () => {
    const i = await invoice();
    await pool.query("INSERT INTO payment_promises (customer_id, invoice_id, promised_date, promised_amount, status) VALUES (?, ?, '2026-10-02', 100, 'fulfilled')", [customer, i.id]);
    await expectStatus("PUT", `/invoices/${i.id}`, { ...i, customer_id: otherCustomer, issue_date: null, due_date: null }, 409);
    await expectStatus("PUT", `/invoices/${i.id}`, { ...i, company_id: company, issue_date: null, due_date: null }, 409);
    await expectStatus("PUT", `/invoices/${i.id}`, { ...i, notes: "Safe promise edit", issue_date: null, due_date: null }, 200);
  });
  test("invoice cannot fall below applications; total changes recalculate balance", async () => {
    const { i } = await pair();
    await expectStatus("PUT", `/invoices/${i.id}`, { ...i, document_value: "49.99", issue_date: null, due_date: null }, 409);
    const updated = await expectStatus("PUT", `/invoices/${i.id}`, { ...i, document_value: "75.00", issue_date: null, due_date: null }, 200);
    assert.equal(updated.balance, "25.00");
  });
  test("safe edit preserves a historical balance difference", async () => {
    const i = await invoice(); await pool.query("UPDATE invoices SET balance = 80 WHERE id = ?", [i.id]);
    const updated = await expectStatus("PUT", `/invoices/${i.id}`, { ...i, notes: "Keep actual balance", issue_date: null, due_date: null }, 200);
    assert.equal(updated.balance, "80.00");
  });
  test("invoice financial/date validation and initial balance are enforced", async () => {
    const i = await invoice({ balance: "1.00", base_value: "0.00", iva_value: "0.00", issue_date: null, due_date: null });
    assert.equal(i.balance, "100.00"); // No mandatory base + IVA formula.
    for (const invalid of [{ document_value: 0 }, { document_value: -1 }, { base_value: -1 }, { iva_value: -1 }, { issue_date: "2026-02-30" }, { due_date: "2026-13-01" }]) {
      await expectStatus("POST", "/invoices", { ...i, issue_date: null, due_date: null, ...invalid }, 400);
      await expectStatus("PUT", `/invoices/${i.id}`, { ...i, issue_date: null, due_date: null, ...invalid }, 400);
    }
  });
  test("confirmed payment applies successfully", async () => {
    const { p, a } = await pair(); assert.equal(p.status, "confirmed");
    assert.equal(a.invoice_balance, "50.00"); assert.equal(a.payment_available, "50.00");
  });
  test("non-applicable payment cannot apply", async () => {
    const i = await invoice(); const p = await payment({ status: "legacy_non_applicable" });
    await allocate(p, i, "50.00", 409);
  });
  test("payment status cannot invalidate active applications", async () => {
    const { p } = await pair();
    await expectStatus("PUT", `/payments/${p.id}`, { ...p, payment_date: "2026-10-02", status: "legacy_non_applicable" }, 409);
  });
  test("payment customer/company and amount cannot invalidate active or historical applications", async () => {
    const { p, a } = await pair();
    for (const reversed of [false, true]) {
      if (reversed) await expectStatus("DELETE", `/payments/${p.id}/allocations/${a.id}`, undefined, 200);
      await expectStatus("PUT", `/payments/${p.id}`, { ...p, payment_date: "2026-10-02", customer_id: otherCustomer }, 409);
      await expectStatus("PUT", `/payments/${p.id}`, { ...p, payment_date: "2026-10-02", company_id: company }, 409);
      await expectStatus("PUT", `/payments/${p.id}`, { ...p, payment_date: "2026-10-02", amount: "49.99" }, 409);
    }
  });
  test("payment status may change after all applications are reversed", async () => {
    const { p, a } = await pair();
    await expectStatus("DELETE", `/payments/${p.id}/allocations/${a.id}`, undefined, 200);
    await expectStatus("PUT", `/payments/${p.id}`, { ...p, payment_date: "2026-10-02", status: "legacy_non_applicable" }, 200);
  });
  test("safe payment edits and no-history reassignment remain possible", async () => {
    const { p } = await pair();
    await expectStatus("PUT", `/payments/${p.id}`, { ...p, payment_date: "2026-10-02", notes: "Safe edit" }, 200);
    const fresh = await payment();
    await expectStatus("PUT", `/payments/${fresh.id}`, { ...fresh, payment_date: "2026-10-02", customer_id: otherCustomer, amount: "75.00" }, 200);
  });
  test("payment positive amount, real date, active customer and syntactically valid status", async () => {
    const p = await payment();
    for (const invalid of [{ amount: 0 }, { amount: -1 }, { amount: "1.001" }, { payment_date: "2026-02-30" }, { status: "" }, { status: null }, { status: 123 }, { status: "x".repeat(31) }]) {
      await expectStatus("POST", "/payments", { ...p, payment_date: "2026-10-02", ...invalid }, 400);
      await expectStatus("PUT", `/payments/${p.id}`, { ...p, payment_date: "2026-10-02", ...invalid }, 400);
    }
    await pool.query("UPDATE customers SET status = 'inactive' WHERE id = ?", [otherCustomer]);
    await expectStatus("POST", "/payments", { ...p, customer_id: otherCustomer, payment_date: "2026-10-02" }, 409);
    await expectStatus("POST", "/payments", { ...p, customer_id: 999999999, payment_date: "2026-10-02" }, 404);
  });
  test("allocation requires same customer", async () => {
    const i = await invoice({ customer_id: otherCustomer }); const p = await payment();
    await allocate(p, i, "50.00", 409);
  });
  test("allocation rejects incompatible companies and accepts nullable sides", async () => {
    const i = await invoice({ company_id: company }); const p = await payment({ company_id: otherCompany });
    await allocate(p, i, "50.00", 409);
    const nullable = await payment(); await allocate(nullable, i);
    const noCompany = await invoice(); await allocate(p, noCompany);
  });
  test("documents reject incompatible customer company and absent company", async () => {
    await pool.query("UPDATE customers SET company_id = ? WHERE id = ?", [company, customer]);
    const i = await invoice({ company_id: company }); const p = await payment({ company_id: company });
    await expectStatus("POST", "/invoices", { ...i, invoice_number: randomUUID(), company_id: otherCompany, issue_date: null, due_date: null }, 409);
    await expectStatus("POST", "/payments", { ...p, company_id: otherCompany, payment_date: "2026-10-02" }, 409);
    await expectStatus("POST", "/invoices", { ...i, invoice_number: randomUUID(), company_id: 999999999, issue_date: null, due_date: null }, 404);
    await expectStatus("POST", "/payments", { ...p, company_id: 999999999, payment_date: "2026-10-02" }, 404);
  });
  test("allocations cannot exceed payment available or invoice balance", async () => {
    const i = await invoice({ document_value: "200.00" }); const p = await payment();
    await allocate(p, i, "100.01", 409);
    const small = await invoice({ document_value: "40.00" });
    await allocate(p, small, "40.01", 409);
    const current = await expectStatus("GET", `/payments/${p.id}`, undefined, 200);
    assert.equal(current.available_amount, "100.00");
  });
  test("missing/deleted resources and invalid allocation amounts are rejected", async () => {
    const i = await invoice(); const p = await payment();
    for (const amount of [0, -1, "0", "1.001", "invalid"]) await allocate(p, i, amount, 400);
    await allocate({ id: 999999999 }, i, "50.00", 404);
    await allocate(p, { id: 999999999 }, "50.00", 404);
    await pool.query("UPDATE invoices SET deleted_at = NOW() WHERE id = ?", [i.id]);
    await allocate(p, i, "50.00", 404);
    await pool.query("UPDATE customers SET deleted_at = NOW() WHERE id = ?", [customer]);
    await expectStatus("POST", "/payments", { customer_id: customer, payment_date: "2026-10-02", amount: 100 }, 404);
  });
  test("reversal restores both balances; same pair can be reassigned with new history", async () => {
    const { i, p, a } = await pair();
    await allocate(p, i, "1.00", 409);
    const reversal = await expectStatus("DELETE", `/payments/${p.id}/allocations/${a.id}`, undefined, 200);
    assert.equal(reversal.invoice_balance, "100.00"); assert.equal(reversal.payment_available, "100.00");
    await expectStatus("DELETE", `/payments/${p.id}/allocations/${a.id}`, undefined, 409);
    const next = await allocate(p, i, "100.00");
    assert.notEqual(next.id, a.id); assert.equal(next.invoice_balance, "0.00");
    const [history] = await pool.query("SELECT deleted_at FROM payment_allocations WHERE payment_id = ? AND invoice_id = ? ORDER BY id", [p.id, i.id]);
    assert.equal(history.length, 2); assert.ok(history[0].deleted_at); assert.equal(history[1].deleted_at, null);
  });
  test("concurrent allocations cannot overspend a payment across invoices", async () => {
    const first = await invoice(); const second = await invoice(); const p = await payment();
    const results = await Promise.all([first, second].map(i => request("POST", `/payments/${p.id}/allocations`, { invoice_id: i.id, amount: "70.00" })));
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
    const current = await expectStatus("GET", `/payments/${p.id}`, undefined, 200);
    assert.equal(current.total_allocated, "70.00"); assert.equal(current.available_amount, "30.00");
  });
  test("concurrent payments cannot overdraw a shared invoice", async () => {
    const i = await invoice(); const first = await payment(); const second = await payment();
    const results = await Promise.all([first, second].map(p => request("POST", `/payments/${p.id}/allocations`, { invoice_id: i.id, amount: "70.00" })));
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
    const current = await expectStatus("GET", `/invoices/${i.id}`, undefined, 200);
    assert.equal(current.balance, "30.00");
  });
  test("concurrent duplicate application produces only one active row", async () => {
    const i = await invoice(); const p = await payment();
    const results = await Promise.all([1, 2].map(() => request("POST", `/payments/${p.id}/allocations`, { invoice_id: i.id, amount: "30.00" })));
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
    const [rows] = await pool.query("SELECT COUNT(*) AS count FROM payment_allocations WHERE payment_id = ? AND deleted_at IS NULL", [p.id]);
    assert.equal(rows[0].count, 1);
  });
  test("concurrent reversal executes exactly once", async () => {
    const { i, p, a } = await pair();
    const results = await Promise.all([1, 2].map(() => request("DELETE", `/payments/${p.id}/allocations/${a.id}`)));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    const current = await expectStatus("GET", `/invoices/${i.id}`, undefined, 200);
    assert.equal(current.balance, "100.00");
  });
  test("customer delete racing invoice creation cannot hide a new debt", async () => {
    const results = await Promise.all([
      request("DELETE", `/customers/${customer}`),
      request("POST", "/invoices", { customer_id: customer, invoice_number: randomUUID(), document_value: 100, base_value: 100, iva_value: 0 }),
    ]);
    const [hidden] = await pool.query("SELECT COUNT(*) AS count FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.customer_id=? AND i.balance>0 AND c.deleted_at IS NOT NULL", [customer]);
    assert.equal(hidden[0].count, 0);
    assert.ok((results[0].status === 200 && results[1].status === 404) || (results[0].status === 409 && results[1].status === 201), JSON.stringify(results));
  });
  test("invoice value edit racing allocation preserves total minus applications", async () => {
    const i = await invoice(); const p = await payment();
    const results = await Promise.all([
      request("PUT", `/invoices/${i.id}`, { ...i, document_value: "80.00", issue_date: null, due_date: null }),
      request("POST", `/payments/${p.id}/allocations`, { invoice_id: i.id, amount: "50.00" }),
    ]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 201], JSON.stringify(results));
    const updated = await expectStatus("GET", `/invoices/${i.id}`, undefined, 200);
    assert.equal(updated.document_value, "80.00"); assert.equal(updated.balance, "30.00");
  });
  test("allocation failure rolls back inserted application and returns no raw SQL", async () => {
    const i = await invoice(); const p = await payment();
    await admin.query("CREATE TRIGGER test_balance_failure BEFORE UPDATE ON invoices FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'private_sql_failure'");
    try {
      const result = await request("POST", `/payments/${p.id}/allocations`, { invoice_id: i.id, amount: "50.00" });
      assert.equal(result.status, 500);
      assert.equal(result.body.message, "No se pudo procesar la solicitud de pagos");
      const [rows] = await pool.query("SELECT COUNT(*) AS count FROM payment_allocations WHERE payment_id = ?", [p.id]);
      assert.equal(rows[0].count, 0);
      const updated = await expectStatus("GET", `/invoices/${i.id}`, undefined, 200);
      assert.equal(updated.balance, "100.00");
    } finally { await admin.query("DROP TRIGGER test_balance_failure"); }
  });
});
