import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import jwt from "jsonwebtoken";
import { loadAuthConfig } from "../src/config/auth.js";
import { hashPassword, verifyPassword } from "../src/utils/password.js";
import { provisionFirstAdmin } from "../src/services/adminProvisioning.service.js";
import { applyAuthMigrations } from "../src/services/authMigrations.service.js";
dotenv.config({ path: new URL("../.env", import.meta.url), quiet: true });

// All users/credentials here are disposable fixtures in a generated schema, never the application database.
describe("role authorization and internal admin provisioning HTTP / MySQL", { skip: !(process.env.DB_HOST && process.env.DB_USER) }, () => {
  const databaseName = `mertel_authorization_test_${randomUUID().replaceAll("-", "")}`;
  const originalDatabase = process.env.DB_NAME;
  const password = randomBytes(32).toString("base64url");
  const config = loadAuthConfig({ JWT_SECRET: randomBytes(48).toString("base64url"), FRONTEND_URL: "http://localhost:5173",
    AUTH_COOKIE_SAME_SITE: "lax", NODE_ENV: "test", AUTH_RATE_LIMIT_MAX: "1000" });
  let db; let pool; let server; let url; let userId; let email; let storedHash; let companyId;
  before(async () => {
    db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER,
      password: process.env.DB_PASSWORD, multipleStatements: true });
    await db.query(`CREATE DATABASE \`${databaseName}\``); await db.query(`USE \`${databaseName}\``);
    const schema = await readFile(new URL("../../database/migrations/001_initial_schema.sql", import.meta.url), "utf8");
    const tables = new Set(["companies", "roles", "users", "user_roles", "customers", "invoices", "payments", "payment_allocations", "payment_promises", "audit_logs", "settings"]);
    for (const match of schema.matchAll(/CREATE TABLE (\w+) \([\s\S]*?;/g)) if (tables.has(match[1])) await db.query(match[0]);
    await db.query("INSERT INTO roles (name) VALUES ('admin'), ('supervisor'), ('collector')");
    for (const file of ["002_payment_allocations_soft_delete.sql", "003_active_payment_invoice_allocation_unique.sql"]) {
      await db.query(await readFile(new URL(`../../database/migrations/${file}`, import.meta.url), "utf8"));
    }
    assert.ok((await applyAuthMigrations(db)).every(result => result.applied));
    const [company] = await db.query("INSERT INTO companies (name) VALUES ('Authorization fixture company')");
    companyId = company.insertId;
    process.env.DB_NAME = databaseName;
    ({ default: pool } = await import("../src/config/database.js"));
    const { createApp } = await import("../src/app.js");
    server = await new Promise(resolve => { const listener = createApp(config).listen(0, "127.0.0.1", () => resolve(listener)); });
    url = `http://127.0.0.1:${server.address().port}/api`;
    storedHash = await hashPassword(password);
  });
  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (pool) await pool.end();
    if (db) {
      assert.match(databaseName, /^mertel_authorization_test_[a-f0-9]{32}$/);
      await db.query(`DROP DATABASE IF EXISTS \`${databaseName}\``); await db.end();
    }
    if (originalDatabase === undefined) delete process.env.DB_NAME; else process.env.DB_NAME = originalDatabase;
  });
  beforeEach(async () => {
    await db.query("DELETE FROM users");
    email = `${randomUUID()}@example.test`;
    const [user] = await db.query("INSERT INTO users (company_id,first_name,email,password_hash) VALUES (?,'Authorization fixture',?,?)", [companyId, email, storedHash]);
    userId = String(user.insertId);
    await role("collector");
  });
  async function role(name) {
    await db.query("DELETE FROM user_roles WHERE user_id=?", [userId]);
    if (name) await db.query("INSERT INTO user_roles (user_id,role_id) SELECT ?,id FROM roles WHERE name=?", [userId, name]);
  }
  async function request(method, path, { token, body, headers = {}, cookie } = {}) {
    const response = await fetch(`${url}${path}`, { method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: response.status === 204 ? null : await response.json(), headers: response.headers };
  }
  async function login(body = { email, password }) {
    const response = await request("POST", "/auth/login", { body });
    assert.equal(response.status, 200, JSON.stringify(response.body)); return response;
  }
  const routes = [
    ["GET", "/customers", "customers.view", 200], ["GET", "/customers/999999", "customers.view", 404],
    ["POST", "/customers", "customers.create", 400], ["PUT", "/customers/999999", "customers.update", 400], ["DELETE", "/customers/999999", "customers.delete", 404],
    ["GET", "/invoices", "invoices.view", 200], ["GET", "/invoices/999999", "invoices.view", 404],
    ["POST", "/invoices", "invoices.create", 400], ["PUT", "/invoices/999999", "invoices.update", 400], ["DELETE", "/invoices/999999", "invoices.delete", 404],
    ["GET", "/payments", "payments.view", 200], ["GET", "/payments/999999", "payments.view", 404],
    ["POST", "/payments", "payments.create", 400], ["PUT", "/payments/999999", "payments.update", 400], ["DELETE", "/payments/999999", "payments.delete", 404],
    ["GET", "/payments/999999/allocations", "payment_allocations.view", 404], ["POST", "/payments/999999/allocations", "payment_allocations.create", 400],
    ["DELETE", "/payments/999999/allocations/999999", "payment_allocations.reverse", 404],
    ["GET", "/portfolio?reference_date=2026-10-02", "portfolio.view", 200], ["GET", "/portfolio/summary?reference_date=2026-10-02", "portfolio.view", 200],
    ["GET", "/portfolio/customers?reference_date=2026-10-02", "portfolio.view", 200], ["GET", "/portfolio/customer/999999?reference_date=2026-10-02", "portfolio.view", 404],
    ["GET", "/portfolio/reconciliation", "portfolio.view", 200], ["GET", "/collection?reference_date=2026-10-02", "collection.view", 200], ["GET", "/admin/roles", "roles.view", 200],
  ];
  const grants = {
    collector: new Set(["customers.view", "invoices.view", "payments.view", "payments.create", "payment_allocations.view", "payment_allocations.create", "portfolio.view", "collection.view"]),
    supervisor: new Set(["customers.view", "customers.update", "invoices.view", "invoices.update", "payments.view", "payments.create", "payments.update",
      "payment_allocations.view", "payment_allocations.create", "payment_allocations.reverse", "portfolio.view", "collection.view"]),
  };
  for (const roleName of ["admin", "supervisor", "collector"]) {
    test(`${roleName} is authorized only for its route operations`, async () => {
      await role(roleName); const session = await login(); const token = session.body.data.access_token;
      for (const [method, path, permission, reachedStatus] of routes) {
        const response = await request(method, path, { token, body: ["POST", "PUT"].includes(method) ? {} : undefined });
        assert.equal(response.status, roleName === "admin" || grants[roleName].has(permission) ? reachedStatus : 403, `${roleName} ${method} ${path}`);
      }
    });
  }
  test("all protected routes return 401 without JWT and 403 to an active user without roles", async () => {
    await role(null); const session = await login();
    for (const [method, path] of routes) {
      const options = { body: ["POST", "PUT"].includes(method) ? {} : undefined };
      assert.equal((await request(method, path, options)).status, 401, path);
      assert.equal((await request(method, path, { ...options, token: session.body.data.access_token })).status, 403, path);
    }
    assert.equal((await request("GET", "/auth/me", { token: session.body.data.access_token })).status, 200);
  });
  test("role changes apply on the next request; client headers/body/JWT claims cannot grant admin", async () => {
    const session = await login(); const token = session.body.data.access_token;
    assert.equal((await request("PUT", "/customers/999999", { token, body: {} })).status, 403);
    await role("supervisor");
    assert.equal((await request("PUT", "/customers/999999", { token, body: {} })).status, 400);
    const me = await request("GET", "/auth/me", { token });
    assert.ok(me.body.data.permissions.includes("customers.update"));
    await role("collector");
    const claimed = jwt.sign({ roles: ["admin"], permissions: ["customers.create"] }, config.secret, {
      algorithm: "HS256", subject: userId, issuer: config.issuer, audience: config.audience, expiresIn: config.accessSeconds,
    });
    assert.equal((await request("POST", "/customers", { token: claimed, body: { roles: ["admin"], permissions: ["customers.create"] }, headers: { "X-Role": "admin" } })).status, 403);
    await role(null);
    assert.equal((await request("GET", "/customers", { token })).status, 403);
  });
  test("multiple existing roles combine permissions; inactive users still receive 401", async () => {
    await db.query("INSERT INTO user_roles (user_id,role_id) SELECT ?,id FROM roles WHERE name='supervisor'", [userId]);
    const session = await login(); const token = session.body.data.access_token;
    assert.equal((await request("PUT", "/customers/999999", { token, body: {} })).status, 400);
    assert.equal((await request("GET", "/admin/roles", { token })).status, 403);
    await db.query("UPDATE users SET status='inactive' WHERE id=?", [userId]);
    assert.equal((await request("GET", "/customers", { token })).status, 401);
  });
  test("role catalog is admin-only, described and read-only", async () => {
    const collector = await login();
    assert.equal((await request("GET", "/admin/roles", { token: collector.body.data.access_token })).status, 403);
    await role("admin");
    const response = await request("GET", "/admin/roles", { token: collector.body.data.access_token });
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(response.body.data.map(item => item.name), ["admin", "supervisor", "collector"]);
    for (const item of response.body.data) for (const permission of item.permissions) {
      assert.equal(typeof permission.enabled, "boolean"); assert.ok(permission.description); assert.ok(permission.module);
    }
    assert.equal((await request("PUT", "/admin/roles", { token: collector.body.data.access_token, body: {} })).status, 404);
  });
  test("health/auth behavior is retained and no planned modules or public registration are invented", async () => {
    for (const path of ["/health", "/health/db"]) assert.equal((await request("GET", path)).status, 200);
    const session = await login(); const cookie = session.headers.getSetCookie()[0].split(";")[0];
    const refreshed = await request("POST", "/auth/refresh", { cookie }); assert.equal(refreshed.status, 200);
    assert.equal((await request("POST", "/auth/logout", { cookie: refreshed.headers.getSetCookie()[0].split(";")[0] })).status, 200);
    await role("admin");
    for (const path of ["/reports", "/messages", "/history", "/settings", "/users"]) assert.equal((await request("GET", path, { token: session.body.data.access_token })).status, 404);
    for (const path of ["/auth/register", "/auth/signup", "/auth/forgot-password"]) assert.equal((await request("POST", path, { body: {} })).status, 404);
  });
  test("provisioning creates one active username admin with Argon2id and authenticates by username/email", async () => {
    const adminEmail = `${randomUUID()}@example.test`;
    const result = await provisionFirstAdmin(db, { email: adminEmail, passwordProvider: async () => password });
    assert.equal(result.created, true); assert.equal(result.user.username, "admin"); assert.equal(result.user.status, "active"); assert.equal(result.role, "admin");
    const [[user]] = await db.query("SELECT password_hash FROM users WHERE id=?", [result.user.id]);
    assert.match(user.password_hash, /^\$argon2id\$/); assert.notEqual(user.password_hash, password); assert.ok(await verifyPassword(user.password_hash, password));
    for (const body of [{ login: "admin", password }, { email: adminEmail, password }, { login: adminEmail, password }]) {
      const session = await login(body); assert.equal(session.body.data.user.username, "admin");
      assert.ok(session.body.data.user.permissions.includes("roles.view"));
      assert.equal(JSON.stringify(session.body).includes(user.password_hash), false);
    }
    await request("POST", "/auth/login", { body: { login: "admin", password: "incorrect" } }).then(result => assert.equal(result.status, 401));
    assert.equal((await request("POST", "/auth/login", { body: { login: "admin", email: adminEmail, password } })).status, 400);
    assert.equal((await request("POST", "/auth/login", { body: { login: "not registered", password } })).status, 400);
    const again = await provisionFirstAdmin(db, { email: adminEmail, passwordProvider: () => { throw new Error("Password must not be requested twice"); } });
    assert.equal(again.created, false); assert.equal(again.user.id, result.user.id);
    const [[count]] = await db.query("SELECT COUNT(*) AS count FROM users WHERE username='admin'"); assert.equal(count.count, 1);
  });
  test("concurrent provisioning cannot create a second admin or replace its credentials", async () => {
    const first = await pool.getConnection(); const second = await pool.getConnection();
    let requests = 0;
    try {
      const results = await Promise.all([first, second].map(connection => provisionFirstAdmin(connection, {
        email: `${randomUUID()}@example.test`, passwordProvider: async () => { requests++; return password; },
      })));
      assert.equal(results.filter(result => result.created).length, 1); assert.equal(requests, 1);
      assert.equal(results[0].user.id, results[1].user.id);
      const [[count]] = await db.query("SELECT COUNT(*) AS count FROM user_roles ur INNER JOIN roles r ON r.id=ur.role_id WHERE r.name='admin'"); assert.equal(count.count, 1);
    } finally { first.release(); second.release(); }
  });
  test("provisioning checks existing admin, occupied username/email and refuses unsafe input", async () => {
    await role("admin");
    assert.equal((await provisionFirstAdmin(db, { email, passwordProvider: () => { throw new Error("No new password"); } })).created, false);
    await role("collector");
    await assert.rejects(provisionFirstAdmin(db, { email, passwordProvider: async () => password }), /email ya está registrado/);
    await db.query("UPDATE users SET username='admin' WHERE id=?", [userId]);
    await assert.rejects(provisionFirstAdmin(db, { email: `${randomUUID()}@example.test`, passwordProvider: async () => password }), /username admin ya está ocupado/);
    await db.query("UPDATE users SET username=NULL WHERE id=?", [userId]);
    await assert.rejects(provisionFirstAdmin(db, { email: "bad", passwordProvider: async () => password }), /email real/);
    await assert.rejects(provisionFirstAdmin(db, { email: `${randomUUID()}@example.test` }), /tiempo de ejecución/);
    await assert.rejects(provisionFirstAdmin(db, { email: `${randomUUID()}@example.test`, passwordProvider: async () => "" }), /Contraseña inválida/);
  });
  test("failed role insertion rolls back admin creation without exposing SQL or credential hashes", async () => {
    await db.query("CREATE TRIGGER test_admin_failure BEFORE INSERT ON user_roles FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='private_admin_sql'");
    try {
      await assert.rejects(provisionFirstAdmin(db, { email: `${randomUUID()}@example.test`, passwordProvider: async () => password }), error => {
        assert.equal(error.message.includes("private_admin_sql"), false); assert.equal(error.message.includes(password), false);
        assert.equal(error.sql, undefined); return true;
      });
      const [[count]] = await db.query("SELECT COUNT(*) AS count FROM users WHERE username='admin'"); assert.equal(count.count, 0);
    } finally { await db.query("DROP TRIGGER test_admin_failure"); }
  });
  test("migration command is idempotent and retains users and roles", async () => {
    assert.ok((await applyAuthMigrations(db)).every(result => !result.applied));
    const [[count]] = await db.query("SELECT COUNT(*) AS count FROM users"); assert.equal(count.count, 1);
    const [roles] = await db.query("SELECT name FROM roles ORDER BY name"); assert.deepEqual(roles.map(item => item.name), ["admin", "collector", "supervisor"]);
  });
});
