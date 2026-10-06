import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import process from "node:process";
const requireBackend = createRequire(new URL("../../../backend/package.json", import.meta.url));
const mysql = requireBackend("mysql2/promise");
const dotenv = requireBackend("dotenv");
const argon2 = requireBackend("argon2");
let environment = {};
try { environment = dotenv.parse(await readFile(new URL("../../../backend/.env", import.meta.url))); } catch { /* CI without database skips integration */ }

test.describe("5.1 browser / real API / isolated MySQL", () => {
  test.skip(!environment.DB_HOST || !environment.DB_USER, "Local MySQL configuration is required for isolated integration.");
  const schema = `mertel_browser_messages_test_${randomUUID().replaceAll("-", "")}`;
  const fixtureEmail = "phase51@example.test";
  const fixturePassword = randomBytes(32).toString("base64url");
  let db, child, apiOrigin;
  test.beforeAll(async () => {
    db = await mysql.createConnection({ host: environment.DB_HOST, port: Number(environment.DB_PORT), user: environment.DB_USER, password: environment.DB_PASSWORD, multipleStatements: true });
    await db.query(`CREATE DATABASE \`${schema}\``); await db.query(`USE \`${schema}\``);
    const initial = await readFile(new URL("../../../database/migrations/001_initial_schema.sql", import.meta.url), "utf8");
    const tables = new Set(["companies", "roles", "users", "user_roles", "customers", "invoices", "payments", "payment_allocations", "collection_actions", "payment_promises", "message_templates", "messages", "settings", "audit_logs"]);
    for (const match of initial.matchAll(/CREATE TABLE (\w+) \([\s\S]*?;/g)) if (tables.has(match[1])) await db.query(match[0]);
    for (const migration of ["004_auth_refresh_sessions.sql", "005_users_username.sql"]) await db.query(await readFile(new URL(`../../../database/migrations/${migration}`, import.meta.url), "utf8"));
    await db.query("INSERT INTO companies(id,name) VALUES (1,'Browser fixture company')"); await db.query("INSERT INTO roles(id,name) VALUES (1,'collector')");
    const hash = await argon2.hash(fixturePassword, { type: argon2.argon2id });
    await db.query("INSERT INTO users(id,company_id,first_name,email,password_hash) VALUES (1,1,'Cobrador fixture',?,?)", [fixtureEmail, hash]); await db.query("INSERT INTO user_roles VALUES (1,1)");
    await db.query("INSERT INTO customers(id,company_id,nit,name,phone) VALUES (1,1,'BROWSER-FIXTURE','Cliente de prueba aislada','300 000 0000')");
    await db.query("INSERT INTO invoices(company_id,customer_id,invoice_number,issue_date,due_date,document_value,base_value,balance) VALUES (1,1,'OLD-BROWSER','2026-08-01','2026-09-01',100,100,100),(1,1,'NEW-BROWSER','2026-09-01','2026-09-25',50,50,50)");
    const rules = await readFile(new URL("../../../backend/config/mertel-collection-rules.json", import.meta.url), "utf8");
    await db.query("INSERT INTO settings(company_id,setting_key,setting_value,value_type) VALUES (1,'collection_rules',?,'json')", [rules]);
    await db.query("INSERT INTO message_templates(id,company_id,name,content) VALUES (1,1,'Plantilla de prueba aislada','Solo fixture {{cliente}} | {{factura}} | {{saldo}} | {{fecha_vencimiento}} | {{dias_mora}}')");
    const source = `import dotenv from 'dotenv'; dotenv.config({quiet:true}); const {createApp}=await import('./src/app.js'); const server=createApp().listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));`;
    child = spawn(process.execPath, ["--input-type=module", "-e", source], { cwd: fileURLToPath(new URL("../../../backend/", import.meta.url)),
      env: { ...process.env, ...environment, DB_NAME: schema, NODE_ENV: "test", JWT_SECRET: randomBytes(48).toString("base64url"), FRONTEND_URL: "http://127.0.0.1:5173", AUTH_COOKIE_SAME_SITE: "lax", AUTH_RATE_LIMIT_MAX: "1000" }, stdio: ["ignore", "pipe", "pipe"] });
    apiOrigin = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Isolated API did not start")), 15000); let output = "";
      child.once("error", () => { clearTimeout(timeout); reject(new Error("Isolated API startup failed")); });
      child.stdout.on("data", chunk => { output += chunk.toString(); const found = output.match(/\{"port":(\d+)\}/); if (found) { clearTimeout(timeout); resolve(`http://127.0.0.1:${found[1]}`); } });
    });
  });
  test.afterAll(async () => {
    if (child && child.exitCode === null) { const stopped = new Promise(resolve => child.once("exit", resolve)); child.kill(); await stopped; }
    if (db) { if (!/^mertel_browser_messages_test_[a-f0-9]{32}$/.test(schema) || schema === environment.DB_NAME) throw new Error("Unsafe fixture cleanup"); await db.query(`DROP DATABASE IF EXISTS \`${schema}\``); await db.end(); }
  });
  async function checksums() {
    const [rows] = await db.query("CHECKSUM TABLE customers,invoices,payments,payment_allocations,collection_actions,payment_promises,messages"); return rows;
  }
  test("login, operations, authoritative preview, preparation, reload and logout with real HTTP/database", async ({ page }) => {
    const requests = []; const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    // Transparent same-origin test proxy: response body and cookies come from the actual Express API.
    await page.route("**/api/**", async route => {
      const original = new URL(route.request().url()); const target = apiOrigin + original.pathname + original.search;
      const response = await route.fetch({ url: target }); requests.push({ method: route.request().method(), path: original.pathname, status: response.status() });
      await route.fulfill({ response });
    });
    await page.goto("/cobranza"); await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel("Correo electrónico").fill(fixtureEmail); await page.getByLabel("Contraseña", { exact: true }).fill(fixturePassword);
    await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click(); await expect(page).toHaveURL("http://127.0.0.1:5173/");
    expect(requests.some(row => row.path === "/api/auth/me" && row.status === 200)).toBe(true);
    const cookies = await page.context().cookies(); const refresh = cookies.find(cookie => cookie.name === "mertel_refresh");
    expect(Boolean(refresh?.httpOnly)).toBe(true); expect(refresh?.sameSite).toBe("Lax");
    await page.goto("/cobranza"); await page.getByLabel("Fecha de referencia").fill("2026-10-05");
    const trigger = page.getByRole("button", { name: "Ver detalle de Cliente de prueba aislada" }); await trigger.click(); const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Registrar gestión", exact: true }).click(); await dialog.getByLabel("Tipo de gestión (texto libre)").fill("Nota de prueba aislada");
    await dialog.getByLabel("Observación de gestión").fill("Observación aislada del navegador"); await dialog.getByRole("button", { name: "Guardar registro" }).click();
    await expect(dialog.getByText("Gestión registrada.")).toBeVisible(); await expect(dialog.getByText("Observación aislada del navegador")).toBeVisible();
    await dialog.getByRole("button", { name: "Registrar promesa", exact: true }).click(); await dialog.getByLabel("Fecha prometida").fill("2026-10-15"); await dialog.getByLabel("Valor prometido").fill("12.34");
    await dialog.getByRole("button", { name: "Guardar registro" }).click(); await expect(dialog.getByText("Promesa registrada como pendiente.")).toBeVisible();
    const before = await checksums();
    await dialog.getByRole("button", { name: "Enviar mensaje a WhatsApp" }).click(); await dialog.getByLabel("Seleccionar plantilla").selectOption("1");
    await dialog.getByRole("button", { name: "Ver vista previa" }).click(); const preview = dialog.getByLabel("Vista previa del mensaje");
    await expect(preview).toContainText("OLD-BROWSER"); await expect(preview).toContainText("300 000 0000"); await expect(preview).toContainText("2026-09-01");
    await preview.getByRole("button", { name: "Preparar mensaje" }).click(); await expect(preview.getByRole("heading", { name: "Mensaje preparado" })).toBeVisible();
    expect(await checksums()).toEqual(before); const [[messages]] = await db.query("SELECT COUNT(*) AS total FROM messages"); expect(messages.total).toBe(0);
    expect(errors).toEqual([]); await page.screenshot({ path: "../tmp/collection51-integrated.png", fullPage: true });
    await page.keyboard.press("Escape"); await page.reload(); await expect(trigger).toBeVisible();
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
    await page.getByRole("button", { name: "Cerrar sesión" }).click(); await expect(page).toHaveURL(/\/login$/);
    await page.goto("/cobranza"); await expect(page).toHaveURL(/\/login$/);
    const [[sessions]] = await db.query("SELECT COUNT(*) AS active FROM auth_refresh_sessions WHERE revoked_at IS NULL"); expect(sessions.active).toBe(0);
    expect(requests.some(row => row.path.endsWith("messages/prepare") && row.status === 200)).toBe(true);
  });
});
