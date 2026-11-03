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
    for (const migration of ['004_auth_refresh_sessions.sql', '005_users_username.sql', '007_whatsapp_center.sql','010_whatsapp_automation.sql','009_collection_results_payments.sql']) await db.query(await readFile(new URL(`../../../database/migrations/${migration}`, import.meta.url), 'utf8'));
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
    await page.getByRole('button', { name: 'Conexión', exact: true }).click();
    await expect(page.getByText('No conectado', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Configurar WhatsApp' }).click(); await page.getByLabel('Proveedor', { exact: true }).selectOption('MOCK');
    await page.getByLabel('Máximo global diario').fill('100'); await page.getByLabel('Máximo por cliente/día').fill('10'); await page.getByRole('button', { name: 'Guardar configuración' }).click();
    await page.getByRole('button', { name: 'Probar conexión MOCK' }).click(); await expect(page.getByText('Conectado', { exact: true })).toBeVisible(); await expect(page.getByText('MOCK', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Plantillas', exact: true }).click(); await page.getByRole('button', { name: 'Nueva plantilla' }).first().click();
    await page.getByLabel('Nombre de plantilla').fill('DEMO / BORRADOR E2E'); await page.getByLabel('Contenido de plantilla').fill('Prueba {{cliente_nombre}} {{numero_factura}} {{saldo}}');
    await page.getByLabel('Etapa de cobranza').selectOption('overdue'); await page.getByLabel('Estado inicial').selectOption('active'); await page.getByRole('button', { name: 'Crear plantilla', exact: true }).click();
    await expect(page.getByRole('row', { name: /DEMO \/ BORRADOR E2E/ })).toBeVisible();
    // Configure a pre-existing MANUAL rule in the isolated fixture using the existing API.
    // Future automation controls remain disabled and never activate anything.
    await page.getByRole('button', { name: 'Automatizaciones', exact: true }).click();
    await expect(page.getByLabel('Hora inicial de Pronto pago')).toBeEnabled();
    const ruleResponse = await page.evaluate(async () => {
      const { default: api } = await import('/src/services/api.js');
      return (await api.put('/admin/whatsapp/automations/overdue', { enabled: true, mode: 'MANUAL', template_id: '1', start_time: '00:00', end_time: '23:59', weekdays: [1,2,3,4,5,6,7], daily_limit: 100, interval_hours: 1 })).data;
    });
    expect(ruleResponse.success).toBe(true);
    await page.getByRole('button', { name: 'Envío manual', exact: true }).click();
    await page.getByLabel('Cliente', { exact: true }).selectOption('1'); await page.getByLabel('Plantilla', { exact: true }).selectOption('1');
    await expect(page.getByLabel('Vista previa del mensaje')).toContainText('Cliente WhatsApp DEMO');
    const sentResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/messages/1/mock-send') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Enviar mensaje por WhatsApp', exact: true }).click();
    const sentBody = await (await sentResponse).json(); expect(sentBody.success).toBe(true); expect(sentBody.data.message.status).toBe('SENT');
    await expect(page.getByText('Mensaje enviado correctamente en el proveedor MOCK. No se realizó ningún envío real.')).toBeVisible();
    await page.getByRole('button', { name: 'Mensajes', exact: true }).click();
    await expect(page.getByRole('row', { name: /Cliente WhatsApp DEMO/ })).toContainText('Enviado (MOCK)');
    await page.getByRole('button', { name: 'Simular entrega 1', exact: true }).click(); await page.getByRole('button', { name: 'Simular lectura 1', exact: true }).click();
    await expect(page.getByRole('row', { name: /Cliente WhatsApp DEMO/ })).toContainText('Leído');
    const queued = await page.evaluate(async () => {
      const { default: api } = await import('/src/services/api.js');
      return (await api.post('/admin/whatsapp/queue', { customer_id: '2', template_id: '1', mode: 'MANUAL' })).data;
    });
    expect(queued.success).toBe(true);
    await page.getByRole('button', { name: 'Actualizar mensajes', exact: true }).click();
    const failedResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/messages/2/mock-send') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Simular fallo 2', exact: true }).click();
    const failedBody = await (await failedResponse).json(); expect(failedBody.success).toBe(true); expect(failedBody.data.message.status).toBe('FAILED');
    await expect(page.getByRole('row', { name: /Cliente fallo DEMO/ })).toContainText('MOCK_SEND_FAILED'); await page.getByLabel('Filtrar estado').selectOption('FAILED');
    await expect(page.getByRole('row', { name: /Cliente WhatsApp DEMO/ })).toHaveCount(0);
    await page.screenshot({ path: '../tmp/whatsapp-center-desktop.png', fullPage: true });
    await page.getByRole('button', { name: 'Historial', exact: true }).click(); await expect(page.getByText('Prueba de conexión', { exact: true })).toBeVisible(); await expect(page.getByText('Mensaje fallido (MOCK)', { exact: true })).toBeVisible();
    expect((await db.query('CHECKSUM TABLE invoices,payments,payment_allocations'))[0]).toEqual(financialBefore); expect(errors).toEqual([]); expect(external).toEqual([]);
  });
  test('configures the fixed reminder rule, evaluates automatic notice and shows real timeline without financial writes', async ({ page }) => {
    const errors = [], external = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { const host = new URL(request.url()).hostname; if (!['127.0.0.1','localhost','fonts.googleapis.com','fonts.gstatic.com'].includes(host)) external.push(host); });
    await db.query("INSERT INTO customers(id,company_id,nit,name,phone) VALUES (3,1,'AUTO-3','Cliente automático E2E DEMO','3000000003')");
    await db.query("INSERT INTO invoices(company_id,customer_id,invoice_number,issue_date,due_date,document_value,base_value,iva_value,balance,notes) VALUES (1,3,'AUTO-E2E',DATE_SUB(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','-05:00'),INTERVAL 30 DAY),DATE_ADD(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','-05:00'),INTERVAL 5 DAY),1190,1000,190,900,'DSCTO = CONDICIONADO')");
    const finances = (await db.query('CHECKSUM TABLE invoices,payments,payment_allocations'))[0];
    await login(page);
    const mockSetup = await page.evaluate(async () => {
      const { default: api } = await import('/src/services/api.js');
      const configured = (await api.patch('/admin/whatsapp/settings', { provider: 'MOCK', global_daily_limit: 100, customer_daily_limit: 10 })).data;
      const tested = (await api.post('/admin/whatsapp/test', {})).data;
      const current = (await api.get('/admin/whatsapp')).data;
      return { configured, tested, current };
    });
    expect(mockSetup.configured.success).toBe(true);
    expect(mockSetup.tested.success).toBe(true);
    expect(mockSetup.current.success).toBe(true);
    expect(mockSetup.current.data.settings.provider).toBe('MOCK');
    expect(mockSetup.current.data.settings.connection_status).toBe('CONNECTED');
    await page.goto('/configuracion/whatsapp');
    await page.getByRole('button', { name: 'Plantillas', exact: true }).click(); await page.getByRole('button', { name: 'Nueva plantilla' }).first().click();
    await page.getByLabel('Nombre de plantilla').fill('mertel_aviso_previo'); await page.getByLabel('Contenido de plantilla').fill('Hola {{cliente_nombre}}.');
    await page.getByLabel('Etapa de cobranza').selectOption('five_days_before_due'); await page.getByLabel('Estado inicial').selectOption('active'); await page.getByRole('button', { name: 'Crear plantilla', exact: true }).click();
    await expect(page.getByRole('row', { name: /mertel_aviso_previo/ })).toBeVisible();
    const [[template]] = await db.query("SELECT CAST(id AS CHAR) id FROM message_templates WHERE name='mertel_aviso_previo'");
    await page.getByRole('button', { name: 'Automatizaciones', exact: true }).click();
    const form = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Recordatorio', exact: true }) });
    await form.getByLabel('Plantilla de Recordatorio', { exact: true }).selectOption(template.id);
    await form.getByLabel('Hora inicial de Recordatorio').fill('00:00'); await form.getByLabel('Hora final de Recordatorio').fill('23:59');
    await form.getByLabel('Límite diario de Recordatorio').fill('100'); await form.getByLabel('Intervalo técnico existente (horas) de Recordatorio').fill('1');
    for (const day of ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado']) await form.getByLabel(day, { exact: true }).check();
    await expect(form.getByLabel('Domingo')).toBeDisabled(); await form.getByLabel('Habilitar Recordatorio').check(); await form.getByRole('button', { name: 'Guardar regla de Recordatorio' }).click();
    await expect(page.getByText('Regla de Recordatorio guardada.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Activar automatización MOCK' }).click(); await expect(page.getByText('Automatización activada en MOCK.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Timeline', exact: true }).click(); await page.getByLabel('Cliente de la timeline').selectOption('3');
    await expect(page.getByRole('heading', { name: 'Cliente automático E2E DEMO' })).toBeVisible();
    await page.getByRole('button', { name: 'Evaluar avisos ahora (MOCK)' }).click();
    const reminder = page.locator('.wa-timeline li').filter({ has: page.getByRole('heading', { name: 'Recordatorio', exact: true }) });
    await expect(reminder.getByText('PROGRAMADO', { exact: true })).toBeVisible(); await expect(reminder).toContainText('valor $1.190 · saldo pendiente $900');
    await expect(reminder).toContainText('solamente si paga a tiempo');
    await page.getByRole('button', { name: 'Evaluar avisos ahora (MOCK)' }).click();
    expect((await db.query("SELECT COUNT(*) count FROM messages WHERE customer_id=3 AND message_mode='AUTOMATICO'"))[0][0].count).toBe(1);
    await page.getByRole('button', { name: 'Excluir de mensajes automáticos' }).click(); await expect(page.getByText('Cliente excluido: el backend bloquea los mensajes automáticos.')).toBeVisible();
    await page.evaluate(() => window.scrollTo(0,0)); await page.screenshot({ path: '../tmp/whatsapp-automation-real-timeline.png', fullPage: true });
    expect((await db.query('CHECKSUM TABLE invoices,payments,payment_allocations'))[0]).toEqual(finances); expect(errors).toEqual([]); expect(external).toEqual([]);
  });
  test('conversations outside simulation read existing data and cannot send free text or write the ledger', async ({ page }) => {
    const writes=[],errors=[]; page.on('pageerror',error=>errors.push(error.message));
    await login(page);
    const template = await page.evaluate(async () => {
      const { default: api } = await import('/src/services/api.js');
      const created = (await api.post('/collection/message-templates', {
        name: 'DEMO / BORRADOR E2E', channel: 'whatsapp', stage: 'overdue', status: 'active',
        content: 'Prueba {{cliente_nombre}} {{numero_factura}} {{saldo}}'
      })).data;
      const catalog = (await api.get('/collection/message-templates')).data;
      return { created, catalog };
    });
    expect(template.created.success).toBe(true);
    expect(template.created.data.name).toBe('DEMO / BORRADOR E2E');
    expect(template.created.data.stage).toBe('overdue');
    expect(template.catalog.success).toBe(true);
    expect(template.catalog.data.templates.some(row => row.name === 'DEMO / BORRADOR E2E' && row.stage === 'overdue')).toBe(true);
    const before=(await db.query('CHECKSUM TABLE invoices,payments,payment_allocations,messages,settings,audit_logs'))[0];
    page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/')&&!['GET','HEAD'].includes(request.method()))writes.push(request.url());});
    await page.getByRole('link',{name:'WhatsApp',exact:true}).click(); await expect(page.getByRole('heading',{name:'Conversaciones',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Abrir conversación Cliente WhatsApp DEMO'}).click();
    await expect(page.getByRole('complementary',{name:'Ficha del cliente'})).toContainText('WA-1');
    await expect(page.getByRole('complementary',{name:'Ficha del cliente'})).toContainText(/\$\s*119/);
    await expect(page.getByLabel('Redactar mensaje')).toBeEnabled(); await expect(page.getByRole('button',{name:'Enviar mensaje con proveedor MOCK'})).toBeDisabled();
    await page.getByLabel('Redactar mensaje').fill('Borrador libre sin plantilla');
    await expect(page.getByRole('button',{name:'Enviar mensaje con proveedor MOCK'})).toBeDisabled();
    await expect(page.getByText('Proveedor MOCK · Meta pendiente',{exact:true})).toBeVisible();
    expect((await db.query('CHECKSUM TABLE invoices,payments,payment_allocations,messages,settings,audit_logs'))[0]).toEqual(before);
    expect(writes).toEqual([]);
    await page.getByLabel('Redactar mensaje').fill('/demo');
    const templateOption = page.getByRole('option').filter({ hasText: 'DEMO / BORRADOR E2E' });
    await expect(templateOption).not.toHaveCount(0);
    await templateOption.last().click();
    await expect(page.getByLabel('Redactar mensaje')).toHaveValue(/Prueba Cliente WhatsApp DEMO WA-1/);
    await page.getByLabel('Redactar mensaje').press('End'); await page.getByLabel('Redactar mensaje').pressSequentially(' editado');
    await expect(page.getByRole('button', { name: 'Enviar mensaje con proveedor MOCK' })).toBeDisabled();
    await expect(page.getByText(/El envío manual actual requiere el texto validado/)).toBeVisible();
    expect(writes.every(url => new URL(url).pathname === '/api/admin/whatsapp/preview')).toBe(true);
    expect((await db.query('CHECKSUM TABLE invoices,payments,payment_allocations,messages,settings,audit_logs'))[0]).toEqual(before);
    expect(errors).toEqual([]);
  });
  test('mobile center has no viewport overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); await login(page); await page.goto('/administracion/whatsapp');
    await expect(page.getByRole('heading', { name: 'Centro de WhatsApp', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Conversaciones', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: '../tmp/whatsapp-center-mobile.png', fullPage: true });
  });
});
