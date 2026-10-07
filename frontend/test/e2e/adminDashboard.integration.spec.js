import {expect,test} from '@playwright/test';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import process from 'node:process';
const requireBackend=createRequire(new URL('../../../backend/package.json',import.meta.url));
const mysql=requireBackend('mysql2/promise'),dotenv=requireBackend('dotenv'),argon2=requireBackend('argon2');
let environment={};try{environment=dotenv.parse(await readFile(new URL('../../../backend/.env',import.meta.url)));}catch{/* isolated DB required */}
test.describe('Administrative center → real API → immutable financial ledger',()=>{
  test.skip(!environment.DB_HOST||!environment.DB_USER,'Requires isolated MySQL.');
  const schema=`mertel_browser_admin_test_${randomUUID().replaceAll('-','')}`,password=randomBytes(32).toString('base64url');
  let db,child,origin,beforeFinance;
  async function finance(){const result={};for(const table of ['invoices','payments','payment_allocations'])result[table]=(await db.query(`SELECT * FROM ${table} ORDER BY id`))[0];return result;}
  test.beforeAll(async()=>{
    db=await mysql.createConnection({host:environment.DB_HOST,port:Number(environment.DB_PORT),user:environment.DB_USER,password:environment.DB_PASSWORD,multipleStatements:true});
    await db.query(`CREATE DATABASE \`${schema}\``);await db.query(`USE \`${schema}\``);
    const initial=await readFile(new URL('../../../database/migrations/001_initial_schema.sql',import.meta.url),'utf8');
    const tables=new Set(['companies','roles','users','user_roles','customers','invoices','payments','payment_allocations','collection_actions','payment_promises','message_templates','messages','settings','audit_logs','import_batches']);
    for(const match of initial.matchAll(/CREATE TABLE (\w+) \([\s\S]*?;/g))if(tables.has(match[1]))await db.query(match[0]);
    for(const migration of ['002_payment_allocations_soft_delete.sql','003_active_payment_invoice_allocation_unique.sql','004_auth_refresh_sessions.sql','005_users_username.sql','007_whatsapp_center.sql','008_mertel_customer_resolution.sql','009_collection_results_payments.sql'])await db.query(await readFile(new URL(`../../../database/migrations/${migration}`,import.meta.url),'utf8'));
    await db.query("INSERT INTO companies(id,name) VALUES (1,'MERTEL IMPORTACIONES');INSERT INTO roles(id,name) VALUES (1,'admin')");
    await db.query("INSERT INTO users(id,company_id,first_name,email,password_hash) VALUES (1,1,'Administrador','center@example.test',?)",[await argon2.hash(password,{type:argon2.argon2id})]);await db.query('INSERT INTO user_roles VALUES (1,1)');
    await db.query("INSERT INTO customers(id,company_id,nit,name,phone) VALUES (1,1,'90011111','Cliente centro','3001111111')");
    await db.query("INSERT INTO invoices(id,company_id,customer_id,invoice_number,issue_date,due_date,document_value,base_value,iva_value,balance) VALUES (1,1,1,'CENTER-1','2020-01-01','2020-02-01',100,100,0,90)");
    await db.query("INSERT INTO payments(id,company_id,customer_id,payment_date,amount) VALUES (1,1,1,CURRENT_DATE(),10);INSERT INTO payment_allocations(payment_id,invoice_id,amount) VALUES (1,1,10)");
    await db.query("INSERT INTO payment_promises(company_id,customer_id,invoice_id,promised_date,promised_amount) VALUES (1,1,1,'2020-01-01',20)");
    await db.query("INSERT INTO collection_actions(company_id,customer_id,invoice_id,action_type,status,reported_amount,reported_payment_date) VALUES (1,1,1,'PAYMENT_REPORTED','PENDING_REVIEW',30,CURRENT_DATE())");
    await db.query("INSERT INTO import_batches(id,company_id,user_id,file_name) VALUES (1,1,1,'DEMO centro.xlsx');INSERT INTO mertel_customer_resolution_rows(company_id,import_batch_id,identity_key,source_rows,source_data,status) VALUES (1,1,'demo','[]','{}','NEW')");
    const rules=await readFile(new URL('../../../backend/config/mertel-collection-rules.json',import.meta.url),'utf8');await db.query("INSERT INTO settings(company_id,setting_key,setting_value,value_type) VALUES (1,'collection_rules',?,'json')",[rules]);
    await db.query("INSERT INTO settings(company_id,setting_key,setting_value,value_type) VALUES (1,'whatsapp_center',?,'json')",[JSON.stringify({provider:'MOCK',connection_status:'CONNECTED',encrypted_credentials:'SECRET_UNEXPOSED'})]);
    await db.query("INSERT INTO audit_logs(company_id,entity_type,entity_id,action,new_values) VALUES (1,'collection_pipeline',1,'pipeline_recalculated',?)",[JSON.stringify({actor_type:'SYSTEM',customer_id:'1',amount:'90.00'})]);
    beforeFinance=await finance();
    const source=`import dotenv from 'dotenv';dotenv.config({quiet:true});const {createApp}=await import('./src/app.js');const server=createApp().listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));`;
    child=spawn(process.execPath,['--input-type=module','-e',source],{cwd:fileURLToPath(new URL('../../../backend/',import.meta.url)),env:{...process.env,...environment,DB_NAME:schema,NODE_ENV:'test',JWT_SECRET:randomBytes(48).toString('base64url'),FRONTEND_URL:'http://127.0.0.1:5173',AUTH_COOKIE_SAME_SITE:'lax',AUTH_RATE_LIMIT_MAX:'1000'},stdio:['ignore','pipe','pipe']});
    origin=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error('Isolated center API timeout')),15000);child.once('error',()=>{clearTimeout(timer);reject(new Error('API startup failed'));});child.stdout.on('data',chunk=>{output+=chunk.toString();const found=output.match(/\{"port":(\d+)\}/);if(found){clearTimeout(timer);resolve(`http://127.0.0.1:${found[1]}`);}});});
  });
  test.afterAll(async()=>{
    if(child&&child.exitCode===null){const stop=new Promise(resolve=>child.once('exit',resolve));child.kill();await stop;}
    if(db){if(!/^mertel_browser_admin_test_[a-f0-9]{32}$/.test(schema)||schema===environment.DB_NAME)throw new Error('Unsafe fixture cleanup');if(beforeFinance)expect(await finance()).toEqual(beforeFinance);await db.query(`DROP DATABASE IF EXISTS \`${schema}\``);await db.end();}
  });
  async function login(page){
    const responses=[];await page.route('**/api/**',async route=>{const url=new URL(route.request().url());const response=await route.fetch({url:origin+url.pathname+url.search});if(url.pathname==='/api/admin/dashboard')responses.push(await response.json());await route.fulfill({response});});
    await page.goto('/login');await page.getByLabel('Correo electrónico').fill('center@example.test');await page.getByLabel('Contraseña',{exact:true}).fill(password);await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();await expect(page).toHaveURL('http://127.0.0.1:5173/');return responses;
  }
  test('cards, API periods, refresh, direct customer, payments, promises and audit navigation',async({page})=>{
    const responses=await login(page);await page.getByRole('link',{name:'Centro Administrativo',exact:true}).click();await expect(page.getByText('MOCK — conexión simulada')).toBeVisible();
    for(const title of ['Cartera y distribución del Pipeline','Recuperación','Clientes por resolver','Promesas','WhatsApp','Actividad reciente'])await expect(page.getByRole('region',{name:title,exact:true})).toBeVisible();
    const initial=responses.at(-1).data;for(const key of ['summary','collection','recovery','resolution','reported_payments','promises','whatsapp','recent_activity','top_customers','priority_customers'])expect(initial[key].status).toBe('ok');
    expect(initial.summary.data.total_balance).toBe('90.00');expect(initial.recovery.data.payments_amount).toBe('10.00');expect(initial.resolution.data.pending).toBe(1);expect(Number(initial.promises.data.overdue)).toBe(1);expect(initial.reported_payments.data.amount).toBe('30.00');expect(JSON.stringify(initial)).not.toContain('SECRET_UNEXPOSED');
    await page.getByLabel('Período de actividad').selectOption('7');await expect(page.getByText('MOCK — conexión simulada')).toBeVisible();expect(responses.at(-1).data.period.period).toBe('7');expect(responses.at(-1).data.summary).toEqual(initial.summary);
    const count=responses.length;await page.getByRole('button',{name:'Actualizar',exact:true}).click();await expect.poll(()=>responses.length).toBe(count+1);await expect(page.getByText('MOCK — conexión simulada')).toBeVisible();
    await page.getByRole('region',{name:'Mayor cartera pendiente',exact:true}).getByRole('link',{name:'Cliente centro'}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('button',{name:'Cerrar detalle'}).click();
    await page.goto('/administracion');await page.getByRole('navigation',{name:'Acciones rápidas'}).getByRole('link',{name:'Ver Pipeline'}).click();await expect(page.getByRole('heading',{name:'Cobranza',exact:true})).toBeVisible();
    await page.goto('/administracion');await page.getByRole('navigation',{name:'Acciones rápidas'}).getByRole('link',{name:'Revisar pagos'}).click();await expect(page.getByRole('heading',{name:'Pagos reportados',exact:true})).toBeVisible();
    await page.goto('/administracion');await page.getByRole('navigation',{name:'Acciones rápidas'}).getByRole('link',{name:'Auditoría'}).click();await expect(page.getByRole('heading',{name:'Historial de cobranza'})).toBeVisible();
    await page.goto('/administracion');await page.getByRole('navigation',{name:'Acciones rápidas'}).getByRole('link',{name:'Revisar promesas'}).click();await expect(page.getByLabel('Tipo de evento')).toHaveValue('promise');expect(await finance()).toEqual(beforeFinance);
  });
  test('responsive mobile and tablet keep viewport usable',async({page})=>{
    await login(page);for(const width of [390,768,1366]){await page.setViewportSize({width,height:900});await page.goto('/administracion');await expect(page.getByText('MOCK — conexión simulada')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
    await page.screenshot({path:'../tmp/admin-dashboard-desktop.png',fullPage:true});expect(await finance()).toEqual(beforeFinance);
  });
});
