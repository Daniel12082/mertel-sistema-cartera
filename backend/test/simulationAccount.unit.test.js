import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { provisionSimulationAccount } from '../src/services/simulationAccount.service.js';
import { verifyPassword } from '../src/utils/password.js';
import { permissionsForRoles } from '../src/config/permissions.js';
import pool from '../src/config/database.js';
import { saveManagedUser } from '../src/services/userManagement.service.js';
after(()=>pool.end());

function fixture(existing=false,auditFailure=false) {
  const calls=[],state={committed:false,rolledBack:false};
  const db={async beginTransaction(){},async commit(){state.committed=true;},async rollback(){state.rolledBack=true;},release(){},async query(sql,args){
    calls.push({sql,args});
    if(sql.startsWith('SELECT id FROM companies'))return [[{id:'1'}]];
    if(sql.includes('FROM users WHERE id'))return [[{id:'1',company_id:'1',status:'active',deleted_at:null}]];
    if(sql.includes('INNER JOIN user_roles'))return [[{name:'admin'}]];
    if(sql.startsWith('SELECT u.id FROM users'))return [existing?[{id:'3'}]:[]];
    if(sql.startsWith('INSERT INTO users'))return [{insertId:42}];
    if(sql.startsWith('INSERT INTO audit_logs')&&auditFailure)throw new Error('audit failed');
    return [{}];
  }};
  return {calls,state,pool:{async getConnection(){return db;}}};
}
const input={companyId:'1',actorId:'1',email:'demo@example.test',username:'mertel.demo',password:'fixture-only-password'};
test('demo classification grants no operational permissions',()=>assert.deepEqual(permissionsForRoles([{name:'simulation'}]),[]));
test('provision creates only a dedicated login with a hashed password and audit without secrets',async()=>{
  const f=fixture();const result=await provisionSimulationAccount(input,f.pool);
  assert.equal(result.simulation_only,true);assert.equal(f.state.committed,true);
  const passwordHash=f.calls.find(row=>row.sql.startsWith('INSERT INTO users')).args.at(-1);
  assert.ok(await verifyPassword(passwordHash,input.password));
  assert.equal(JSON.stringify(f.calls.find(row=>row.sql.startsWith('INSERT INTO audit_logs'))).includes(input.password),false);
  assert.equal(f.calls.some(row=>/UPDATE users|INSERT INTO invoices|INSERT INTO customers|INSERT INTO payments/.test(row.sql)),false);
});
test('second demo account and failed audit roll back without committing',async()=>{
  for(const [existing,auditFailure] of [[true,false],[false,true]]){
    const f=fixture(existing,auditFailure);await assert.rejects(provisionSimulationAccount(input,f.pool));
    assert.equal(f.state.committed,false);assert.equal(f.state.rolledBack,true);
  }
});
test('user management cannot convert the reserved demo account into an operational administrator',async()=>{
  let rolledBack=false;
  const db={async beginTransaction(){},async rollback(){rolledBack=true;},release(){},async query(sql){
    if(sql.startsWith('SELECT id FROM companies'))return [[{id:'1'}]];
    if(sql.includes('FROM users WHERE id'))return [[{id:'1',company_id:'1',status:'active',deleted_at:null}]];
    if(sql.includes('INNER JOIN user_roles'))return [[{name:'admin'}]];
    if(sql.includes('FROM users u WHERE u.id'))return [[{id:'42',company_id:'1',status:'active'}]];
    if(sql.startsWith('SELECT r.name FROM roles'))return [[{name:'simulation'}]];
    throw new Error('Unexpected SQL');
  }};
  await assert.rejects(saveManagedUser({scope:{companyId:'1'},actorId:'1',userId:'42',body:{first_name:'Demo',email:'demo@example.test',roles:['admin']}},{async getConnection(){return db;}}),error=>error.status===409);
  assert.equal(rolledBack,true);
});
