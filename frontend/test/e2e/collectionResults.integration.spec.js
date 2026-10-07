import {expect,test} from '@playwright/test';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import process from 'node:process';
const requireBackend=createRequire(new URL('../../../backend/package.json',import.meta.url));
const mysql=requireBackend('mysql2/promise'),dotenv=requireBackend('dotenv'),argon2=requireBackend('argon2');
let environment={};try{environment=dotenv.parse(await readFile(new URL('../../../backend/.env',import.meta.url)));}catch{/* local integration optional in CI */}

test.describe('Pipeline management → real Express → isolated financial ledger',()=>{
  test.skip(!environment.DB_HOST||!environment.DB_USER,'Requires local MySQL for isolated financial E2E.');
  const schema=`mertel_browser_results_test_${randomUUID().replaceAll('-','')}`;
  const email='results-admin@example.test',password=randomBytes(32).toString('base64url'),secret=randomBytes(48).toString('base64url');
  let db,child,origin,pipeline,companies;
  test.beforeAll(async()=>{
    db=await mysql.createConnection({host:environment.DB_HOST,port:Number(environment.DB_PORT),user:environment.DB_USER,password:environment.DB_PASSWORD,multipleStatements:true});
    await db.query(`CREATE DATABASE \`${schema}\``);await db.query(`USE \`${schema}\``);
    const initial=await readFile(new URL('../../../database/migrations/001_initial_schema.sql',import.meta.url),'utf8');
    const tables=new Set(['companies','roles','users','user_roles','customers','invoices','payments','payment_allocations','collection_actions','payment_promises','message_templates','messages','settings','audit_logs']);
    for(const match of initial.matchAll(/CREATE TABLE (\w+) \([\s\S]*?;/g))if(tables.has(match[1]))await db.query(match[0]);
    for(const migration of ['002_payment_allocations_soft_delete.sql','003_active_payment_invoice_allocation_unique.sql','004_auth_refresh_sessions.sql','005_users_username.sql','007_whatsapp_center.sql','009_collection_results_payments.sql'])await db.query(await readFile(new URL(`../../../database/migrations/${migration}`,import.meta.url),'utf8'));
    await db.query("INSERT INTO companies(id,name) VALUES (1,'MERTEL IMPORTACIONES')");await db.query("INSERT INTO roles(id,name) VALUES (1,'admin')");
    await db.query("INSERT INTO users(id,company_id,first_name,email,password_hash) VALUES (1,1,'Administrador',?,?)",[email,await argon2.hash(password,{type:argon2.argon2id})]);await db.query('INSERT INTO user_roles VALUES (1,1)');
    const definitions=[['Cliente pago total','100.00'],['Cliente pago reportado','50.00'],['Cliente pago parcial','100.00']];const rows=[];const resolved=new Map();
    for(let n=0;n<definitions.length;n++){
      const id=n+1,nit=String(90010000+id),[name,amount]=definitions[n];
      await db.query("INSERT INTO customers(id,company_id,nit,name,phone) VALUES (?,1,?,?,?)",[id,nit,name,`300000000${id}`]);resolved.set(nit,String(id));
      await db.query("INSERT INTO invoices(id,company_id,customer_id,invoice_number,issue_date,due_date,document_value,base_value,iva_value,balance) VALUES (?,1,?,?,'2020-01-01','2020-02-01',?,?,0,?)",[id,id,`PIPE-${id}`,amount,amount,amount]);
      rows.push({row_number:8+n,type:'DOCUMENT',movement_type:'invoice',movement:'FV',customer_nit_original:nit,customer_nit_normalized:nit,document_number:`PIPE-${id}`,issue_date:'2020-01-01',due_date:'2020-02-01',document_value:Number(amount),iva:0,values:{'Nombre cliente':name,'+90 días':amount,Telefono:`300000000${id}`}});
    }
    const rules=JSON.parse(await readFile(new URL('../../../backend/config/mertel-collection-rules.json',import.meta.url),'utf8'));await db.query("INSERT INTO settings(company_id,setting_key,setting_value,value_type) VALUES (1,'collection_rules',?,'json')",[JSON.stringify(rules)]);
    const {buildPortfolioPipeline}=await import('../../../backend/src/services/portfolioPipeline.service.js');
    pipeline=buildPortfolioPipeline({parsed:{documents:rows,issues:[]},referenceDate:'2026-10-07',companyId:'1',rules,fileName:'DEMO cartera.xlsx',sourceHash:'a'.repeat(64),secret,resolutionByNit:resolved});
    companies=(await db.query('CHECKSUM TABLE companies,customers'))[0];
    const source=`import dotenv from 'dotenv';dotenv.config({quiet:true});const {createApp}=await import('./src/app.js');const server=createApp().listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));`;
    child=spawn(process.execPath,['--input-type=module','-e',source],{cwd:fileURLToPath(new URL('../../../backend/',import.meta.url)),env:{...process.env,...environment,DB_NAME:schema,NODE_ENV:'test',JWT_SECRET:secret,FRONTEND_URL:'http://127.0.0.1:5173',AUTH_COOKIE_SAME_SITE:'lax',AUTH_RATE_LIMIT_MAX:'1000'},stdio:['ignore','pipe','pipe']});
    origin=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error('Isolated results API timeout')),15000);child.once('error',()=>{clearTimeout(timer);reject(new Error('API startup failed'));});child.stdout.on('data',chunk=>{output+=chunk.toString();const found=output.match(/\{"port":(\d+)\}/);if(found){clearTimeout(timer);resolve(`http://127.0.0.1:${found[1]}`);}});});
  });
  test.afterAll(async()=>{
    if(child&&child.exitCode===null){const stop=new Promise(resolve=>child.once('exit',resolve));child.kill();await stop;}
    if(db){if(!/^mertel_browser_results_test_[a-f0-9]{32}$/.test(schema)||schema===environment.DB_NAME)throw new Error('Unsafe fixture cleanup');expect((await db.query('CHECKSUM TABLE companies,customers'))[0]).toEqual(companies);await db.query(`DROP DATABASE IF EXISTS \`${schema}\``);await db.end();}
  });
  async function login(page){
    const calls=[];await page.route('**/api/**',async route=>{const url=new URL(route.request().url());const response=await route.fetch({url:origin+url.pathname+url.search});calls.push({path:url.pathname,method:route.request().method(),status:response.status()});await route.fulfill({response});});
    await page.goto('/login');await page.getByLabel('Correo electrónico').fill(email);await page.getByLabel('Contraseña',{exact:true}).fill(password);await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();await expect(page).toHaveURL('http://127.0.0.1:5173/');return calls;
  }
  async function openPipeline(page){await page.goto('/cobranza');await expect(page.getByRole('heading',{name:'Cobranza',exact:true})).toBeVisible();await page.evaluate(data=>{history.replaceState({usr:{portfolioPipeline:data},key:'management-fixture'},'', '/cobranza');},pipeline);await page.reload();await expect(page.getByRole('heading',{name:'Pipeline de cartera importada'})).toBeVisible();}
  const card=(page,name)=>page.locator('.cobranza-client-card').filter({has:page.getByRole('heading',{name,exact:true})});
  async function management(page,name){await card(page,name).getByRole('button',{name:'Gestionar',exact:true}).click();await expect(page.getByRole('button',{name:'Cliente pagó',exact:true})).toBeVisible();return page.getByRole('dialog');}
  async function confirmForm(dialog,invoice,amount){
    await dialog.getByLabel(`Seleccionar factura ${invoice}`).check();if(amount)await dialog.getByLabel('Monto recibido').fill(amount);await dialog.getByLabel('Fecha de pago',{exact:true}).fill('2026-10-07');await dialog.getByRole('button',{name:'Revisar pago',exact:true}).click();await expect(dialog.getByLabel('Resumen de confirmación del pago')).toBeVisible();await dialog.getByRole('button',{name:'Confirmar pago',exact:true}).click();
  }
  test('full payment: core ledger, allocation, zero balance, engine removal, history and automatic ineligibility',async({page})=>{
    const calls=await login(page);await openPipeline(page);const dialog=await management(page,'Cliente pago total');await dialog.getByRole('button',{name:'Cliente pagó',exact:true}).click();await confirmForm(dialog,'PIPE-1');
    await expect(card(page,'Cliente pago total')).toHaveCount(0);await expect(dialog.getByText('Pago registrado',{exact:true})).toBeVisible();
    const [[invoice]]=await db.query('SELECT balance,document_value,base_value,iva_value FROM invoices WHERE id=1');expect(invoice).toMatchObject({balance:'0.00',document_value:'100.00',base_value:'100.00',iva_value:'0.00'});
    const [[payment]]=await db.query('SELECT amount FROM payments WHERE customer_id=1');expect(payment.amount).toBe('100.00');const [[allocation]]=await db.query('SELECT a.amount FROM payment_allocations a JOIN payments p ON p.id=a.payment_id WHERE p.customer_id=1');expect(allocation.amount).toBe('100.00');
    expect(calls.some(call=>call.path.endsWith('/customers/1/payments')&&call.status===200)).toBe(true);
    const contextResponse=await page.request.get(`${origin}/api/collection/results/customers/1/context`);expect(contextResponse.status()).toBe(401);
    await dialog.getByRole('button',{name:'Cerrar detalle'}).click();await page.goto('/administracion/whatsapp');await page.getByRole('button',{name:'Configurar WhatsApp'}).click();await page.getByLabel('Proveedor',{exact:true}).selectOption('MOCK');await page.getByLabel('Máximo global diario').fill('100');await page.getByLabel('Máximo por cliente/día').fill('10');await page.getByRole('button',{name:'Guardar configuración'}).click();await page.getByRole('button',{name:'Probar conexión MOCK'}).click();
    await page.getByRole('button',{name:'Mensajes',exact:true}).click();
    const automatic=await page.evaluate(async()=>{
      const {default:api}=await import('/src/services/api.js');
      const {data}=await api.post('/collection/message-templates',{name:'DEMO E2E automática',channel:'whatsapp',content:'{{saldo}}',stage:'overdue',status:'active'});
      await api.put('/admin/whatsapp/automations/overdue',{stage:'overdue',enabled:true,template_id:data.data.id,start_time:'00:00',end_time:'23:59',weekdays:[1,2,3,4,5,6,7],daily_limit:100,interval_hours:1,mode:'AUTOMATICO'});
      await api.patch('/admin/whatsapp/settings',{automations_enabled:true});
      try{await api.post('/admin/whatsapp/queue',{customer_id:'1',mode:'AUTOMATICO'});return{status:200};}
      catch(error){return{status:error.response?.status,message:error.response?.data?.message};}
    });
    expect(automatic.status).toBe(409);expect(automatic.message).toContain('no identifica');
    const [[messages]]=await db.query('SELECT COUNT(*) AS total FROM messages WHERE customer_id=1');expect(messages.total).toBe(0);
  });
  test('reported payment preserves balances; administrator confirms through financial preview and engine refresh',async({page})=>{
    await login(page);await openPipeline(page);const dialog=await management(page,'Cliente pago reportado');await dialog.getByRole('button',{name:'Reportar pago',exact:true}).click();await dialog.getByLabel('Factura relacionada').selectOption('2');await dialog.getByLabel('Monto informado').fill('50');await dialog.getByLabel('Fecha informada').fill('2026-10-07');await dialog.getByLabel('Observación del resultado').fill('Cliente informa pago; verificar soporte');
    const [before]=await db.query('CHECKSUM TABLE invoices,payments,payment_allocations');await dialog.getByRole('button',{name:'Guardar reporte',exact:true}).click();await expect(dialog.getByText('⚠️ Pago reportado · Pendiente de conciliación',{exact:true})).toBeVisible();expect((await db.query('CHECKSUM TABLE invoices,payments,payment_allocations'))[0]).toEqual(before);
    const [[report]]=await db.query("SELECT id,status FROM collection_actions WHERE customer_id=2 AND action_type='PAYMENT_REPORTED'");expect(report.status).toBe('PENDING_REVIEW');
    await dialog.getByRole('button',{name:'Cerrar detalle'}).click();await page.getByRole('link',{name:'Pagos reportados',exact:true}).click();await page.getByRole('button',{name:`Revisar pago ${report.id}`,exact:true}).click();await page.getByRole('button',{name:'Revisar pago',exact:true}).click();await expect(page.getByLabel('Resumen de confirmación del pago')).toContainText('Saldo resultante calculado por el servidor');await page.getByRole('button',{name:'Confirmar pago',exact:true}).click();await expect(page.getByText('Pago reportado confirmado y registrado. Los saldos fueron recalculados por el servidor.')).toBeVisible();
    const [[invoice]]=await db.query('SELECT balance FROM invoices WHERE id=2');expect(invoice.balance).toBe('0.00');const [[payment]]=await db.query('SELECT amount FROM payments WHERE customer_id=2');expect(payment.amount).toBe('50.00');const [[allocation]]=await db.query('SELECT a.amount FROM payment_allocations a JOIN payments p ON p.id=a.payment_id WHERE p.customer_id=2');expect(allocation.amount).toBe('50.00');
    await openPipeline(page);await expect(card(page,'Cliente pago reportado')).toHaveCount(0);
  });
  test('partial payment on mobile retains card with backend balance and stage, without viewport overflow',async({page})=>{
    await page.setViewportSize({width:390,height:844});await login(page);await openPipeline(page);const dialog=await management(page,'Cliente pago parcial');await dialog.getByRole('button',{name:'Pago parcial',exact:true}).click();await confirmForm(dialog,'PIPE-3','40');await expect(dialog.getByText('Pago parcial registrado',{exact:true})).toBeVisible();
    await dialog.getByRole('button',{name:'Cerrar detalle'}).click();await expect(card(page,'Cliente pago parcial')).toContainText('60');await expect(card(page,'Cliente pago parcial')).toContainText('En mora');
    const [[invoice]]=await db.query('SELECT balance FROM invoices WHERE id=3');expect(invoice.balance).toBe('60.00');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:'../tmp/collection-results-mobile.png',fullPage:true});
  });
});
