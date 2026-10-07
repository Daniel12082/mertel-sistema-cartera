import {after,afterEach,before,beforeEach,describe,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import {loadAuthConfig} from '../src/config/auth.js';
import {applyAuthMigrations} from '../src/services/authMigrations.service.js';
import {applyWhatsAppMigration} from '../src/services/whatsappMigration.service.js';
import {applyCollectionResultsMigration} from '../src/services/collectionResultsMigration.service.js';
dotenv.config({path:new URL('../.env',import.meta.url),quiet:true});

describe('Administrative dashboard / real MySQL read-only', {skip:!(process.env.DB_HOST&&process.env.DB_USER)},()=>{
  const schema=`mertel_admin_test_${randomUUID().replaceAll('-','')}`;const original=process.env.DB_NAME;const previousSecret=process.env.JWT_SECRET;
  const config=loadAuthConfig({JWT_SECRET:randomBytes(48).toString('base64url'),FRONTEND_URL:'http://localhost:5173',AUTH_COOKIE_SAME_SITE:'lax',NODE_ENV:'test',AUTH_RATE_LIMIT_MAX:'1000'});
  let db,pool,server,root,companyId,admin,collector,outsider,seed=0,beforeFinance;
  before(async()=>{
    db=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,password:process.env.DB_PASSWORD,multipleStatements:true});
    await db.query(`CREATE DATABASE \`${schema}\``);await db.query(`USE \`${schema}\``);
    const initial=await readFile(new URL('../../database/migrations/001_initial_schema.sql',import.meta.url),'utf8');
    const tables=new Set(['companies','roles','users','user_roles','customers','invoices','payments','payment_allocations','collection_actions','payment_promises','message_templates','messages','settings','audit_logs','import_batches']);
    for(const match of initial.matchAll(/CREATE TABLE (\w+) \([\s\S]*?;/g))if(tables.has(match[1]))await db.query(match[0]);
    await db.query(await readFile(new URL('../../database/migrations/002_payment_allocations_soft_delete.sql',import.meta.url),'utf8'));
    await db.query(await readFile(new URL('../../database/migrations/003_active_payment_invoice_allocation_unique.sql',import.meta.url),'utf8'));
    await applyAuthMigrations(db);await applyWhatsAppMigration(db);assert.equal((await applyCollectionResultsMigration(db)).applied,true);assert.equal((await applyCollectionResultsMigration(db)).applied,false);
    await db.query(await readFile(new URL('../../database/migrations/008_mertel_customer_resolution.sql',import.meta.url),'utf8'));
    const [company]=await db.query("INSERT INTO companies(name) VALUES ('MERTEL IMPORTACIONES')");companyId=String(company.insertId);
    const rules=await readFile(new URL('../config/mertel-collection-rules.json',import.meta.url),'utf8');await db.query("INSERT INTO settings(company_id,setting_key,setting_value,value_type) VALUES (?,'collection_rules',?,'json')",[companyId,rules]);
    await db.query("INSERT INTO roles(name) VALUES ('admin'),('collector')");process.env.DB_NAME=schema;process.env.JWT_SECRET=config.jwtSecret;
    ({default:pool}=await import('../src/config/database.js'));
    const {issueAccessToken}=await import('../src/services/auth.service.js');
    async function actor(role){const [user]=await db.query("INSERT INTO users(company_id,first_name,email,password_hash) VALUES (?,'Fixture',?,'unusable')",[companyId,`${randomUUID()}@example.test`]);if(role)await db.query('INSERT INTO user_roles(user_id,role_id) SELECT ?,id FROM roles WHERE name=?',[user.insertId,role]);return{id:String(user.insertId),token:issueAccessToken(String(user.insertId),config)};}
    admin=await actor('admin');collector=await actor('collector');outsider=await actor(null);
    const {createApp}=await import('../src/app.js');server=await new Promise(resolve=>{const listener=createApp(config).listen(0,'127.0.0.1',()=>resolve(listener));});root=`http://127.0.0.1:${server.address().port}/api`;
  });
  after(async()=>{
    if(server)await new Promise(resolve=>server.close(resolve));if(pool)await pool.end();
    if(db){assert.match(schema,/^mertel_admin_test_[a-f0-9]{32}$/);assert.notEqual(schema,original);await db.query(`DROP DATABASE IF EXISTS \`${schema}\``);await db.end();}
    if(original===undefined)delete process.env.DB_NAME;else process.env.DB_NAME=original;
    if(previousSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=previousSecret;
  });
  async function snapshot(){const result={};for(const table of ['invoices','payments','payment_allocations'])result[table]=(await db.query(`SELECT * FROM ${table} ORDER BY id`))[0];return result;}
  beforeEach(async()=>{beforeFinance=await snapshot();});
  afterEach(async()=>{
    const after=await snapshot();
    for(const old of beforeFinance.invoices){const current=after.invoices.find(row=>row.id===old.id);for(const field of ['document_value','base_value','iva_value'])assert.equal(current[field],old[field]);}
    for(const old of beforeFinance.payments)assert.deepEqual(after.payments.find(row=>row.id===old.id),old);
    for(const old of beforeFinance.payment_allocations)assert.deepEqual(after.payment_allocations.find(row=>row.id===old.id),old);
    const [invalid]=await db.query(`SELECT p.id FROM payments p LEFT JOIN payment_allocations a ON a.payment_id=p.id AND a.deleted_at IS NULL GROUP BY p.id,p.amount HAVING COALESCE(SUM(a.amount),0)>p.amount`);assert.deepEqual(invalid,[]);
    const [balances]=await db.query(`SELECT i.id,i.balance,i.document_value,COALESCE(SUM(a.amount),0) AS allocated FROM invoices i LEFT JOIN payment_allocations a ON a.invoice_id=i.id AND a.deleted_at IS NULL GROUP BY i.id,i.balance,i.document_value`);
    for(const row of balances){assert.equal(Number(row.balance)+Number(row.allocated),Number(row.document_value));assert.ok(Number(row.balance)>=0);}
  });
  async function client(amounts=['119.00']){seed++;const [customer]=await db.query("INSERT INTO customers(company_id,nit,name,phone) VALUES (?,?,?,'3000000001')",[companyId,String(90000000+seed),`Cliente resultados ${seed}`]);const invoices=[];for(let n=0;n<amounts.length;n++){const [invoice]=await db.query("INSERT INTO invoices(company_id,customer_id,invoice_number,issue_date,due_date,document_value,base_value,iva_value,balance) VALUES (?,?,?,'2020-01-01',?,?,?,?,?)",[companyId,customer.insertId,`RESULT-${seed}-${n+1}`,n===0?'2020-02-01':'2026-10-12',amounts[n],amounts[n],'0.00',amounts[n]]);invoices.push(String(invoice.insertId));}return{id:String(customer.insertId),invoices,amounts};}
  async function request(method,path,body,actor=collector){const response=await fetch(root+path,{method,headers:{'Content-Type':'application/json',...(actor?{Authorization:`Bearer ${actor.token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:response.status,body:await response.json()};}
  const scope=actor=>({companyId,companyName:'MERTEL IMPORTACIONES',actorId:(actor||admin).id});
  test('authorization and immutable MERTEL scope',async()=>{
    assert.equal((await request('GET','/admin/dashboard',undefined,admin)).status,200);
    assert.equal((await request('GET','/admin/dashboard',undefined,collector)).status,403);
    assert.equal((await request('GET','/admin/dashboard',undefined,null)).status,401);
    assert.equal((await request('GET','/admin/dashboard?company_id=99999',undefined,admin)).status,403);
  });
  test('live portfolio stages, priority, current pending reports/promises and immutable financial rows',async()=>{
    const {getAdminDashboard}=await import('../src/services/adminDashboard.service.js');
    const now=new Date('2026-10-07T15:00:00Z');const item=await client(['100.00','50.00']);
    await db.query("INSERT INTO payment_promises(company_id,customer_id,invoice_id,promised_date,promised_amount) VALUES (?,?,?,'2026-10-06',20),(?,?,?,'2026-10-09',30)",[companyId,item.id,item.invoices[0],companyId,item.id,item.invoices[1]]);
    await db.query("INSERT INTO collection_actions(company_id,customer_id,invoice_id,action_type,status,reported_amount,action_date) VALUES (?,?,?,'PAYMENT_REPORTED','PENDING_REVIEW',40,'2026-10-07 12:00:00')",[companyId,item.id,item.invoices[0]]);
    const previous=await snapshot();
    const result=await getAdminDashboard({scope:scope(),now});
    for(const key of ['summary','collection','recovery','resolution','promises','whatsapp','recent_activity','top_customers','priority_customers'])assert.equal(result[key].status,'ok',key);
    assert.equal(result.summary.data.total_balance,'150.00');assert.equal(result.summary.data.stages.find(s=>s.key==='overdue').balance,'100.00');assert.equal(result.summary.data.stages.find(s=>s.key==='five_days_before_due').balance,'50.00');
    assert.equal(result.reported_payments.data.amount,'40.00');assert.equal(Number(result.promises.data.overdue),1);assert.equal(Number(result.promises.data.active),1);assert.equal(Number(result.promises.data.upcoming),1);
    assert.equal(result.top_customers.data[0].id,item.id);assert.equal(result.priority_customers.data[0].id,item.id);
    const week=await getAdminDashboard({scope:scope(),now,query:{period:'7'}});assert.deepEqual(week.summary,result.summary);assert.deepEqual(week.promises,result.promises);
    assert.deepEqual(await snapshot(),previous);
  });
  test('period payments and allocations, audit actor, MOCK and absence of secrets',async()=>{
    const {getAdminDashboard}=await import('../src/services/adminDashboard.service.js');const item=await client(['80.00']);
    await db.query("INSERT INTO payments(company_id,customer_id,payment_date,amount,created_at) VALUES (?,?,'2026-10-01',25,'2026-10-07 04:59:59'),(?,?,'2026-10-01',40,'2026-10-07 05:00:00')",[companyId,item.id,companyId,item.id]);
    const [[p]]=await db.query('SELECT MAX(id) id FROM payments');await db.query("INSERT INTO payment_allocations(payment_id,invoice_id,amount,created_at) VALUES (?,?,10,'2026-10-07 05:00:00')",[p.id,item.invoices[0]]);await db.query('UPDATE invoices SET balance=balance-10 WHERE id=?',[item.invoices[0]]);
    await db.query("INSERT INTO audit_logs(company_id,entity_type,entity_id,action,new_values,created_at) VALUES (?,'invoice',?,'invoice_settled',?,'2026-10-07 10:00:00')",[companyId,item.invoices[0],JSON.stringify({actor_type:'SYSTEM',customer_id:item.id,amount:'10.00'})]);
    await db.query("INSERT INTO settings(company_id,setting_key,setting_value,value_type) VALUES (?,'whatsapp_center',?,'json')",[companyId,JSON.stringify({provider:'MOCK',connection_status:'CONNECTED',encrypted_credentials:'DO_NOT_EXPOSE',credentials:'DO_NOT_EXPOSE'})]);
    const previous=await snapshot();const now=new Date('2026-10-07T15:00:00Z');const today=await getAdminDashboard({scope:scope(),now});const week=await getAdminDashboard({scope:scope(),now,query:{period:'7'}});
    assert.equal(today.recovery.data.payments_count,1);assert.equal(today.recovery.data.payments_amount,'40.00');assert.equal(week.recovery.data.payments_amount,'65.00');assert.equal(today.recovery.data.allocations_amount,'10.00');assert.equal(today.recovery.data.settled_invoices,1);
    assert.equal(today.recent_activity.data[0].actor,'Sistema');assert.equal(today.whatsapp.data.connection_status,'CONNECTED');assert.ok(!JSON.stringify(today).includes('DO_NOT_EXPOSE'));assert.deepEqual(today.summary,week.summary);assert.deepEqual(await snapshot(),previous);
  });
  test('real section SQL failure does not expose SQL or zero financial substitutes',async()=>{
    const {getAdminDashboard}=await import('../src/services/adminDashboard.service.js');await db.query('RENAME TABLE messages TO hidden_admin_messages');
    try { const result=await getAdminDashboard({scope:scope(),now:new Date('2026-10-07T15:00:00Z')});assert.equal(result.whatsapp.status,'error');assert.equal(result.recovery.status,'ok');assert.equal(result.summary.status,'ok');assert.ok(!JSON.stringify(result).includes('hidden_admin_messages')); }
    finally {await db.query('RENAME TABLE hidden_admin_messages TO messages');}
  });
});