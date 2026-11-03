import {before,after,test,describe} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import {applyAuthMigrations} from '../src/services/authMigrations.service.js';
import {loadAuthConfig} from '../src/config/auth.js';
import {DEFAULT_APPEARANCE} from '../src/config/appearance.js';
dotenv.config({path:new URL('../.env',import.meta.url),quiet:true});

describe('MERTEL appearance / isolated MySQL',{skip:!(process.env.DB_HOST&&process.env.DB_USER)},()=>{
  const schema='mertel_appearance_test_'+randomUUID().replaceAll('-',''),original=process.env.DB_NAME;
  const config=loadAuthConfig({JWT_SECRET:randomBytes(48).toString('base64url'),FRONTEND_URL:'http://localhost:5173',AUTH_COOKIE_SAME_SITE:'lax',NODE_ENV:'test',AUTH_RATE_LIMIT_MAX:'1000'});
  let validateAppearance,db,pool,server,url,admin,collector,foreign,financialBefore,otherSettings;
  before(async()=>{
    db=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,password:process.env.DB_PASSWORD,multipleStatements:true});
    await db.query(`CREATE DATABASE \`${schema}\``);await db.query(`USE \`${schema}\``);
    const initial=await readFile(new URL('../../database/migrations/001_initial_schema.sql',import.meta.url),'utf8');
    const tables=new Set(['companies','roles','users','user_roles','settings','audit_logs','customers','invoices','payments','payment_allocations']);
    for(const match of initial.matchAll(/CREATE TABLE (\w+) \([\s\S]*?;/g))if(tables.has(match[1]))await db.query(match[0]);await applyAuthMigrations(db);
    await db.query("INSERT INTO companies(id,name) VALUES (1,'MERTEL IMPORTACIONES'),(2,'OTHER FIXTURE');INSERT INTO roles(id,name) VALUES (1,'admin'),(2,'collector');INSERT INTO users(id,company_id,first_name,email,password_hash) VALUES (1,1,'Admin','admin@example.test','unusable'),(2,1,'Worker','worker@example.test','unusable'),(3,2,'Foreign','foreign@example.test','unusable');INSERT INTO user_roles VALUES (1,1),(2,2),(3,1)");
    await db.query("INSERT INTO customers(id,company_id,nit,name) VALUES (1,1,'900','Existing');INSERT INTO invoices(id,company_id,customer_id,invoice_number,issue_date,due_date,document_value,base_value,iva_value,balance) VALUES (1,1,1,'EXISTING',CURRENT_DATE(),CURRENT_DATE(),100,100,0,100);INSERT INTO settings(company_id,setting_key,setting_value,value_type) VALUES (1,'collection_rules','preserve','string'),(1,'whatsapp_center','PRIVATE_SECRET','string'),(2,'visual_appearance','foreign-value','string')");
    financialBefore=(await db.query('CHECKSUM TABLE invoices,payments,payment_allocations,customers,users,roles,user_roles'))[0];otherSettings=(await db.query("SELECT * FROM settings WHERE company_id<>1 OR setting_key<>'visual_appearance' ORDER BY id"))[0];
    // Load database-dependent modules only after choosing the disposable test schema.
    process.env.DB_NAME=schema;({validateAppearance}=await import('../src/services/appearance.service.js'));({default:pool}=await import('../src/config/database.js'));
    const {issueAccessToken}=await import('../src/services/auth.service.js');admin=issueAccessToken('1',config);collector=issueAccessToken('2',config);foreign=issueAccessToken('3',config);
    const {createApp}=await import('../src/app.js');server=await new Promise(resolve=>{const s=createApp(config).listen(0,'127.0.0.1',()=>resolve(s));});url=`http://127.0.0.1:${server.address().port}/api/appearance`;
  });
  after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));if(pool)await pool.end();if(db){assert.match(schema,/^mertel_appearance_test_[a-f0-9]{32}$/);assert.notEqual(schema,original);await db.query(`DROP DATABASE IF EXISTS \`${schema}\``);await db.end();}if(original===undefined)delete process.env.DB_NAME;else process.env.DB_NAME=original;});
  async function request(method,body,auth=admin,extra={}){const response=await fetch(url,{method,headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,body:await response.json()};}
test('appearance rejects executable content, invalid colours, low contrast, forged fields and oversized logos',()=>{
  for(const body of [{...DEFAULT_APPEARANCE,company_id:2},{...DEFAULT_APPEARANCE,name:'<script>alert(1)</script>'},{...DEFAULT_APPEARANCE,colors:{...DEFAULT_APPEARANCE.colors,primary:'url(javascript:1)'}},{...DEFAULT_APPEARANCE,colors:{...DEFAULT_APPEARANCE.colors,text:'#ffffff'}},{...DEFAULT_APPEARANCE,logo:'data:image/svg+xml;base64,PHN2Zz4='},{...DEFAULT_APPEARANCE,logo:'https://example.test/logo.png'},{...DEFAULT_APPEARANCE,logo:'data:image/png;base64,'+'A'.repeat(30000)}])assert.throws(()=>validateAppearance(body),error=>error.status===400);
  assert.deepEqual(validateAppearance(DEFAULT_APPEARANCE),DEFAULT_APPEARANCE);
});
  test('read defaults without inserting; branding read is safe for workers and never exposes other settings',async()=>{
    const response=await request('GET',undefined,collector);assert.equal(response.status,200);assert.deepEqual(response.body.data.appearance,DEFAULT_APPEARANCE);assert.ok(!JSON.stringify(response).includes('PRIVATE_SECRET'));assert.equal((await db.query("SELECT id FROM settings WHERE company_id=1 AND setting_key='visual_appearance'"))[0].length,0);
    assert.equal((await request('GET',undefined,null)).status,401);assert.equal((await request('GET',undefined,foreign)).status,403);
  });
  test('save and reload using one existing settings row; audit is atomic and finances untouched',async()=>{
    const appearance={...DEFAULT_APPEARANCE,name:'MERTEL · Cartera',colors:{...DEFAULT_APPEARANCE.colors,primary:'#166534'}};
    assert.equal((await request('PUT',appearance)).status,200);assert.deepEqual((await request('GET')).body.data.appearance,appearance);
    assert.equal((await request('PUT',appearance)).status,200);assert.equal((await db.query("SELECT id FROM settings WHERE company_id=1 AND setting_key='visual_appearance'"))[0].length,1);assert.equal((await db.query("SELECT id FROM audit_logs WHERE action='APPEARANCE_UPDATED'"))[0].length,1);
    assert.deepEqual((await db.query('CHECKSUM TABLE invoices,payments,payment_allocations,customers,users,roles,user_roles'))[0],financialBefore);assert.deepEqual((await db.query("SELECT * FROM settings WHERE company_id<>1 OR setting_key<>'visual_appearance' ORDER BY id"))[0],otherSettings);
  });
  test('permission, simulation and malformed image cannot modify settings',async()=>{
    const before=(await db.query('CHECKSUM TABLE settings'))[0];
    assert.equal((await request('PUT',DEFAULT_APPEARANCE,collector)).status,403);
    assert.equal((await request('PUT',DEFAULT_APPEARANCE,admin,{'X-Mertel-Simulation':'true'})).status,409);
    assert.equal((await request('PUT',{...DEFAULT_APPEARANCE,logo:'data:image/png;base64,YmFk'})).status,400);
    assert.deepEqual((await db.query('CHECKSUM TABLE settings'))[0],before);
  });
  test('raster logos persist, can be replaced and cleared; restoration only resets appearance',async()=>{
    const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';
    assert.equal((await request('PUT',{...DEFAULT_APPEARANCE,logo:png,compactLogo:png})).status,200);assert.equal((await request('GET')).body.data.appearance.logo,png);
    assert.equal((await request('PUT',{...DEFAULT_APPEARANCE,logo:png,compactLogo:null})).status,200);assert.equal((await request('GET')).body.data.appearance.compactLogo,null);
    assert.equal((await request('PUT',DEFAULT_APPEARANCE)).status,200);assert.deepEqual((await request('GET')).body.data.appearance,DEFAULT_APPEARANCE);
    assert.deepEqual((await db.query("SELECT * FROM settings WHERE company_id<>1 OR setting_key<>'visual_appearance' ORDER BY id"))[0],otherSettings);
    const [logs]=await db.query("SELECT new_values FROM audit_logs WHERE action='APPEARANCE_UPDATED'");assert.ok(logs.some(row=>JSON.stringify(row.new_values).includes('sha256')));assert.ok(!JSON.stringify(logs).includes('base64'));
  });
  test('audit failure rolls back the appearance document completely',async()=>{
    await db.query("CREATE TRIGGER appearance_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='TEST_FAILURE'");
    try{const response=await request('PUT',{...DEFAULT_APPEARANCE,name:'Should rollback'});assert.equal(response.status,500);assert.ok(!JSON.stringify(response).includes('TEST_FAILURE'));assert.deepEqual((await request('GET')).body.data.appearance,DEFAULT_APPEARANCE);}finally{await db.query('DROP TRIGGER appearance_audit_failure');}
  });
});
