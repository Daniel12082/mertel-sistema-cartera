import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import jwt from "jsonwebtoken";
import { loadAuthConfig } from "../src/config/auth.js";
import { hashPassword } from "../src/utils/password.js";

dotenv.config({ path: new URL("../.env", import.meta.url), quiet: true });
const configured = Boolean(process.env.DB_HOST && process.env.DB_USER);

describe("secure authentication HTTP / MySQL integration", { skip: !configured }, () => {
  const databaseName = `mertel_auth_test_${randomUUID().replaceAll("-", "")}`;
  const originalDatabase = process.env.DB_NAME;
  const password = randomBytes(24).toString("base64url");
  const secret = randomBytes(48).toString("base64url");
  const origin = "http://localhost:5173";
  const config = loadAuthConfig({ JWT_SECRET: secret, FRONTEND_URL: origin, AUTH_COOKIE_SAME_SITE: "lax", AUTH_RATE_LIMIT_MAX: "1000", NODE_ENV: "test" });
  const logs = [];
  const logMethods = {};
  let admin;
  let pool;
  let server;
  let baseUrl;
  let createApp;
  let storedHash;
  let userId;
  let companyId;
  let email;
  let customerId;

  before(async () => {
    admin = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
      user: process.env.DB_USER, password: process.env.DB_PASSWORD, multipleStatements: true });
    await admin.query(`CREATE DATABASE \`${databaseName}\``);
    await admin.query(`USE \`${databaseName}\``);
    const initial = await readFile(new URL("../../database/migrations/001_initial_schema.sql", import.meta.url), "utf8");
    const tables = new Set(["companies", "roles", "users", "user_roles", "customers", "invoices", "payments", "payment_allocations", "payment_promises", "audit_logs"]);
    for (const match of initial.matchAll(/CREATE TABLE (\w+) \([\s\S]*?;/g)) {
      if (tables.has(match[1])) await admin.query(match[0]);
    }
    await admin.query("INSERT INTO roles (name) VALUES ('admin'), ('collector'), ('supervisor')");
    for (const migration of ["002_payment_allocations_soft_delete.sql", "003_active_payment_invoice_allocation_unique.sql", "004_auth_refresh_sessions.sql", "005_users_username.sql"]) {
      await admin.query(await readFile(new URL(`../../database/migrations/${migration}`, import.meta.url), "utf8"));
    }
    process.env.DB_NAME = databaseName;
    ({ default: pool } = await import("../src/config/database.js"));
    ({ createApp } = await import("../src/app.js"));
    storedHash = await hashPassword(password);
    server = await serve(createApp(config));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    for (const method of ["log", "warn", "error"]) {
      logMethods[method] = console[method];
      console[method] = (...args) => logs.push(args.map(value => typeof value === "string" ? value : JSON.stringify(value)).join(" "));
    }
  });
  after(async () => {
    for (const [method, original] of Object.entries(logMethods)) console[method] = original;
    if (server) await new Promise(resolve => server.close(resolve));
    if (pool) await pool.end();
    if (admin) {
      assert.match(databaseName, /^mertel_auth_test_[a-f0-9]{32}$/);
      await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
      await admin.end();
    }
    if (originalDatabase === undefined) delete process.env.DB_NAME;
    else process.env.DB_NAME = originalDatabase;
  });
  beforeEach(async () => {
    const [existingCompanies] = await pool.query("SELECT id FROM companies WHERE name='MERTEL IMPORTACIONES' ORDER BY id LIMIT 1");
    if (existingCompanies.length) companyId = existingCompanies[0].id;
    else { const [company] = await pool.query("INSERT INTO companies (name) VALUES ('MERTEL IMPORTACIONES')"); companyId = company.insertId; }
    email = `${randomUUID()}@example.test`;
    const [user] = await pool.query("INSERT INTO users (company_id, first_name, last_name, email, password_hash) VALUES (?, 'Auth', 'Test', ?, ?)", [companyId, email, storedHash]);
    userId = String(user.insertId);
    await pool.query("INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE name='collector'", [userId]);
    const [customer] = await pool.query("INSERT INTO customers (company_id, nit, name) VALUES (?, ?, 'Auth test customer')", [companyId, randomUUID()]);
    customerId = customer.insertId;
  });
  async function serve(app) {
    return new Promise(resolve => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  }
  async function request(method, path, { body, token, cookie, headers = {}, url = baseUrl } = {}) {
    const response = await fetch(`${url}${path}`, { method, headers: { "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  async function session(overrides = {}, url = baseUrl) {
    const result = await request("POST", "/api/auth/login", { body: { email, password, ...overrides }, url });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return { ...result, token: result.body.data.access_token, cookie: result.headers.getSetCookie()[0].split(";")[0] };
  }
  const cookieToken = cookie => decodeURIComponent(cookie.split("=")[1]);
  const cookieHash = cookie => createHash("sha256").update(cookieToken(cookie)).digest("hex");
  async function assertStatus(method, path, options, expected) {
    const result = await request(method, path, options);
    assert.equal(result.status, expected, JSON.stringify(result.body));
    return result;
  }
  function assertNoSecrets(result, tokens = []) {
    const serialized = JSON.stringify(result.body);
    for (const value of [password, storedHash, secret, ...tokens]) assert.equal(serialized.includes(value), false);
    assert.equal(/password|password_hash|token_hash|refresh_token|stack|sqlMessage/i.test(serialized), false);
  }

  test("valid login returns short access token, minimal user, HttpOnly refresh cookie and hashed session", async () => {
    const result = await session();
    assert.equal(result.body.data.expires_in, 900);
    assert.equal(result.body.data.user.id, userId);
    assert.equal(result.body.data.user.name, "Auth Test");
    assert.equal(result.body.data.user.roles[0].name, "collector");
    assert.equal(result.headers.get("cache-control"), "no-store");
    const cookie = result.headers.getSetCookie()[0];
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/); assert.match(cookie, /Path=\/api\/auth/);
    assert.doesNotMatch(cookie, /; Secure(?:;|$)/);
    assertNoSecrets(result, [cookieToken(result.cookie)]);
    const [rows] = await pool.query("SELECT token_hash, revoked_at FROM auth_refresh_sessions WHERE user_id=?", [userId]);
    assert.equal(rows.length, 1); assert.equal(rows[0].token_hash, cookieHash(result.cookie));
    assert.notEqual(rows[0].token_hash, cookieToken(result.cookie)); assert.equal(rows[0].revoked_at, null);
    const [users] = await pool.query("SELECT last_login_at FROM users WHERE id=?", [userId]); assert.ok(users[0].last_login_at);
  });
  test("wrong password, unknown, inactive and deleted users have identical generic 401", async () => {
    const wrong = await assertStatus("POST", "/api/auth/login", { body: { email, password: "incorrect" } }, 401);
    const unknown = await assertStatus("POST", "/api/auth/login", { body: { email: "absent@example.test", password } }, 401);
    await pool.query("UPDATE users SET status='inactive' WHERE id=?", [userId]);
    const inactive = await assertStatus("POST", "/api/auth/login", { body: { email, password } }, 401);
    await pool.query("UPDATE users SET status='active', deleted_at=NOW() WHERE id=?", [userId]);
    const deleted = await assertStatus("POST", "/api/auth/login", { body: { email, password } }, 401);
    for (const result of [wrong, unknown, inactive, deleted]) { assert.deepEqual(result.body, wrong.body); assertNoSecrets(result); }
  });
  test("invalid email, missing/non-string/oversized password and invalid JSON return safe errors", async () => {
    for (const body of [{ email: "bad", password }, { email }, { email, password: null }, { email, password: 42 }, { email, password: "" }, { email, password: "x".repeat(1025) }]) {
      await assertStatus("POST", "/api/auth/login", { body }, 400);
    }
    const invalid = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"password":"private-malformed' });
    assert.equal(invalid.status, 400);
    const text = await invalid.text(); assert.equal(text.includes("private-malformed"), false); assert.equal(text.includes("SyntaxError"), false);
  });
  test("incompatible stored password format is neither accepted nor converted", async () => {
    await pool.query("UPDATE users SET password_hash=? WHERE id=?", [password, userId]);
    await assertStatus("POST", "/api/auth/login", { body: { email, password } }, 401);
    const [rows] = await pool.query("SELECT password_hash FROM users WHERE id=?", [userId]); assert.equal(rows[0].password_hash, password);
  });
  test("me requires valid Bearer JWT and never returns credential material", async () => {
    const s = await session();
    const result = await assertStatus("GET", "/api/auth/me", { token: s.token }, 200);
    assert.equal(result.body.data.id, userId); assertNoSecrets(result, [s.token, cookieToken(s.cookie)]);
    await assertStatus("GET", "/api/auth/me", {}, 401);
    await assertStatus("GET", "/api/auth/me", { cookie: s.cookie }, 401);
    await assertStatus("GET", "/api/auth/me", { token: "bad.token.value" }, 401);
    await assertStatus("GET", "/api/auth/me", { headers: { Authorization: "Basic invalid" } }, 401);
    const expired = jwt.sign({ iat: Math.floor(Date.now()/1000) - 1000 }, secret, { subject: userId, issuer: config.issuer, audience: config.audience, expiresIn: 900 });
    await assertStatus("GET", "/api/auth/me", { token: expired }, 401);
  });
  test("access token cannot authenticate missing, deleted or newly disabled user", async () => {
    const s = await session();
    await pool.query("UPDATE users SET status='inactive' WHERE id=?", [userId]);
    await assertStatus("GET", "/api/auth/me", { token: s.token }, 401);
    await pool.query("UPDATE users SET status='active', deleted_at=NOW() WHERE id=?", [userId]);
    await assertStatus("GET", "/api/auth/me", { token: s.token }, 401);
    const missing = jwt.sign({}, secret, { subject: "999999999", issuer: config.issuer, audience: config.audience, expiresIn: 900 });
    await assertStatus("GET", "/api/auth/me", { token: missing }, 401);
  });
  test("every financial mount, including allocations, rejects unauthenticated requests", async () => {
    for (const [method, path] of [["GET", "/api/customers"], ["POST", "/api/customers"], ["GET", "/api/invoices"], ["PUT", "/api/invoices/1"],
      ["DELETE", "/api/invoices/1"], ["GET", "/api/payments"], ["POST", "/api/payments/1/allocations"], ["DELETE", "/api/payments/1/allocations/1"],
      ["GET", "/api/portfolio"], ["GET", "/api/portfolio/summary"], ["GET", "/api/portfolio/reconciliation"]]) {
      await assertStatus(method, path, { body: method === "POST" || method === "PUT" ? {} : undefined }, 401);
    }
  });
  test("authenticated collector can read financial routes; removing roles denies access with 403", async () => {
    const s = await session();
    for (const path of ["/api/customers", "/api/invoices", "/api/payments", "/api/portfolio?reference_date=2026-10-02", "/api/portfolio/summary?reference_date=2026-10-02"]) {
      await assertStatus("GET", path, { token: s.token }, 200);
    }
    await pool.query("DELETE FROM user_roles WHERE user_id=?", [userId]);
    await assertStatus("GET", `/api/customers/${customerId}`, { token: s.token }, 403);
    await assertStatus("GET", "/api/auth/me", { token: s.token }, 200);
  });
  test("technical health remains public and discloses no database name or financial data", async () => {
    for (const path of ["/api/health", "/api/health/db"]) {
      const result = await assertStatus("GET", path, {}, 200);
      assert.equal(JSON.stringify(result.body).includes(databaseName), false); assertNoSecrets(result);
    }
  });
  test("valid refresh rotates cookie/hash, preserves absolute expiration and returns only access credentials", async () => {
    const s = await session();
    const result = await assertStatus("POST", "/api/auth/refresh", { cookie: s.cookie }, 200);
    const nextCookie = result.headers.getSetCookie()[0].split(";")[0]; assert.notEqual(nextCookie, s.cookie);
    assertNoSecrets(result, [cookieToken(s.cookie), cookieToken(nextCookie)]);
    const [rows] = await pool.query("SELECT token_hash, revoked_at, DATE_FORMAT(expires_at,'%Y-%m-%d %H:%i:%s.%f') AS expiration FROM auth_refresh_sessions WHERE user_id=? ORDER BY id", [userId]);
    assert.equal(rows.length, 2); assert.ok(rows[0].revoked_at); assert.equal(rows[1].revoked_at, null);
    assert.equal(rows[0].expiration, rows[1].expiration); assert.equal(rows[1].token_hash, cookieHash(nextCookie));
    await assertStatus("GET", "/api/auth/me", { token: result.body.data.access_token }, 200);
  });
  test("expired refresh is rejected and clears cookie", async () => {
    const s = await session(); await pool.query("UPDATE auth_refresh_sessions SET expires_at=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND WHERE user_id=?", [userId]);
    const result = await assertStatus("POST", "/api/auth/refresh", { cookie: s.cookie }, 401);
    assert.match(result.headers.getSetCookie()[0], /Expires=Thu, 01 Jan 1970/);
  });
  test("revoked refresh and replay of rotated token revoke only their session family", async () => {
    const first = await session(); const separate = await session();
    const rotated = await assertStatus("POST", "/api/auth/refresh", { cookie: first.cookie }, 200);
    const nextCookie = rotated.headers.getSetCookie()[0].split(";")[0];
    await assertStatus("POST", "/api/auth/refresh", { cookie: first.cookie }, 401);
    await assertStatus("POST", "/api/auth/refresh", { cookie: nextCookie }, 401);
    await assertStatus("POST", "/api/auth/refresh", { cookie: separate.cookie }, 200);
  });
  test("refresh rejects inactive, deleted and physically missing users", async () => {
    const s = await session(); await pool.query("UPDATE users SET status='inactive' WHERE id=?", [userId]);
    await assertStatus("POST", "/api/auth/refresh", { cookie: s.cookie }, 401);
    await pool.query("UPDATE users SET status='active' WHERE id=?", [userId]);
    const second = await session(); await pool.query("UPDATE users SET deleted_at=NOW() WHERE id=?", [userId]);
    await assertStatus("POST", "/api/auth/refresh", { cookie: second.cookie }, 401);
    await pool.query("UPDATE users SET deleted_at=NULL WHERE id=?", [userId]);
    const third = await session(); await pool.query("DELETE FROM users WHERE id=?", [userId]);
    await assertStatus("POST", "/api/auth/refresh", { cookie: third.cookie }, 401);
  });
  test("refresh only accepts server-issued cookie; absent/random/body token is rejected", async () => {
    await assertStatus("POST", "/api/auth/refresh", {}, 401);
    await assertStatus("POST", "/api/auth/refresh", { cookie: `mertel_refresh=${randomBytes(32).toString("base64url")}` }, 401);
    const s = await session();
    await assertStatus("POST", "/api/auth/refresh", { body: { refresh_token: cookieToken(s.cookie) } }, 401);
  });
  test("logout revokes current family, clears cookie and preserves a different login session", async () => {
    const first = await session(); const second = await session();
    const result = await assertStatus("POST", "/api/auth/logout", { cookie: first.cookie }, 200);
    assert.match(result.headers.getSetCookie()[0], /Expires=Thu, 01 Jan 1970/); assertNoSecrets(result, [first.token]);
    await assertStatus("POST", "/api/auth/refresh", { cookie: first.cookie }, 401);
    await assertStatus("POST", "/api/auth/refresh", { cookie: second.cookie }, 200);
    await assertStatus("POST", "/api/auth/logout", {}, 200);
  });
  test("CORS allows explicit origin and credentials; denied origins cannot mutate sessions", async () => {
    const good = await assertStatus("POST", "/api/auth/login", { body: { email, password }, headers: { Origin: origin } }, 200);
    assert.equal(good.headers.get("access-control-allow-origin"), origin);
    assert.equal(good.headers.get("access-control-allow-credentials"), "true");
    const s = await session();
    for (const path of ["/api/auth/login", "/api/auth/refresh", "/api/auth/logout"]) {
      const denied = await assertStatus("POST", path, { cookie: s.cookie, body: { email, password }, headers: { Origin: "https://untrusted.example" } }, 403);
      assert.equal(denied.headers.get("access-control-allow-origin"), null);
    }
    await assertStatus("POST", "/api/auth/refresh", { cookie: s.cookie }, 200);
    const preflight = await fetch(`${baseUrl}/api/auth/login`, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" } });
    assert.equal(preflight.status, 204);
  });
  test("form/simple requests cannot trigger cookie-authenticated operations", async () => {
    const s = await session();
    for (const path of ["/api/auth/login", "/api/auth/refresh", "/api/auth/logout"]) {
      await assertStatus("POST", path, { cookie: s.cookie, headers: { "Content-Type": "text/plain" } }, 403);
      await assertStatus("POST", path, { cookie: s.cookie, headers: { "Sec-Fetch-Site": "cross-site" } }, 403);
    }
  });
  for (const [nodeEnv, sameSite] of [["development", "lax"], ["production", "lax"], ["production", "strict"], ["production", "none"]]) {
    test(`refresh cookie attributes on login/rotation/clear: ${nodeEnv}, SameSite=${sameSite}`, async () => {
      const frontendOrigin = nodeEnv === "production" ? "https://mertelimportaciones.com" : origin;
      const app = createApp(loadAuthConfig({ JWT_SECRET: secret, FRONTEND_URL: frontendOrigin,
        NODE_ENV: nodeEnv, AUTH_COOKIE_SAME_SITE: sameSite }));
      const listener = await serve(app);
      const url = `http://127.0.0.1:${listener.address().port}`;
      // Node fetch checks server headers here; it does not enforce browser cookie policies or HTTPS.
      function assertCookie(result) {
        const cookie = result.headers.getSetCookie()[0];
        assert.match(cookie, /; HttpOnly(?:;|$)/);
        assert.match(cookie, /; Path=\/api\/auth(?:;|$)/);
        assert.match(cookie, new RegExp(`; SameSite=${sameSite[0].toUpperCase()}${sameSite.slice(1)}(?:;|$)`));
        assert.doesNotMatch(cookie, /; Domain=/);
        if (nodeEnv === "production") assert.match(cookie, /; Secure(?:;|$)/);
        else assert.doesNotMatch(cookie, /; Secure(?:;|$)/);
      }
      try {
        const s = await request("POST", "/api/auth/login", { url, body: { email, password }, headers: { Origin: frontendOrigin } });
        assert.equal(s.status, 200); assertCookie(s);
        assert.equal(s.headers.get("access-control-allow-origin"), frontendOrigin);
        assert.equal(s.headers.get("access-control-allow-credentials"), "true");
        assert.equal(s.headers.get("x-content-type-options"), "nosniff");
        assert.ok(s.headers.get("content-security-policy"));
        const cookie = s.headers.getSetCookie()[0].split(";")[0];
        const headers = { Origin: frontendOrigin, "Sec-Fetch-Site": "same-site" };
        const rotated = await assertStatus("POST", "/api/auth/refresh", { url, cookie, headers }, 200);
        assertCookie(rotated);
        const nextCookie = rotated.headers.getSetCookie()[0].split(";")[0];
        assert.notEqual(nextCookie, cookie);
        const cleared = await assertStatus("POST", "/api/auth/logout", { url, cookie: nextCookie, headers }, 200);
        assertCookie(cleared);
        assert.match(cleared.headers.getSetCookie()[0], /Expires=Thu, 01 Jan 1970/);
        const expired = await assertStatus("POST", "/api/auth/refresh", { url, cookie: nextCookie, headers }, 401);
        assertCookie(expired);
        assert.match(expired.headers.getSetCookie()[0], /Expires=Thu, 01 Jan 1970/);
      } finally { await new Promise(resolve => listener.close(resolve)); }
    });
  }
  test("production CORS admits only the final frontend and rejects other origins before login", async () => {
    const frontendOrigin = "https://mertelimportaciones.com";
    const app = createApp(loadAuthConfig({ JWT_SECRET: secret, FRONTEND_URL: frontendOrigin,
      NODE_ENV: "production", AUTH_COOKIE_SAME_SITE: "lax" }));
    const listener = await serve(app);
    const url = `http://127.0.0.1:${listener.address().port}`;
    try {
      const preflight = await fetch(`${url}/api/auth/refresh`, { method: "OPTIONS", headers: {
        Origin: frontendOrigin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type",
      } });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get("access-control-allow-origin"), frontendOrigin);
      assert.equal(preflight.headers.get("access-control-allow-credentials"), "true");
      for (const deniedOrigin of ["*", "https://mertel.hostifycol.com", "https://api.mertel.hostifycol.com",
        "https://api.mertelimportaciones.com", "https://www.mertelimportaciones.com", origin, "https://untrusted.example"]) {
        const denied = await assertStatus("POST", "/api/auth/login", {
          url, body: { email, password }, headers: { Origin: deniedOrigin },
        }, 403);
        assert.equal(denied.headers.get("access-control-allow-origin"), null);
        assert.equal(denied.headers.getSetCookie().length, 0);
      }
      const [sessions] = await pool.query("SELECT COUNT(*) AS count FROM auth_refresh_sessions WHERE user_id=?", [userId]);
      assert.equal(sessions[0].count, 0);
    } finally { await new Promise(resolve => listener.close(resolve)); }
  });
  test("login-specific rate limit counts failures and leaves health/financial routes available", async () => {
    const app = createApp(loadAuthConfig({ JWT_SECRET: secret, FRONTEND_URL: origin, AUTH_COOKIE_SAME_SITE: "lax", AUTH_RATE_LIMIT_MAX: "2", NODE_ENV: "test" }));
    const listener = await serve(app); const url = `http://127.0.0.1:${listener.address().port}`;
    try {
      const valid = await session({}, url);
      await session({}, url); await session({}, url); // Successes do not consume failed-attempt budget.
      for (let i=0; i<2; i++) await assertStatus("POST", "/api/auth/login", { url, body: { email, password: "incorrect" } }, 401);
      const blocked = await assertStatus("POST", "/api/auth/login", { url, body: { email, password } }, 429);
      assert.ok(blocked.headers.get("retry-after"));
      await assertStatus("GET", "/api/health", { url }, 200);
      await assertStatus("GET", "/api/customers", { url, token: valid.token }, 200);
    } finally { await new Promise(resolve => listener.close(resolve)); }
  });
  test("simultaneous refresh cannot rotate a token twice; replay fails closed", async () => {
    const s = await session();
    const results = await Promise.all([1,2].map(() => request("POST", "/api/auth/refresh", { cookie: s.cookie })));
    assert.deepEqual(results.map(r => r.status).sort(), [200,401]);
    const [rows] = await pool.query("SELECT COUNT(*) AS active FROM auth_refresh_sessions WHERE user_id=? AND revoked_at IS NULL", [userId]);
    assert.equal(rows[0].active, 0);
  });
  test("audit contains required events with no passwords, hashes, tokens, bodies or headers", async () => {
    const s = await session();
    await assertStatus("POST", "/api/auth/login", { body: { email, password: "incorrect" } }, 401);
    await assertStatus("POST", "/api/auth/logout", { cookie: s.cookie }, 200);
    await assertStatus("POST", "/api/auth/refresh", { cookie: s.cookie }, 401);
    const [rows] = await pool.query("SELECT * FROM audit_logs");
    for (const action of ["login_success", "login_failed", "logout", "refresh_rejected"]) assert.ok(rows.some(row => row.action === action));
    for (const row of rows) { assert.equal(row.old_values, null); assert.equal(row.new_values, null); assert.equal(row.user_agent, null); }
    const audit = JSON.stringify(rows);
    for (const sensitive of [password, storedHash, secret, s.token, cookieToken(s.cookie)]) assert.equal(audit.includes(sensitive), false);
  });
  test("refresh insert failure rolls back rotation and keeps original session usable", async () => {
    const s = await session();
    await admin.query("CREATE TRIGGER test_refresh_failure BEFORE INSERT ON auth_refresh_sessions FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='private_refresh_sql'");
    try {
      const result = await assertStatus("POST", "/api/auth/refresh", { cookie: s.cookie }, 500);
      assertNoSecrets(result, [cookieToken(s.cookie)]);
      const [rows] = await pool.query("SELECT revoked_at FROM auth_refresh_sessions WHERE token_hash=?", [cookieHash(s.cookie)]);
      assert.equal(rows[0].revoked_at, null);
    } finally { await admin.query("DROP TRIGGER test_refresh_failure"); }
    await assertStatus("POST", "/api/auth/refresh", { cookie: s.cookie }, 200);
    assert.equal(logs.join("\n").includes("private_refresh_sql"), false);
  });
  test("logout racing refresh leaves no usable token in the logged-out family", async () => {
    const s = await session();
    const [refreshed, loggedOut] = await Promise.all([
      request("POST", "/api/auth/refresh", { cookie: s.cookie }),
      request("POST", "/api/auth/logout", { cookie: s.cookie }),
    ]);
    assert.equal(loggedOut.status, 200); assert.ok([200,401].includes(refreshed.status));
    const [rows] = await pool.query("SELECT COUNT(*) AS active FROM auth_refresh_sessions WHERE user_id=? AND revoked_at IS NULL", [userId]);
    assert.equal(rows[0].active, 0);
    if (refreshed.status === 200) {
      await assertStatus("POST", "/api/auth/refresh", { cookie: refreshed.headers.getSetCookie()[0].split(";")[0] }, 401);
    }
  });
  test("database failure rolls back login and exposes no SQL/credential values in response or logs", async () => {
    await admin.query("CREATE TRIGGER test_auth_failure BEFORE INSERT ON auth_refresh_sessions FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='private_auth_sql'");
    try {
      const result = await assertStatus("POST", "/api/auth/login", { body: { email, password } }, 500);
      assertNoSecrets(result); assert.equal(result.body.message, "No se pudo procesar la solicitud");
      const [rows] = await pool.query("SELECT COUNT(*) AS count FROM auth_refresh_sessions WHERE user_id=?", [userId]);
      assert.equal(rows[0].count, 0);
      const [users] = await pool.query("SELECT last_login_at FROM users WHERE id=?", [userId]); assert.equal(users[0].last_login_at, null);
    } finally { await admin.query("DROP TRIGGER test_auth_failure"); }
    const s = await session();
    const output = logs.join("\n");
    for (const sensitive of [password, storedHash, secret, s.token, cookieToken(s.cookie), "private_auth_sql", "INSERT INTO"]) assert.equal(output.includes(sensitive), false);
  });
});
