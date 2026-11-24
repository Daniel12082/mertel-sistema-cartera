import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import {loadAuthConfig} from '../src/config/auth.js';
import {hashPassword} from '../src/utils/password.js';
dotenv.config({path:new URL('../.env',import.meta.url),quiet:true});
const schema='mertel_access_test_'+randomUUID().replaceAll('-',''),original=process.env.DB_NAME;
const password='Fixture-'+randomBytes(12).toString('hex'),config=loadAuthConfig({NODE_ENV:'test',JWT_SECRET:randomBytes(48).toString('hex'),FRONTEND_URL:'http://localhost:5173',AUTH_COOKIE_SAME_SITE:'lax',AUTH_RATE_LIMIT_MAX:'1000'});
let db,pool,server,url,adminToken,userId,roleId,roleName,workerSession,recovery;
before(async()=>{
 db=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,password:process.env.DB_PASSWORD,multipleStatements:true});
 await db.query('CREATE DATABASE `'+schema+'`');await db.query('USE `'+schema+'`');
 const initial=await readFile(new URL('../../database/migrations/001_initial_schema.sql',import.meta.url),'utf8');
 for(const match of initial.matchAll(/CREATE TABLE (\w+) \([\s\S]*?;/g))await db.query(match[0]);
 for(const name of ['004_auth_refresh_sessions.sql','005_users_username.sql','012_custom_roles_password_reset.sql'])await db.query(await readFile(new URL('../../database/migrations/'+name,import.meta.url),'utf8'));
 await db.query("INSERT INTO companies(id,name) VALUES (1,'MERTEL IMPORTACIONES'),(2,'OTRA');INSERT INTO roles(id,name) VALUES (1,'admin'),(2,'collector'),(3,'supervisor')");
 await db.query("INSERT INTO users(id,company_id,first_name,email,password_hash) VALUES (1,1,'Admin','admin@example.test',?),(2,2,'Other','other@example.test',?)",[await hashPassword(password),await hashPassword(password)]);
 await db.query('INSERT INTO user_roles VALUES (1,1),(2,1)');
 process.env.DB_NAME=schema;({default:pool}=await import('../src/config/database.js'));
 const {createApp}=await import('../src/app.js');server=await new Promise(resolve=>{const s=createApp(config).listen(0,'127.0.0.1',()=>resolve(s));});url='http://127.0.0.1:'+server.address().port+'/api';
 recovery=await import('../src/services/passwordRecovery.service.js');
 adminToken=(await request('POST','/auth/login',{email:'admin@example.test',password})).body.data.access_token;
});
after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));if(pool)await pool.end();if(db){assert.match(schema,/^mertel_access_test_[a-f0-9]{32}$/);assert.notEqual(schema,original);await db.query('DROP DATABASE `'+schema+'`');await db.end();}if(original===undefined)delete process.env.DB_NAME;else process.env.DB_NAME=original;});
async function request(method,path,body,token){const r=await fetch(url+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:await r.json(),headers:r.headers};}
test('admin creates a scoped read-only role and assigns it to a new user',async()=>{
 const r=await request('POST','/admin/roles',{label:'Solo consultar clientes',permissions:['customers.view']},adminToken);assert.equal(r.status,200,JSON.stringify(r));roleId=r.body.data.id;roleName=r.body.data.name;
 const created=await request('POST','/admin/users',{first_name:'Lectura',email:'reader@example.test',password,roles:[roleName]},adminToken);assert.equal(created.status,200,JSON.stringify(created));userId=created.body.data.id;
 workerSession=await request('POST','/auth/login',{email:'reader@example.test',password});assert.equal(workerSession.status,200);const token=workerSession.body.data.access_token;
 assert.deepEqual(workerSession.body.data.user.permissions,['customers.view']);
 assert.equal((await request('GET','/customers',undefined,token)).status,200);
 for(const [method,path]of[['POST','/customers'],['GET','/invoices'],['GET','/admin/dashboard'],['GET','/admin/users'],['GET','/admin/roles']])assert.equal((await request(method,path,method==='POST'?{}:undefined,token)).status,403,path);
});
test('duplicate role labels roll back and built-in roles cannot be overwritten',async()=>{
 const r=await request('POST','/admin/roles',{label:'Solo consultar clientes',permissions:['invoices.view']},adminToken);assert.equal(r.status,409);
 assert.equal((await request('PUT','/admin/roles/1',{label:'Reemplazo Admin',permissions:[]},adminToken)).status,404);
 const catalog=await request('GET','/admin/roles',undefined,adminToken);assert.deepEqual(catalog.body.data.find(r=>r.name===roleName).permissions.filter(p=>p.enabled).map(p=>p.name),['customers.view']);
});
test('a limited user manager cannot assign administrator, change privileged passwords or create roles',async()=>{
 const role=await request('POST','/admin/roles',{label:'Gestión limitada',permissions:['users.create','users.update','users.reset_password']},adminToken);assert.equal(role.status,200);
 const created=await request('POST','/admin/users',{first_name:'Gestor',email:'manager@example.test',password,roles:[role.body.data.name]},adminToken);assert.equal(created.status,200);
 const session=await request('POST','/auth/login',{email:'manager@example.test',password});const token=session.body.data.access_token;
 assert.equal((await request('POST','/admin/users',{first_name:'Elevado',email:'elevated@example.test',password,roles:['admin']},token)).status,403);
 assert.equal((await request('PUT','/admin/users/1/password',{password:'Must-not-change-123'},token)).status,403);
 assert.equal((await request('POST','/admin/roles',{label:'Elevado',permissions:['roles.manage']},token)).status,403);
});
test('role edits take effect for existing tokens and inactive roles grant nothing',async()=>{
 let r=await request('PUT','/admin/roles/'+roleId,{label:'Solo consultar clientes',permissions:['customers.create']},adminToken);assert.equal(r.status,200);assert.ok(r.body.data.permissions.includes('customers.view'));
 const me=await request('GET','/auth/me',undefined,workerSession.body.data.access_token);assert.ok(me.body.data.permissions.includes('customers.create'));
 r=await request('PUT','/admin/roles/'+roleId,{label:'Solo consultar clientes',permissions:['customers.view'],active:false},adminToken);assert.equal(r.status,200);
 assert.equal((await request('GET','/customers',undefined,workerSession.body.data.access_token)).status,403);
 await request('PUT','/admin/roles/'+roleId,{label:'Solo consultar clientes',permissions:['customers.view'],active:true},adminToken);
});
test('admin changes a password, revokes old access and refresh sessions, and audits without secrets',async()=>{
 const r=await request('PUT','/admin/users/'+userId+'/password',{password:'Changed-fixture-123'},adminToken);assert.equal(r.status,200,JSON.stringify(r));
 assert.equal((await request('GET','/auth/me',undefined,workerSession.body.data.access_token)).status,401);
 assert.equal((await request('POST','/auth/login',{email:'reader@example.test',password})).status,401);
 assert.equal((await request('POST','/auth/login',{email:'reader@example.test',password:'Changed-fixture-123'})).status,200);
 assert.equal((await request('PUT','/admin/users/2/password',{password:'Other-fixture-123'},adminToken)).status,404);
 const [audit]=await db.query("SELECT new_values FROM audit_logs WHERE action='USER_PASSWORD_CHANGED'");assert.equal(audit.length,1);assert.equal(JSON.stringify(audit).includes('Changed-fixture'),false);
 const visible=await request('GET','/admin/collection/history?type=access',undefined,adminToken);assert.equal(visible.status,200,JSON.stringify(visible));assert.ok(visible.body.data.events.some(event=>event.title==='Contraseña cambiada por administración'&&event.actor==='Admin'&&event.occurred_at));
});
test('recovery sends a one-use link, stores only a hash, expires and revokes previous sessions',async()=>{
 let delivered;
 await recovery.requestPasswordRecovery('reader@example.test',{dbPool:pool,env:{SMTP_PASSWORD:'fixture',FRONTEND_URL:'http://localhost:5173'},send:async mail=>{delivered=mail;}});
 assert.equal(delivered.to,'reader@example.test');const token=new URLSearchParams(new URL(delivered.url).hash.slice(1)).get('token');assert.equal(token.length,43);
 const [[record]]=await db.query('SELECT token_hash FROM auth_password_resets WHERE user_id=? ORDER BY id DESC',[userId]);assert.notEqual(record.token_hash,token);
 const old=await request('POST','/auth/login',{email:'reader@example.test',password:'Changed-fixture-123'});
 const result=await request('POST','/auth/reset-password',{token,password:'Recovered-fixture-123'});assert.equal(result.status,200,JSON.stringify(result));
 assert.equal((await request('POST','/auth/reset-password',{token,password:'Replay-fixture-123'})).status,400);
 assert.equal((await request('GET','/auth/me',undefined,old.body.data.access_token)).status,401);
 assert.equal((await request('POST','/auth/login',{email:'reader@example.test',password:'Recovered-fixture-123'})).status,200);
 await db.query('UPDATE auth_password_resets SET created_at=UTC_TIMESTAMP(3)-INTERVAL 2 MINUTE WHERE user_id=?',[userId]);
 await recovery.requestPasswordRecovery('reader@example.test',{dbPool:pool,env:{SMTP_PASSWORD:'fixture',FRONTEND_URL:'http://localhost:5173'},send:async mail=>{delivered=mail;}});
 const expired=new URLSearchParams(new URL(delivered.url).hash.slice(1)).get('token');await db.query('UPDATE auth_password_resets SET expires_at=UTC_TIMESTAMP(3)-INTERVAL 1 MINUTE WHERE user_id=?',[userId]);
 assert.equal((await request('POST','/auth/reset-password',{token:expired,password:'Expired-fixture-123'})).status,400);
 const absent=await recovery.requestPasswordRecovery('absent@example.test',{dbPool:pool,env:{SMTP_PASSWORD:'fixture'},send:async()=>assert.fail('Unknown address must never be sent mail')});assert.equal(absent.message,recovery.RECOVERY_MESSAGE);
});
