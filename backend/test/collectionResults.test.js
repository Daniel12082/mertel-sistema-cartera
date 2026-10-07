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

describe('Management results → existing financial ledger / isolated MySQL', {skip:!(process.env.DB_HOST&&process.env.DB_USER)},()=>{
  const schema=`mertel_results_test_${randomUUID().replaceAll('-','')}`;const original=process.env.DB_NAME;const previousSecret=process.env.JWT_SECRET;
  const config=loadAuthConfig({JWT_SECRET:randomBytes(48).toString('base64url'),FRONTEND_URL:'http://localhost:5173',AUTH_COOKIE_SAME_SITE:'lax',NODE_ENV:'test',AUTH_RATE_LIMIT_MAX:'1000'});
  let db,pool,server,root,companyId,admin,collector,outsider,services,wa,seed=0,beforeFinance;
  before(async()=>{
    db=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,password:process.env.DB_PASSWORD,multipleStatements:true});
    await db.query(`CREATE DATABASE \`${schema}\``);await db.query(`USE \`${schema}\``);
    const initial=await readFile(new URL('../../database/migrations/001_initial_schema.sql',import.meta.url),'utf8');
    const tables=new Set(['companies','roles','users','user_roles','customers','invoices','payments','payment_allocations','collection_actions','payment_promises','message_templates','messages','settings','audit_logs']);
    for(const match of initial.matchAll(/CREATE TABLE (\w+) \([\s\S]*?;/g))if(tables.has(match[1]))await db.query(match[0]);
    await db.query(await readFile(new URL('../../database/migrations/002_payment_allocations_soft_delete.sql',import.meta.url),'utf8'));
    await db.query(await readFile(new URL('../../database/migrations/003_active_payment_invoice_allocation_unique.sql',import.meta.url),'utf8'));
    await applyAuthMigrations(db);await applyWhatsAppMigration(db);assert.equal((await applyCollectionResultsMigration(db)).applied,true);assert.equal((await applyCollectionResultsMigration(db)).applied,false);
    const [company]=await db.query("INSERT INTO companies(name) VALUES ('MERTEL IMPORTACIONES')");companyId=String(company.insertId);
    const rules=await readFile(new URL('../config/mertel-collection-rules.json',import.meta.url),'utf8');await db.query("INSERT INTO settings(company_id,setting_key,setting_value,value_type) VALUES (?,'collection_rules',?,'json')",[companyId,rules]);
    await db.query("INSERT INTO roles(name) VALUES ('admin'),('collector')");process.env.DB_NAME=schema;process.env.JWT_SECRET=config.jwtSecret;
    ({default:pool}=await import('../src/config/database.js'));services=await import('../src/services/collectionResults.service.js');wa=await import('../src/services/whatsappCenter.service.js');
    const {issueAccessToken}=await import('../src/services/auth.service.js');
    async function actor(role){const [user]=await db.query("INSERT INTO users(company_id,first_name,email,password_hash) VALUES (?,'Fixture',?,'unusable')",[companyId,`${randomUUID()}@example.test`]);if(role)await db.query('INSERT INTO user_roles(user_id,role_id) SELECT ?,id FROM roles WHERE name=?',[user.insertId,role]);return{id:String(user.insertId),token:issueAccessToken(String(user.insertId),config)};}
    admin=await actor('admin');collector=await actor('collector');outsider=await actor(null);
    const {createApp}=await import('../src/app.js');server=await new Promise(resolve=>{const listener=createApp(config).listen(0,'127.0.0.1',()=>resolve(listener));});root=`http://127.0.0.1:${server.address().port}/api`;
  });
  after(async()=>{
    if(server)await new Promise(resolve=>server.close(resolve));if(pool)await pool.end();
    if(db){assert.match(schema,/^mertel_results_test_[a-f0-9]{32}$/);assert.notEqual(schema,original);await db.query(`DROP DATABASE IF EXISTS \`${schema}\``);await db.end();}
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
  const path=id=>`/collection/results/customers/${id}`;
  const paymentBody=(client,extra={})=>({amount:client.amounts[0],payment_date:'2026-10-07',payment_kind:'TOTAL',allocations:[{invoice_id:client.invoices[0],amount:client.amounts[0]}],idempotency_key:randomUUID(),reference_date:'2026-10-07',...extra});
  async function prepared(client,body=paymentBody(client),actor=collector){const preview=await request('POST',`${path(client.id)}/payment-preview`,body,actor);assert.equal(preview.status,200,JSON.stringify(preview));return{...body,confirmation_token:preview.body.data.confirmation_token};}
  async function paid(client,body=paymentBody(client)){const preparedBody=await prepared(client,body);const response=await request('POST',`${path(client.id)}/payments`,preparedBody);assert.equal(response.status,200,JSON.stringify(response));return{response,body:preparedBody};}
  const scope=actor=>({companyId,companyName:'MERTEL IMPORTACIONES',actorId:(actor||admin).id});
  test('full payment is atomic, zero balance leaves the engine pipeline and automatic queue stops',async()=>{
    const item=await client();
    await wa.updateWhatsAppSettings({scope:scope(),actorId:admin.id,body:{provider:'MOCK',global_daily_limit:100,customer_daily_limit:10}});
    await wa.testWhatsAppConnection({scope:scope(),actorId:admin.id});
    const [template]=await db.query("INSERT INTO message_templates(company_id,name,channel,content,stage,status) VALUES (?,'DEMO','whatsapp','{{saldo}}','overdue','active')",[companyId]);
    await wa.saveWhatsAppRule({scope:scope(),actorId:admin.id,stage:'overdue',body:{stage:'overdue',enabled:true,template_id:String(template.insertId),mode:'AUTOMATICO',start_time:'00:00',end_time:'23:59',weekdays:[1,2,3,4,5,6,7],daily_limit:100,interval_hours:1}});
    await wa.updateWhatsAppSettings({scope:scope(),actorId:admin.id,body:{automations_enabled:true}});
    const queued=await wa.enqueueWhatsApp({scope:scope(),actorId:admin.id,body:{customer_id:item.id,mode:'AUTOMATICO'},now:new Date('2026-10-07T15:00:00Z')});
    const {response,body}=await paid(item);assert.equal(response.body.data.payment.amount,'119.00');assert.equal(response.body.data.allocations[0].amount,'119.00');assert.equal(response.body.data.total_balance,'0.00');assert.equal(response.body.data.collection_item,null);
    const [[invoice]]=await db.query('SELECT balance FROM invoices WHERE id=?',[item.invoices[0]]);assert.equal(invoice.balance,'0.00');
    const [[message]]=await db.query('SELECT status FROM messages WHERE customer_id=?',[item.id]);assert.equal(message.status,'CANCELLED');
    await assert.rejects(wa.enqueueWhatsApp({scope:scope(),body:{customer_id:item.id,mode:'AUTOMATICO'}}),/no identifica/);
    await assert.rejects(wa.mockSendWhatsApp({scope:scope(),messageId:queued.message.id}),/no puede procesarse/);
    const duplicate=await request('POST',`${path(item.id)}/payments`,body);assert.equal(duplicate.body.data.duplicate,true);assert.equal(duplicate.body.data.payment.id,response.body.data.payment.id);
    const unchanged=await snapshot();assert.equal((await request('POST',`${path(item.id)}/payment-preview`,paymentBody(item))).status,409);assert.deepEqual(await snapshot(),unchanged);
  });
  test('customer remains with other invoices and engine chooses the next stage',async()=>{
    const item=await client(['100.00','50.00']);const {response}=await paid(item);assert.equal(response.body.data.total_balance,'50.00');assert.equal(response.body.data.collection_item.stage,'five_days_before_due');assert.equal(String(response.body.data.collection_item.main_invoice.invoice.invoice_id),item.invoices[1]);
  });
  test('partial payment changes only balance and remains eligible with fresh WhatsApp preview',async()=>{
    const item=await client(['3482310.00']);const {response}=await paid(item,paymentBody(item,{amount:'1500000.00',payment_kind:'PARTIAL',allocations:[{invoice_id:item.invoices[0],amount:'1500000.00'}]}));
    assert.equal(response.body.data.total_balance,'1982310.00');assert.equal(response.body.data.collection_item.stage,'overdue');
    const [template]=await db.query("INSERT INTO message_templates(company_id,name,channel,content,stage,status) VALUES (?,'DEMO','whatsapp','{{saldo}}','overdue','active')",[companyId]);
    const preview=await request('POST','/admin/whatsapp/preview',{customer_id:item.id,template_id:String(template.insertId)},admin);assert.equal(preview.status,200);assert.match(preview.body.data.content,/1[.,]982[.,]310/);
    const immediate=new Date('2026-10-07T15:00:00.900Z');
    const queued=await wa.enqueueWhatsApp({scope:scope(),actorId:admin.id,body:{customer_id:item.id,mode:'AUTOMATICO'},now:immediate});assert.equal(queued.message.status,'PENDING');assert.match(queued.message.content,/1[.,]982[.,]310/);
    assert.ok(new Date(queued.message.scheduled_at)<=immediate);
    const sent=await wa.mockSendWhatsApp({scope:scope(),actorId:admin.id,messageId:queued.message.id,now:immediate});assert.equal(sent.message.status,'SENT');
  });
  test('manual multiple invoices and unapplied credit respect existing allocation semantics',async()=>{
    const item=await client(['100.00','50.00']);const {response}=await paid(item,paymentBody(item,{amount:'120.00',payment_kind:'MULTIPLE',allocations:[{invoice_id:item.invoices[0],amount:'80.00'},{invoice_id:item.invoices[1],amount:'30.00'}]}));
    assert.equal(response.body.data.total_balance,'40.00');assert.equal(response.body.data.payment.available_amount,'10.00');assert.equal(response.body.data.allocations.length,2);
  });
  test('invalid amounts, invoice ownership, duplicate allocation and new_balance are rejected without ledger writes',async()=>{
    const item=await client();const other=await client();const body=paymentBody(item);
    const invalid=[{amount:'-1'},{amount:'0'},{amount:'1.001'},{new_balance:'0'}, {allocations:[{invoice_id:other.invoices[0],amount:'119'}]},
      {allocations:[{invoice_id:'9999999',amount:'119'}]},{allocations:[{invoice_id:'xlsx:row:8',amount:'119'}]},{amount:'200',allocations:[{invoice_id:item.invoices[0],amount:'200'}]},
      {payment_kind:'MULTIPLE',allocations:[{invoice_id:item.invoices[0],amount:'50'},{invoice_id:item.invoices[0],amount:'50'}]}];
    const before=await snapshot();for(const extra of invalid){const result=await request('POST',`${path(item.id)}/payment-preview`,{...body,...extra});assert.ok([400,404,409].includes(result.status),JSON.stringify(result));assert.deepEqual(await snapshot(),before);}
    assert.equal((await request('GET',`${path('9999999')}/context`)).status,404);
    await db.query("UPDATE invoices SET status='cancelled' WHERE id=?",[item.invoices[0]]);
    const inactiveBefore=await snapshot();assert.equal((await request('POST',`${path(item.id)}/payment-preview`,body)).status,409);assert.deepEqual(await snapshot(),inactiveBefore);
  });
  test('concurrent same request produces exactly one payment and one allocation',async()=>{
    const item=await client();const body=await prepared(item);const responses=await Promise.all(Array.from({length:5},()=>request('POST',`${path(item.id)}/payments`,body)));
    for(const response of responses)assert.equal(response.status,200,JSON.stringify(response));assert.equal(responses.filter(row=>!row.body.data.duplicate).length,1);
    const [[counts]]=await db.query('SELECT COUNT(*) AS total FROM payments WHERE customer_id=?',[item.id]);assert.equal(counts.total,1);
  });
  test('competing distinct operations and stale signed summaries cannot overpay',async()=>{
    const item=await client(['100.00']);const first=await prepared(item,paymentBody(item,{amount:'60',payment_kind:'PARTIAL',allocations:[{invoice_id:item.invoices[0],amount:'60'}]}));
    const second=await prepared(item,paymentBody(item,{amount:'60',payment_kind:'PARTIAL',allocations:[{invoice_id:item.invoices[0],amount:'60'}]}));
    const results=await Promise.all([request('POST',`${path(item.id)}/payments`,first),request('POST',`${path(item.id)}/payments`,second)]);assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);
    const [[invoice]]=await db.query('SELECT balance FROM invoices WHERE id=?',[item.invoices[0]]);assert.equal(invoice.balance,'40.00');
  });
  test('signed confirmation cannot be altered, replayed by another actor or skipped',async()=>{
    const item=await client();const body=await prepared(item);const before=await snapshot();
    for(const candidate of [{...body,confirmation_token:'bad'},{...body,amount:'1'},{...body,confirmation_token:undefined}])assert.equal((await request('POST',`${path(item.id)}/payments`,candidate)).status,409);
    assert.equal((await request('POST',`${path(item.id)}/payments`,body,admin)).status,409);assert.deepEqual(await snapshot(),before);
  });
  test('reporting is idempotent, visible in history and does not modify any financial table',async()=>{
    const item=await client();const body={result:'PAYMENT_REPORTED',invoice_id:item.invoices[0],reported_amount:'119',reported_payment_date:'2026-10-07',description:'Cliente informa pago, soporte pendiente',idempotency_key:randomUUID()};
    const before=await snapshot();const responses=await Promise.all([request('POST',`${path(item.id)}/result`,body),request('POST',`${path(item.id)}/result`,body)]);
    for(const result of responses)assert.equal(result.status,200,JSON.stringify(result));assert.equal(responses[0].body.data.id,responses[1].body.data.id);assert.deepEqual(await snapshot(),before);
    const reports=await request('GET',`${path(item.id)}/reports`);assert.equal(reports.body.data.reports[0].status,'PENDING_REVIEW');
    const history=await request('GET',`/collection/customers/${item.id}/history`);assert.ok(history.body.data.events.some(event=>event.title==='Pago reportado'));
  });
  test('administrator confirms a report through the same financial transaction and collector sees trace',async()=>{
    const item=await client();const reported=await request('POST',`${path(item.id)}/result`,{result:'PAYMENT_REPORTED',invoice_id:item.invoices[0],reported_amount:'119',reported_payment_date:'2026-10-07',description:'Soporte recibido',idempotency_key:randomUUID()});
    const id=reported.body.data.id;const body=paymentBody(item);const preview=await request('POST',`/collection/results/reports/${id}/payment-preview`,body,admin);assert.equal(preview.status,200);
    const confirmation={decision:'CONFIRMED',payment:{...body,confirmation_token:preview.body.data.confirmation_token}};
    assert.equal((await request('POST',`/collection/results/reports/${id}/review`,confirmation)).status,403);
    const result=await request('POST',`/collection/results/reports/${id}/review`,confirmation,admin);assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.body.data.total_balance,'0.00');assert.equal(result.body.data.report.status,'CONFIRMED');
    assert.equal((await request('POST',`/collection/results/reports/${id}/review`,confirmation,admin)).body.data.duplicate,true);
    const history=await request('GET',`/collection/customers/${item.id}/history`);assert.ok(history.body.data.events.some(event=>event.title==='Pago confirmado'));assert.ok(history.body.data.events.some(event=>event.title==='Pago registrado'));
  });
  test('reject requires a reason, retains ledger and prevents later confirmation',async()=>{
    const item=await client();const report=await request('POST',`${path(item.id)}/result`,{result:'PAYMENT_REPORTED',invoice_id:item.invoices[0],reported_amount:'119',reported_payment_date:'2026-10-07',description:'Por verificar',idempotency_key:randomUUID()});const id=report.body.data.id;const before=await snapshot();
    assert.equal((await request('POST',`/collection/results/reports/${id}/review`,{decision:'REJECTED',reason:''},admin)).status,400);
    const rejected=await request('POST',`/collection/results/reports/${id}/review`,{decision:'REJECTED',reason:'No corresponde al cliente'},admin);assert.equal(rejected.status,200);assert.equal(rejected.body.data.report.status,'REJECTED');assert.deepEqual(await snapshot(),before);
    assert.equal((await request('POST',`/collection/results/reports/${id}/review`,{decision:'CONFIRMED'},admin)).status,409);
  });
  test('manual outcomes and promises reuse existing records, remain audited and do not alter balances',async()=>{
    const item=await client();const before=await snapshot();
    for(const result of ['CONTACTED','WHATSAPP','NO_RESPONSE','INCONSISTENCY','WRONG_NUMBER','OTHER','PROMISE']){const response=await request('POST',`${path(item.id)}/result`,{result,invoice_id:item.invoices[0],description:'Resultado de fixture',idempotency_key:randomUUID(),...(result==='PROMISE'?{promised_date:'2026-10-10',promised_amount:'119'}:{})});assert.equal(response.status,200,JSON.stringify(response));}
    assert.deepEqual(await snapshot(),before);const [[promises]]=await db.query("SELECT COUNT(*) AS total FROM payment_promises WHERE customer_id=? AND status='pending'",[item.id]);assert.equal(promises.total,1);
    await paid(item);const [[promise]]=await db.query('SELECT status,fulfilled_at FROM payment_promises WHERE customer_id=?',[item.id]);assert.equal(promise.status,'fulfilled');assert.ok(promise.fulfilled_at);
  });
  test('payment and allocations roll back completely if downstream audit fails',async()=>{
    const item=await client();const body=await prepared(item);const before=await snapshot();
    await db.query("CREATE TRIGGER fixture_fail_result_audit BEFORE INSERT ON audit_logs FOR EACH ROW BEGIN IF NEW.action='payment_registered' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='fixture'; END IF; END");
    try{const result=await request('POST',`${path(item.id)}/payments`,body);assert.equal(result.status,500);assert.deepEqual(await snapshot(),before);const [[audits]]=await db.query("SELECT COUNT(*) AS total FROM audit_logs WHERE JSON_UNQUOTE(JSON_EXTRACT(new_values,'$.customer_id'))=?",[item.id]);assert.equal(audits.total,0);}finally{await db.query('DROP TRIGGER fixture_fail_result_audit');}
  });
  test('permission boundaries and independent report/financial decisions',async()=>{
    const item=await client();const body=paymentBody(item);const before=await snapshot();
    assert.equal((await request('POST',`${path(item.id)}/payment-preview`,body,outsider)).status,403);assert.equal((await request('GET',`${path(item.id)}/context`,undefined,null)).status,401);
    assert.equal((await request('GET','/collection/results/reports')).status,403);
    assert.equal((await request('POST',`${path(item.id)}/result`,{result:'PAID',description:'Ya pagó',idempotency_key:randomUUID()})).status,400);assert.deepEqual(await snapshot(),before);
  });
  test('signed imported pipeline refresh uses persistent balances and identifies missing financial documents',async()=>{
    const item=await client(['100.00']);const [[customer]]=await db.query('SELECT name,nit FROM customers WHERE id=?',[item.id]);
    const {buildPortfolioPipeline}=await import('../src/services/portfolioPipeline.service.js');
    const row={row_number:8,type:'DOCUMENT',movement_type:'invoice',movement:'FV',customer_nit_original:customer.nit,customer_nit_normalized:customer.nit,
      document_number:`RESULT-${seed}-1`,issue_date:'2020-01-01',due_date:'2020-02-01',document_value:100,iva:0,values:{'Nombre cliente':customer.name,'+90 días':'100','Telefono':'3000000001'}};
    const rules=JSON.parse(await readFile(new URL('../config/mertel-collection-rules.json',import.meta.url),'utf8'));
    const imported=buildPortfolioPipeline({parsed:{documents:[row],issues:[]},referenceDate:'2026-10-07',companyId,rules,fileName:'DEMO.xlsx',sourceHash:'a'.repeat(64),secret:process.env.JWT_SECRET,resolutionByNit:new Map([[customer.nit,item.id]])});
    const body={reference_date:'2026-10-07',customers:[{customer_id:item.id,context_token:imported.pipeline[0].source_context}]};
    const first=await request('POST','/collection/results/pipeline/refresh',body);assert.equal(first.status,200,JSON.stringify(first));assert.equal(first.body.data.customers[0].financial_source_ready,true);assert.equal(first.body.data.customers[0].collection_item.total_balance,'100.00');
    await paid(item);const refreshed=await request('POST','/collection/results/pipeline/refresh',body);assert.equal(refreshed.body.data.customers[0].collection_item,null);assert.equal(refreshed.body.data.customers[0].total_balance,'0.00');
    assert.equal((await request('POST','/collection/results/pipeline/refresh',{...body,customers:[{customer_id:item.id,context_token:body.customers[0].context_token+'x'}]})).status,403);
    const missing=buildPortfolioPipeline({parsed:{documents:[{...row,document_number:'NOT-IN-LEDGER'}],issues:[]},referenceDate:'2026-10-07',companyId,rules,fileName:'DEMO.xlsx',sourceHash:'b'.repeat(64),secret:process.env.JWT_SECRET,resolutionByNit:new Map([[customer.nit,item.id]])});
    const context=await request('GET',`${path(item.id)}/context?context_token=${encodeURIComponent(missing.pipeline[0].source_context)}`);assert.equal(context.body.data.financial_source_ready,false);assert.deepEqual(context.body.data.source_documents_pending,['NOT-IN-LEDGER']);
  });
  test('audit reconstructs reported-payment settlement end to end with USER and SYSTEM actors',async()=>{
    const item=await client();
    await request('POST',`${path(item.id)}/result`,{result:'CONTACTED',invoice_id:item.invoices[0],description:'Contacto previo al reporte',idempotency_key:randomUUID()});
    const reported=await request('POST',`${path(item.id)}/result`,{result:'PAYMENT_REPORTED',invoice_id:item.invoices[0],reported_amount:'119',reported_payment_date:'2026-10-07',description:'Soporte por conciliar',idempotency_key:randomUUID()});
    const reportId=reported.body.data.id,payment=paymentBody(item);
    const preview=await request('POST',`/collection/results/reports/${reportId}/payment-preview`,payment,admin);
    const confirmation={decision:'CONFIRMED',payment:{...payment,confirmation_token:preview.body.data.confirmation_token}};
    const result=await request('POST',`/collection/results/reports/${reportId}/review`,confirmation,admin);assert.equal(result.status,200,JSON.stringify(result));
    const [rows]=await db.query("SELECT id,user_id,entity_type,entity_id,action,new_values FROM audit_logs WHERE company_id=? AND JSON_UNQUOTE(JSON_EXTRACT(new_values,'$.correlation_id'))=? ORDER BY id",[companyId,`report:${reportId}`]);
    const events=rows.map(row=>({...row,value:typeof row.new_values==='string'?JSON.parse(row.new_values):row.new_values}));
    const [[management]]=await db.query("SELECT id,user_id,new_values FROM audit_logs WHERE company_id=? AND action='result_registered' AND JSON_UNQUOTE(JSON_EXTRACT(new_values,'$.customer_id'))=? AND JSON_UNQUOTE(JSON_EXTRACT(new_values,'$.result'))='CONTACTED' ORDER BY id LIMIT 1",[companyId,item.id]);
    assert.ok(management);assert.equal(String(management.user_id),collector.id);assert.ok(BigInt(management.id)<BigInt(events[0].id));
    const expected=['result_registered','confirmation_accepted','payment_registered','report_reviewed','allocation_created','balance_updated','invoice_settled','pipeline_recalculated','pipeline_exited','automatic_collection_blocked'];
    for(const name of expected)assert.ok(events.some(event=>event.action===name),`Missing audit event ${name}`);
    const index=name=>events.findIndex(event=>event.action===name);
    assert.ok(index('result_registered')<index('confirmation_accepted'));assert.ok(index('confirmation_accepted')<index('payment_registered'));
    for(const [before,after] of [['payment_registered','allocation_created'],['allocation_created','balance_updated'],['balance_updated','invoice_settled'],['invoice_settled','pipeline_recalculated'],['pipeline_recalculated','pipeline_exited'],['pipeline_exited','automatic_collection_blocked']])assert.ok(index(before)<index(after));
    for(const event of events.filter(event=>['balance_updated','invoice_settled','pipeline_recalculated','pipeline_exited','automatic_collection_blocked'].includes(event.action))){assert.equal(event.user_id,null);assert.equal(event.value.actor_type,'SYSTEM');assert.equal(event.value.triggered_by,admin.id);}
    for(const event of events.filter(event=>['confirmation_accepted','payment_registered','allocation_created'].includes(event.action))){assert.equal(String(event.user_id),admin.id);assert.equal(event.value.actor_type,'USER');}
    const balance=events.find(event=>event.action==='balance_updated');assert.equal(balance.value.old_balance,'119.00');assert.equal(balance.value.new_balance,'0.00');assert.equal(balance.value.payment_id,String(result.body.data.payment.id));
    const [[allocation]]=await db.query('SELECT id,payment_id,invoice_id,amount FROM payment_allocations WHERE payment_id=?',[result.body.data.payment.id]);assert.equal(balance.value.allocation_id,String(allocation.id));assert.equal(balance.value.invoice_id,String(allocation.invoice_id));assert.equal(allocation.amount,'119.00');
    const pipelineEvent=events.find(event=>event.action==='pipeline_recalculated');assert.equal(pipelineEvent.value.total_balance_before,'119.00');assert.equal(pipelineEvent.value.total_balance_after,'0.00');assert.equal(pipelineEvent.value.stage_before,'overdue');assert.equal(pipelineEvent.value.stage_after,null);
    const history=await request('GET',`/collection/customers/${item.id}/history?limit=100`);assert.equal(history.status,200);
    for(const title of ['Cliente contactado','Pago reportado','Pago confirmado','Pago registrado','Pago asignado a factura','Saldo actualizado','Factura saldada','Cobranza recalculada','Cliente fuera del pipeline','Cobranza automática bloqueada'])assert.ok(history.body.data.events.some(event=>event.title===title),title);
    assert.ok(history.body.data.events.some(event=>event.type==='financial'&&event.actor==='SYSTEM'&&event.metadata.correlation_id===`report:${reportId}`));
    const beforeDuplicate=events.length;await request('POST',`/collection/results/reports/${reportId}/review`,confirmation,admin);
    const [[count]]=await db.query("SELECT COUNT(*) AS total FROM audit_logs WHERE company_id=? AND JSON_UNQUOTE(JSON_EXTRACT(new_values,'$.correlation_id'))=?",[companyId,`report:${reportId}`]);assert.equal(count.total,beforeDuplicate);
  });
});
