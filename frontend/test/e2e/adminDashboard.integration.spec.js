import {expect,test} from '@playwright/test';
import {Buffer} from 'node:buffer';
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
    for(const migration of ['002_payment_allocations_soft_delete.sql','003_active_payment_invoice_allocation_unique.sql','004_auth_refresh_sessions.sql','005_users_username.sql','007_whatsapp_center.sql','010_whatsapp_automation.sql','008_mertel_customer_resolution.sql','009_collection_results_payments.sql'])await db.query(await readFile(new URL(`../../../database/migrations/${migration}`,import.meta.url),'utf8'));
    await db.query("INSERT INTO companies(id,name) VALUES (1,'MERTEL IMPORTACIONES');INSERT INTO roles(id,name) VALUES (1,'admin'),(2,'collector'),(3,'supervisor')");
    await db.query("INSERT INTO users(id,company_id,first_name,email,password_hash) VALUES (1,1,'Administrador','center@example.test',?)",[await argon2.hash(password,{type:argon2.argon2id})]);await db.query('INSERT INTO user_roles VALUES (1,1)');
    await db.query("INSERT INTO customers(id,company_id,nit,name,phone) VALUES (1,1,'90011111','Cliente centro','3001111111')");
    await db.query("INSERT INTO invoices(id,company_id,customer_id,invoice_number,issue_date,due_date,document_value,base_value,iva_value,balance) VALUES (1,1,1,'CENTER-1','2020-01-01','2020-02-01',100,100,0,90)");
    await db.query("INSERT INTO payments(id,company_id,customer_id,payment_date,amount,created_at) VALUES (1,1,1,CURRENT_DATE(),10,UTC_TIMESTAMP());INSERT INTO payment_allocations(payment_id,invoice_id,amount) VALUES (1,1,10)");
    await db.query("INSERT INTO payment_promises(company_id,customer_id,invoice_id,promised_date,promised_amount) VALUES (1,1,1,'2020-01-01',20)");
    await db.query("INSERT INTO collection_actions(company_id,customer_id,invoice_id,action_type,status,reported_amount,reported_payment_date) VALUES (1,1,1,'PAYMENT_REPORTED','PENDING_REVIEW',30,CURRENT_DATE())");
    await db.query("INSERT INTO collection_actions(company_id,customer_id,action_type,action_date) VALUES (1,1,'CONTACTED',DATE_SUB(CURRENT_DATE(),INTERVAL 2 DAY)),(1,1,'CONTACTED',DATE_SUB(CURRENT_DATE(),INTERVAL 3 DAY))");
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
  test('configuration users: create, edit, activate/deactivate and authenticate using the existing backend',async({page})=>{
    await login(page);await page.goto('/configuracion/usuarios');await expect(page.getByRole('heading',{name:'Usuarios',exact:true})).toBeVisible();
    await expect(page.getByText('Administrador',{exact:true}).last()).toBeVisible();await page.locator('summary').filter({hasText:'Consultar roles y permisos'}).click();await page.getByRole('button',{name:'Consultar roles y permisos',exact:true}).click();await expect(page.getByRole('table').filter({has:page.locator('caption')})).toBeVisible();await page.locator('summary').filter({hasText:'Consultar roles y permisos'}).click();await page.getByRole('button',{name:'+ Crear usuario',exact:true}).click();const dialog=page.getByRole('dialog');
    await dialog.getByLabel('Nombre',{exact:true}).fill('Trabajador E2E');await dialog.getByLabel('Nombre de usuario',{exact:true}).fill('worker.e2e');await dialog.getByLabel('Correo electrónico').fill('worker-ui@example.test');await dialog.getByLabel('Contraseña inicial').fill(password);await dialog.getByRole('checkbox',{name:'Collector',exact:true}).check();await dialog.getByRole('button',{name:'Crear usuario',exact:true}).click();
    await expect(page.getByText('Usuario creado.',{exact:true})).toBeVisible();let row=page.getByRole('row').filter({hasText:'Trabajador E2E'});await expect(row).toBeVisible();const [[worker]]=await db.query("SELECT id,password_hash,company_id FROM users WHERE username='worker.e2e'");expect(worker.company_id).toBe(1);expect(worker.password_hash).toMatch(/^\$argon2id\$/);
    await row.getByRole('button',{name:'Editar',exact:true}).click();await dialog.getByLabel('Nombre',{exact:true}).fill('Editado E2E');await dialog.getByRole('checkbox',{name:'Collector',exact:true}).uncheck();await dialog.getByRole('checkbox',{name:'Supervisor',exact:true}).check();await expect(dialog.getByLabel('Contraseña inicial')).toHaveCount(0);await dialog.getByRole('button',{name:'Guardar cambios'}).click();await expect(page.getByText('Datos del usuario actualizados.',{exact:true})).toBeVisible();row=page.getByRole('row').filter({hasText:'Editado E2E'});await expect(row).toContainText('Supervisor');expect((await db.query('SELECT password_hash FROM users WHERE id=?',[worker.id]))[0][0].password_hash).toBe(worker.password_hash);
    await row.getByRole('button',{name:'Desactivar',exact:true}).click();await page.getByRole('button',{name:'Confirmar estado'}).click();await expect(row.getByText('Inactivo',{exact:true})).toBeVisible();await row.getByRole('button',{name:'Activar',exact:true}).click();await page.getByRole('button',{name:'Confirmar estado'}).click();await expect(row.getByText('Activo',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Cerrar sesión',exact:true}).click();await page.getByLabel('Correo electrónico').fill('worker-ui@example.test');await page.getByLabel('Contraseña',{exact:true}).fill(password);await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();await expect(page).toHaveURL('http://127.0.0.1:5173/');await page.goto('/configuracion/usuarios');await expect(page.getByText('No tienes permiso para administrar usuarios.',{exact:true})).toBeVisible();expect(await finance()).toEqual(beforeFinance);
  });
  test('sidebar hides native scrollbar while wheel, keyboard and independent content scrolling remain functional',async({page})=>{
    await page.setViewportSize({width:1366,height:600});await login(page);const nav=page.getByRole('navigation',{name:'Navegación principal'});await expect(nav).toBeVisible();
    const style=await nav.evaluate(element=>({width:getComputedStyle(element).scrollbarWidth,x:getComputedStyle(element).overflowX,y:getComputedStyle(element).overflowY,scroll:element.scrollHeight>element.clientHeight}));expect(style).toEqual({width:'none',x:'hidden',y:'auto',scroll:true});
    const box=await nav.boundingBox();await page.mouse.move(box.x+40,box.y+40);await page.mouse.wheel(0,350);await expect.poll(()=>nav.evaluate(element=>element.scrollTop)).toBeGreaterThan(0);expect(await page.evaluate(()=>scrollY)).toBe(0);
    await page.keyboard.press('Tab');await nav.getByRole('link').last().focus();expect(await nav.getByRole('link').last().evaluate(element=>getComputedStyle(element).outlineStyle)).not.toBe('none');
    await page.mouse.move(1000,450);await page.mouse.wheel(0,500);await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(0);expect(await page.locator('.mertel-sidebar').evaluate(element=>getComputedStyle(element).position)).toBe('fixed');
    await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await nav.evaluate(element=>getComputedStyle(element).scrollbarWidth)).toBe('none');
  });
  test('main dashboard uses live persisted KPIs and stays responsive without financial writes',async({page})=>{
    const consoleErrors=[];page.on('pageerror',error=>consoleErrors.push(error.message));
    const responses=await login(page);
    page.on('console',message=>{if(message.type()==='error'||message.text().includes('should be greater than 0'))consoleErrors.push(message.text());});
    await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
    await expect(page.getByText('Saldo total por cobrar')).toBeVisible();
    await expect.poll(()=>responses.length).toBeGreaterThan(0);
    const result=responses.at(-1).data;
    expect(result.overview.data.customers_with_balance).toBe(1);
    expect(Number(result.overview.data.pending_invoices)).toBe(1);
    expect(Number(result.overview.data.overdue_invoices)).toBe(1);
    expect(result.overview.data.invoiced_value).toBe('100.00');
    expect(result.overview.data.sent_messages).toBe(0);
    expect(result.summary.data.total_balance).toBe('90.00');
    expect(result.top_customers.data[0].invoices_count).toBe(1);
    expect(result.activity_trend.data.length).toBeGreaterThanOrEqual(1);
    for(const label of ['Resumen general','Estado de cartera','Actividad de cobranza','Pagos','Análisis de clientes','Clientes prioritarios','Actividad reciente'])await expect(page.getByRole('region',{name:label,exact:true})).toBeVisible();
    for(const title of ['Distribución de cartera','Saldo por etapa','Análisis de clientes','Tendencia de actividad'])await expect(page.getByRole('region',{name:title,exact:true}).locator('.recharts-wrapper > svg.recharts-surface')).toBeVisible();
    await expect(page.getByRole('region',{name:'Distribución de cartera'}).getByText('100.0%',{exact:true})).toBeVisible();
    for(const width of [390,768,1024,1366,1920]){
      await page.setViewportSize({width,height:1000});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      for(const title of ['Distribución de cartera','Saldo por etapa'])expect((await page.getByRole('region',{name:title,exact:true}).locator('.recharts-wrapper > svg.recharts-surface').boundingBox()).width).toBeGreaterThan(150);
      await page.screenshot({path:'../tmp/main-dashboard-bi-'+width+'.png',fullPage:true});
      await page.screenshot({path:'../tmp/main-dashboard-bi-'+width+'-viewport.png'});
    }
    await page.keyboard.press('Tab');await page.getByRole('button',{name:'Actualizar',exact:true}).focus();expect(await page.getByRole('button',{name:'Actualizar',exact:true}).evaluate(element=>getComputedStyle(element).outlineStyle)).not.toBe('none');
    await page.screenshot({path:'../tmp/main-dashboard-desktop.png',fullPage:true});
    expect(consoleErrors).toEqual([]);
    expect(await finance()).toEqual(beforeFinance);
  });
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

  test('settings center navigates existing categories and stays usable at all target sizes',async({page})=>{
    test.setTimeout(120000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));await login(page);page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    for(const width of [390,768,1024,1366,1920]){
      await page.setViewportSize({width,height:1000});
      for(const category of ['', 'general','cobranza','usuarios','whatsapp','mensajes','importaciones','sistema','personalizacion']){
        await page.goto('/configuracion'+(category?'/'+category:''),{waitUntil:'domcontentloaded'});
        await expect(page.getByRole('heading',{name:'Configuración',exact:true})).toBeVisible();
        if(category==='personalizacion')await expect(page.getByLabel('Color principal HEX')).toBeVisible();
        if(category==='usuarios')await expect(page.getByRole('button',{name:'+ Crear usuario'})).toBeEnabled();
        if(category==='whatsapp'){await page.getByRole('button',{name:'Conexión',exact:true}).click();await expect(page.getByText(/^(Conectado|No conectado|Configurado · sin validar|Desconectado|Error de conexión)$/)).toBeVisible();}
        if(category==='cobranza'){await expect(page.getByText('En mora → Vence hoy → Faltan 5 días → Pronto pago')).toBeVisible();await expect(page.getByText('Peso colombiano (COP)')).toBeVisible();}
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow: ${width} ${category}`).toBe(true);
      }
      if(width===390)await page.screenshot({path:'../tmp/settings-personalization-mobile.png',fullPage:true});
    }
    await page.goto('/configuracion');await page.screenshot({path:'../tmp/settings-center-desktop.png',fullPage:true});
    await expect(page.getByRole('navigation',{name:'Navegación principal'}).getByRole('link',{name:'Configuración',exact:true})).toHaveCount(1);
    await page.getByRole('link',{name:/Mensajes Plantillas/}).click();await expect(page.getByRole('link',{name:/Plantillas y variables/})).toHaveAttribute('href','/administracion/plantillas-whatsapp');
    expect(errors).toEqual([]);expect(await finance()).toEqual(beforeFinance);
  });
  test('appearance colors persist with default identity through PUT, MySQL, GET, two reloads and login',async({page})=>{
    const expected={primary:'#166534',accent:'#7c3aed',sidebar:'#0c4a6e'},responses=[];let putHeaders;
    page.on('response',async response=>{if(new URL(response.url()).pathname==='/api/appearance')responses.push({method:response.request().method(),status:response.status(),body:await response.json()});});
    page.on('request',request=>{if(new URL(request.url()).pathname==='/api/appearance'&&request.method()==='PUT')putHeaders=request.headers();});
    await login(page);await page.getByRole('navigation',{name:'Navegación principal'}).getByRole('link',{name:'Configuración',exact:true}).click();await page.getByRole('link',{name:/Personalización Identidad/}).click();
    await expect(page.getByLabel('Nombre de la aplicación')).toHaveValue('MERTEL');
    for(const [label,value]of [['Color principal HEX',expected.primary],['Color de acento HEX',expected.accent],['Color del sidebar HEX',expected.sidebar]])await page.getByLabel(label).fill(value);
    await page.getByRole('button',{name:'Guardar cambios',exact:true}).click();await expect(page.getByText('Apariencia guardada para MERTEL.')).toBeVisible();
    expect(responses.find(response=>response.method==='PUT')).toMatchObject({status:200,body:{success:true,data:{appearance:{name:'MERTEL',colors:expected}}}});
    const [[row]]=await db.query("SELECT setting_value FROM settings WHERE company_id=1 AND setting_key='visual_appearance'");expect(JSON.parse(row.setting_value).colors).toMatchObject(expected);
    const immediate=await page.request.get(origin+'/api/appearance',{headers:putHeaders});expect(immediate.status()).toBe(200);expect((await immediate.json()).data.appearance.colors).toMatchObject(expected);
    async function check(){for(const [label,value]of [['Color principal HEX',expected.primary],['Color de acento HEX',expected.accent],['Color del sidebar HEX',expected.sidebar]])await expect(page.getByLabel(label)).toHaveValue(value);for(const [key,value]of Object.entries(expected))expect(await page.evaluate(key=>getComputedStyle(document.documentElement).getPropertyValue('--mertel-'+key).trim(),key)).toBe(value);expect(await page.locator('.mertel-sidebar').evaluate(element=>getComputedStyle(element).backgroundColor)).toBe('rgb(12, 74, 110)');}
    for(let iteration=0;iteration<2;iteration++){await page.reload();await check();expect(responses.filter(response=>response.method==='GET').at(-1).body.data.appearance.colors).toMatchObject(expected);}
    await page.getByRole('navigation',{name:'Navegación principal'}).getByRole('link',{name:'Clientes',exact:true}).click();expect(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--mertel-primary').trim())).toBe(expected.primary);await page.goto('/configuracion/personalizacion');await check();
    await page.getByRole('button',{name:'Cerrar sesión',exact:true}).click();await page.getByLabel('Correo electrónico').fill('center@example.test');await page.getByLabel('Contraseña',{exact:true}).fill(password);await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();await expect(page).toHaveURL('http://127.0.0.1:5173/');await page.goto('/configuracion/personalizacion');await check();
    await page.getByRole('button',{name:'Restaurar apariencia predeterminada',exact:true}).click();await page.getByRole('button',{name:'Confirmar restauración',exact:true}).click();await expect(page.getByLabel('Color principal HEX')).toHaveValue('#172033');await page.reload();await expect(page.getByLabel('Color principal HEX')).toHaveValue('#172033');
  });
  test('appearance persists real branding and logos, isolates simulation and resets only visual settings',async({page})=>{
    test.setTimeout(60000);
    const unchanged=(await db.query("SELECT * FROM settings WHERE setting_key<>'visual_appearance' ORDER BY id"))[0];await login(page);await page.goto('/configuracion/personalizacion');await expect(page.getByLabel('Nombre de la aplicación')).toBeVisible();
    await page.getByLabel('Nombre de la aplicación').fill('MERTEL Identidad');await page.getByLabel('Color principal HEX').fill('#166534');await page.getByLabel('Color del sidebar HEX').fill('#134e4a');
    await expect(page.locator('.mertel-header h1')).toHaveText('MERTEL Identidad');expect(await page.locator('.mertel-sidebar').evaluate(element=>getComputedStyle(element).backgroundColor)).toBe('rgb(19, 78, 74)');
    const image=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;const context=canvas.getContext('2d');context.fillStyle='#166534';context.fillRect(0,0,16,16);return canvas.toDataURL('image/png');});
    await page.getByLabel('Logo principal',{exact:true}).setInputFiles({name:'logo.png',mimeType:'image/png',buffer:Buffer.from(image.split(',')[1],'base64')});await expect(page.locator('.mertel-brand-main-logo')).toHaveAttribute('src',image);
    await page.getByLabel('Logo compacto para sidebar',{exact:true}).setInputFiles({name:'compact.png',mimeType:'image/png',buffer:Buffer.from(image.split(',')[1],'base64')});await expect(page.locator('.mertel-brand-mark img')).toHaveAttribute('src',image);
    await page.getByRole('button',{name:'Guardar cambios',exact:true}).click();await expect(page.getByText('Apariencia guardada para MERTEL.')).toBeVisible();await page.reload();await expect(page.getByLabel('Nombre de la aplicación')).toHaveValue('MERTEL Identidad');await expect(page.locator('.mertel-brand-main-logo')).toHaveAttribute('src',image);
    await expect(page.getByLabel('Color principal HEX')).toHaveValue('#166534');await expect(page.getByLabel('Color del sidebar HEX')).toHaveValue('#134e4a');
    const replacement=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;canvas.getContext('2d').fillRect(0,0,16,16);return canvas.toDataURL('image/png');});
    await page.getByLabel('Logo principal',{exact:true}).setInputFiles({name:'replacement.png',mimeType:'image/png',buffer:Buffer.from(replacement.split(',')[1],'base64')});await expect(page.locator('.mertel-brand-main-logo')).toHaveAttribute('src',replacement);await page.getByRole('button',{name:'Restaurar logo compacto para sidebar',exact:true}).click();await expect(page.locator('.mertel-brand-mark img')).toHaveCount(0);await page.getByRole('button',{name:'Guardar cambios',exact:true}).click();await expect(page.getByText('Apariencia guardada para MERTEL.')).toBeVisible();
    const real=(await db.query("SELECT setting_value FROM settings WHERE company_id=1 AND setting_key='visual_appearance'"))[0][0].setting_value;
    await page.getByRole('button',{name:'Activar simulación'}).click();await expect(page.getByText('MODO SIMULACIÓN',{exact:true}).first()).toBeVisible();let realRequests=0;page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/'))realRequests++;});
    await page.getByRole('navigation',{name:'Navegación principal'}).getByRole('link',{name:'Configuración',exact:true}).click();await page.getByRole('link',{name:/Personalización Identidad/}).click();await page.getByLabel('Nombre de la aplicación').fill('MERTEL Temporal');await page.getByLabel('Color principal HEX').fill('#134e4a');await page.getByRole('button',{name:'Guardar cambios',exact:true}).click();await expect(page.getByText('Apariencia aplicada solo a esta simulación.')).toBeVisible();
    expect(realRequests).toBe(0);expect((await db.query("SELECT setting_value FROM settings WHERE company_id=1 AND setting_key='visual_appearance'"))[0][0].setting_value).toBe(real);
    await page.reload();await expect(page.getByLabel('Nombre de la aplicación')).toHaveValue('MERTEL');await expect(page.getByLabel('Color principal HEX')).toHaveValue('#172033');expect(realRequests).toBe(0);expect((await db.query("SELECT setting_value FROM settings WHERE company_id=1 AND setting_key='visual_appearance'"))[0][0].setting_value).toBe(real);
    await page.getByRole('button',{name:'Reiniciar simulación'}).click();await expect(page.locator('.mertel-header h1')).toHaveText('MERTEL');expect(realRequests).toBe(0);
    page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Salir de simulación'}).click();await expect(page.locator('.mertel-header h1')).toHaveText('MERTEL Identidad');await page.getByRole('navigation',{name:'Navegación principal'}).getByRole('link',{name:'Configuración',exact:true}).click();await page.getByRole('link',{name:/Personalización Identidad/}).click();
    await page.getByRole('button',{name:'Restaurar apariencia predeterminada',exact:true}).click();await expect(page.getByText('¿Restaurar la apariencia predeterminada de MERTEL?')).toBeVisible();await page.getByRole('button',{name:'Confirmar restauración',exact:true}).click();await expect(page.getByLabel('Nombre de la aplicación')).toHaveValue('MERTEL');await expect(page.locator('.mertel-brand-main-logo')).toHaveCount(0);
    expect((await db.query("SELECT * FROM settings WHERE setting_key<>'visual_appearance' ORDER BY id"))[0]).toEqual(unchanged);expect(await finance()).toEqual(beforeFinance);
  });
});
