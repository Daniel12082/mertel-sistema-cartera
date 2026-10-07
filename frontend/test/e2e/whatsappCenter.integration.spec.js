import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import process from 'node:process';
const requireBackend = createRequire(new URL('../../../backend/package.json', import.meta.url));
const mysql = requireBackend('mysql2/promise'); const dotenv = requireBackend('dotenv'); const argon2 = requireBackend('argon2');
let environment = {};
try { environment = dotenv.parse(await readFile(new URL('../../../backend/.env', import.meta.url))); } catch { /* optional isolated integration environment */ }

test.describe('WhatsApp browser → Express → isolated MySQL, MOCK only', () => {
  test.skip(!environment.DB_HOST || !environment.DB_USER, 'Requires configured local MySQL for isolated integration.');
  const schema = `mertel_browser_wa_test_${randomUUID().replaceAll('-', '')}`;
  const email = 'whatsapp-admin@example.test'; const password = randomBytes(32).toString('base64url');
  let db, child, apiOrigin, financialBefore;
  test.beforeAll(async () => {
    db = await mysql.createConnection({ host: environment.DB_HOST, port: Number(environment.DB_PORT), user: environment.DB_USER, password: environment.DB_PASSWORD, multipleStatements: true });
    await db.query(`CREATE DATABASE \`${schema}\``); await db.query(`USE \`${schema}\``);
    const initial = await readFile(new URL('../../../database/migrations/001_initial_schema.sql', import.meta.url), 'utf8');
    const tables = new Set(['companies', 'roles', 'users', 'user_roles', 'customers', 'invoices', 'payments', 'payment_allocations', 'collection_actions', 'payment_promises', 'message_templates', 'messages', 'settings', 'audit_logs']);
    for (const match of initial.matchAll(/CREATE TABLE (\w+) \([\s\S]*?;/g)) if (tables.has(match[1])) await db.query(match[0]);
    for (const migration of ['004_auth_refresh_sessions.sql', '005_users_username.sql', '007_whatsapp_center.sql']) await db.query(await readFile(new URL(`../../../database/migrations/${migration}`, import.meta.url), 'utf8'));
    await db.query("INSERT INTO companies(id,name) VALUES (1,'MERTEL IMPORTACIONES')"); await db.query("INSERT INTO roles(id,name) VALUES (1,'admin')");
    await db.query("INSERT INTO users(id,company_id,first_name,email,password_hash) VALUES (1,1,'Admin DEMO',?,?)", [email, await argon2.hash(password, { type: argon2.argon2id })]); await db.query('INSERT INTO user_roles VALUES (1,1)');
    await db.query("INSERT INTO customers(id,company_id,nit,name,phone) VALUES (1,1,'WA-1','Cliente WhatsApp DEMO','3000000001'),(2,1,'WA-2','Cliente fallo DEMO','3000000002')");
    await db.query("INSERT INTO invoices(company_id,customer_id,invoice_number,issue_date,due_date,document_value,base_value,iva_value,balance) VALUES (1,1,'WA-1','2020-01-01','2020-02-01',119,100,19,119),(1,2,'WA-2','2020-01-01','2020-02-01',119,100,19,119)");
    const rules = await readFile(new URL('../../../backend/config/mertel-collection-rules.json', import.meta.url), 'utf8');
    await db.query("INSERT INTO settings(company_id,setting_key,setting_value,value_type) VALUES (1,'collection_rules',?,'json')", [rules]);
    financialBefore = (await db.query('CHECKSUM TABLE invoices,payments,payment_allocations'))[0];
    const source = `import dotenv from 'dotenv'; dotenv.config({quiet:true}); const {createApp}=await import('./src/app.js'); const server=createApp().listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));`;
    child = spawn(process.execPath, ['--input-type=module', '-e', source], { cwd: fileURLToPath(new URL('../../../backend/', import.meta.url)), env: { ...process.env, ...environment, DB_NAME: schema, NODE_ENV: 'test', JWT_SECRET: randomBytes(48).toString('base64url'), FRONTEND_URL: 'http://127.0.0.1:5173', AUTH_COOKIE_SAME_SITE: 'lax', AUTH_RATE_LIMIT_MAX: '1000' }, stdio: ['ignore', 'pipe', 'pipe'] });
    apiOrigin = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Isolated API timeout')), 15000); let output = '';
      child.once('error', () => { clearTimeout(timeout); reject(new Error('API startup failed')); });
      child.stdout.on('data', chunk => { output += chunk.toString(); const found = output.match(/\{"port":(\d+)\}/); if (found) { clearTimeout(timeout); resolve(`http://127.0.0.1:${found[1]}`); } });
    });
  });
  test.afterAll(async () => {
    if (child && child.exitCode === null) { const stopped = new Promise(resolve => child.once('exit', resolve)); child.kill(); await stopped; }
    if (db) { if (!/^mertel_browser_wa_test_[a-f0-9]{32}$/.test(schema) || schema === environment.DB_NAME) throw new Error('Unsafe cleanup'); await db.query(`DROP DATABASE IF EXISTS \`${schema}\``); await db.end(); }
  });
  async function login(page) {
    await page.route('**/api/**', async route => { const url = new URL(route.request().url()); await route.fulfill({ response: await route.fetch({ url: apiOrigin + url.pathname + url.search }) }); });
    await page.goto('/login'); await page.getByLabel('Correo electrónico').fill(email); await page.getByLabel('Contraseña', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click(); await expect(page).toHaveURL('http://127.0.0.1:5173/');
  }
  test('configures MOCK, creates template, defines rule, previews, sends/fails and audits without financial mutations', async ({ page }) => {
    test.setTimeout(60000); const errors = []; const external = [];
    page.on('pageerror', error => errors.push(error.message)); page.on('request', request => { const host = new URL(request.url()).hostname; if (!['127.0.0.1', 'localhost', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(host)) external.push(host); });
    await login(page); await page.getByRole('link', { name: 'WhatsApp', exact: true }).click();
    await expect(page.getByText('No conectado', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Configurar WhatsApp' }).click(); await page.getByLabel('Proveedor', { exact: true }).selectOption('MOCK');
    await page.getByLabel('Máximo global diario').fill('100'); await page.getByLabel('Máximo por cliente/día').fill('10'); await page.getByRole('button', { name: 'Guardar configuración' }).click();
    await page.getByRole('button', { name: 'Probar conexión MOCK' }).click(); await expect(page.getByText('Conectado · simulación MOCK', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Plantillas', exact: true }).click(); await page.getByRole('button', { name: 'Nueva plantilla' }).first().click();
    await page.getByLabel('Nombre de plantilla').fill('DEMO / BORRADOR E2E'); await page.getByLabel('Contenido de plantilla').fill('Prueba {{cliente_nombre}} {{numero_factura}} {{saldo}}');
    await page.getByLabel('Etapa de cobranza').selectOption('overdue'); await page.getByLabel('Estado inicial').selectOption('active'); await page.getByRole('button', { name: 'Crear plantilla', exact: true }).click();
    await expect(page.getByRole('row', { name: /DEMO \/ BORRADOR E2E/ })).toBeVisible();
    await page.getByRole('button', { name: 'Automatizaciones', exact: true }).click(); const rule = page.locator('form').filter({ has: page.getByRole('heading', { name: 'En mora', exact: true }) });
    await rule.getByLabel('Plantilla', { exact: true }).selectOption('1'); await rule.getByLabel('Hora inicio').fill('00:00'); await rule.getByLabel('Hora fin').fill('23:59'); await rule.getByLabel('Máximo por etapa/día').fill('100'); await rule.getByLabel('Intervalo mínimo (horas)').fill('1');
    for (const day of ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']) await rule.getByLabel(day, { exact: true }).check();
    await rule.getByLabel('Regla activa').check(); await rule.getByRole('button', { name: 'Guardar regla de En mora' }).click(); await expect(page.getByText('Regla guardada.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Mensajes', exact: true }).click(); await page.getByLabel('ID del cliente', { exact: true }).fill('1'); await page.getByLabel('Plantilla', { exact: true }).selectOption('1');
    await page.getByRole('button', { name: 'Probar configuración / vista previa' }).click(); await expect(page.getByLabel('Vista previa del mensaje')).toContainText('Cliente WhatsApp DEMO');
    await page.getByRole('button', { name: 'Guardar en cola manual' }).click(); await expect(page.getByRole('button', { name: 'Simular envío 1', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Simular envío 1', exact: true }).click(); await expect(page.getByRole('row', { name: /Cliente WhatsApp DEMO/ })).toContainText('Enviado (MOCK)');
    await page.getByRole('button', { name: 'Simular entrega 1', exact: true }).click(); await page.getByRole('button', { name: 'Simular lectura 1', exact: true }).click();
    await expect(page.getByRole('row', { name: /Cliente WhatsApp DEMO/ })).toContainText('Leído');
    await page.getByLabel('ID del cliente', { exact: true }).fill('2'); await page.getByRole('button', { name: 'Probar configuración / vista previa' }).click();
    await page.getByRole('button', { name: 'Guardar en cola manual' }).click(); await page.getByRole('button', { name: 'Simular fallo 2', exact: true }).click();
    await expect(page.getByRole('row', { name: /Cliente fallo DEMO/ })).toContainText('MOCK_SEND_FAILED'); await page.getByLabel('Filtrar estado').selectOption('FAILED');
    await expect(page.getByRole('row', { name: /Cliente WhatsApp DEMO/ })).toHaveCount(0);
    await page.screenshot({ path: '../tmp/whatsapp-center-desktop.png', fullPage: true });
    await page.getByRole('button', { name: 'Historial', exact: true }).click(); await expect(page.getByText('Prueba de conexión', { exact: true })).toBeVisible(); await expect(page.getByText('Mensaje fallido (MOCK)', { exact: true })).toBeVisible();
    expect((await db.query('CHECKSUM TABLE invoices,payments,payment_allocations'))[0]).toEqual(financialBefore); expect(errors).toEqual([]); expect(external).toEqual([]);
  });
  test('mobile center has no viewport overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); await login(page); await page.goto('/administracion/whatsapp');
    await expect(page.getByRole('heading', { name: 'Centro de WhatsApp', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Configurar WhatsApp' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: '../tmp/whatsapp-center-mobile.png', fullPage: true });
  });
});
