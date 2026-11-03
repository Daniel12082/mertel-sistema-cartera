import {before,after,test,describe} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import {applyAuthMigrations} from '../src/services/authMigrations.service.js';
import {loadAuthConfig} from '../src/config/auth.js';
dotenv.config({path:new URL('../.env',import.meta.url),quiet:true});
describe('MERTEL user management / isolated MySQL',{skip:!(process.env.DB_HOST&&process.env.DB_USER)},()=>{
  const schema='mertel_users_test_'+randomUUID().replaceAll('-',''),original=process.env.DB_NAME;
  const config=loadAuthConfig({JWT_SECRET:randomBytes(48).toString('base64url'),FRONTEND_URL:'http://localhost:5173',AUTH_COOKIE_SAME_SITE:'lax',NODE_ENV:'test',AUTH_RATE_LIMIT_MAX:'1000'});
  let db,pool,server,url,token,collector,legacy,worker;
  const password=randomBytes(24).toString('base64url');
  const profile={first_name:'Trabajador',last_name:'Prueba',username:'worker.demo',email:'worker@example.test',phone:'3001111111',roles:['collector']};
  before(async()=>{
    db=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,password:process.env.DB_PASSWORD,multipleStatements:true});
    await db.query(`CREATE DATABASE \`${schema}\``);await db.query(`USE \`${schema}\``);
    const initial=await readFile(new URL('../../database/migrations/001_initial_schema.sql',import.meta.url),'utf8');
    const tables=new Set(['companies','roles','users','user_roles','settings','audit_logs','customers','invoices','payments','payment_allocations']);
    for(const match of initial.matchAll(/CREATE TABLE (\w+) \([\s\S]*?;/g))if(tables.has(match[1]))await db.query(match[0]);await applyAuthMigrations(db);
    await db.query("INSERT INTO companies(id,name) VALUES (1,'MERTEL IMPORTACIONES'),(2,'OTHER FIXTURE');INSERT INTO roles(id,name) VALUES (1,'admin'),(2,'collector'),(3,'supervisor')");
    await db.query("INSERT INTO users(id,company_id,first_name,email,password_hash) VALUES (1,1,'Admin','admin@example.test','unusable'),(2,1,'Collector','collector@example.test','unusable'),(3,NULL,'Legacy','legacy@example.test','unusable'),(4,2,'Foreign','foreign@example.test','unusable');INSERT INTO user_roles VALUES (1,1),(2,2),(3,1),(4,1)");
    process.env.DB_NAME=schema;({default:pool}=await import('../src/config/database.js'));const {issueAccessToken}=await import('../src/services/auth.service.js');token=issueAccessToken('1',config);collector=issueAccessToken('2',config);legacy=issueAccessToken('3',config);
    const {createApp}=await import('../src/app.js');server=await new Promise(resolve=>{const s=createApp(config).listen(0,'127.0.0.1',()=>resolve(s));});url=`http://127.0.0.1:${server.address().port}/api`;
  });
  after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));if(pool)await pool.end();if(db){assert.match(schema,/^mertel_users_test_[a-f0-9]{32}$/);assert.notEqual(schema,original);await db.query(`DROP DATABASE IF EXISTS \`${schema}\``);await db.end();}if(original===undefined)delete process.env.DB_NAME;else process.env.DB_NAME=original;});
  async function request(method,path,body,auth=token){const r=await fetch(url+path,{method,headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:await r.json()};}
  test('admin list is scoped, includes original admin, hides secrets and does not change financial tables',async()=>{
    const [before]=await db.query('CHECKSUM TABLE invoices,payments,payment_allocations,customers');const result=await request('GET','/admin/users');assert.equal(result.status,200);assert.deepEqual(result.body.data.users.map(u=>u.id),['1','2','3']);assert.equal(result.body.data.roles.length,3);assert.ok(!JSON.stringify(result).includes('password_hash'));assert.ok(!JSON.stringify(result).includes('unusable'));assert.deepEqual((await db.query('CHECKSUM TABLE invoices,payments,payment_allocations,customers'))[0],before);
    assert.equal((await request('GET','/admin/users',undefined,collector)).status,403);assert.equal((await request('GET','/admin/users',undefined,null)).status,401);assert.equal((await request('GET','/admin/users?company_id=2')).status,403);
  });
  test('create reuses hashing and login, assigns real existing roles, never creates roles',async()=>{
    const roles=(await db.query('SELECT * FROM roles ORDER BY id'))[0];const result=await request('POST','/admin/users',{...profile,password});assert.equal(result.status,200,JSON.stringify(result));worker=result.body.data.id;assert.ok(!JSON.stringify(result).includes(password));
    const [[record]]=await db.query('SELECT company_id,password_hash FROM users WHERE id=?',[worker]);assert.equal(record.company_id,1);assert.match(record.password_hash,/^\$argon2id\$/);assert.deepEqual((await db.query('SELECT * FROM roles ORDER BY id'))[0],roles);
    const login=await request('POST','/auth/login',{login:profile.username,password},null);assert.equal(login.status,200);assert.ok(login.body.data.user.permissions.includes('collection.view'));assert.ok(!login.body.data.user.permissions.includes('settings.manage'));
    const sessions=(await db.query('SELECT id FROM auth_refresh_sessions WHERE user_id=? AND revoked_at IS NULL',[worker]))[0];assert.ok(sessions.length);
  });
  test('basic edit leaves password intact, changes roles transactionally and revokes refresh sessions',async()=>{
    const [[before]]=await db.query('SELECT password_hash FROM users WHERE id=?',[worker]);const response=await request('PUT','/admin/users/'+worker,{...profile,first_name:'Editado',roles:['supervisor']});assert.equal(response.status,200);
    const [[after]]=await db.query('SELECT password_hash FROM users WHERE id=?',[worker]);assert.equal(after.password_hash,before.password_hash);assert.equal((await db.query('SELECT id FROM auth_refresh_sessions WHERE user_id=? AND revoked_at IS NULL',[worker]))[0].length,0);
    const list=await request('GET','/admin/users');assert.deepEqual(list.body.data.users.find(u=>u.id===worker).roles,['supervisor']);
  });
  test('deactivation rejects access immediately and activation retains the existing password',async()=>{
    const login=await request('POST','/auth/login',{email:profile.email,password},null);assert.equal(login.status,200);const access=login.body.data.access_token;
    assert.equal((await request('PATCH','/admin/users/'+worker+'/status',{status:'inactive'})).status,200);assert.equal((await request('GET','/auth/me',undefined,access)).status,401);assert.equal((await request('POST','/auth/login',{email:profile.email,password},null)).status,401);
    assert.equal((await request('PATCH','/admin/users/'+worker+'/status',{status:'active'})).status,200);assert.equal((await request('POST','/auth/login',{email:profile.email,password},null)).status,200);
  });
  test('duplicate identities, unknown roles, forged scope and password updates are rejected',async()=>{
    assert.equal((await request('POST','/admin/users',{...profile,password})).status,409);
    for(const body of [{...profile,password,company_id:2},{...profile,password,roles:['new_role']},{...profile,password,roles:['collector','collector']},{...profile,password,email:'bad'},{...profile,password,username:'bad user'}])assert.equal((await request('POST','/admin/users',body)).status,400);
    assert.equal((await request('PUT','/admin/users/'+worker,{...profile,password})).status,400);assert.equal((await request('PUT','/admin/users/4',profile)).status,404);
    assert.equal((await request('PATCH','/admin/users/1/status',{status:'inactive'})).status,409);assert.equal((await request('PUT','/admin/users/1',{...profile,email:'admin@example.test',roles:['collector']})).status,409);
    assert.equal((await request('PUT','/admin/users/3',{...profile,email:'legacy@example.test',roles:['collector']})).status,409);assert.equal((await request('GET','/admin/users',undefined,legacy)).status,200);
  });
  test('audit failure rolls back user and role assignments without financial side effects',async()=>{
    const [before]=await db.query('CHECKSUM TABLE invoices,payments,payment_allocations,customers');await db.query("CREATE TRIGGER user_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='TEST_FAILURE'");
    try{const response=await request('POST','/admin/users',{...profile,email:'rollback@example.test',username:'rollback.demo',password});assert.equal(response.status,500);assert.ok(!JSON.stringify(response).includes('TEST_FAILURE'));assert.equal((await db.query("SELECT id FROM users WHERE email='rollback@example.test'"))[0].length,0);}finally{await db.query('DROP TRIGGER user_audit_failure');}
    assert.deepEqual((await db.query('CHECKSUM TABLE invoices,payments,payment_allocations,customers'))[0],before);const [audit]=await db.query("SELECT old_values,new_values FROM audit_logs WHERE entity_type='user'");assert.ok(audit.length>=4);assert.ok(!JSON.stringify(audit).includes(password));assert.ok(!JSON.stringify(audit).includes('password_hash'));
  });
});
