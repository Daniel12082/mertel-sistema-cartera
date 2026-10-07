import test from 'node:test';
import assert from 'node:assert/strict';
import {dashboardPeriod,dashboardPortfolio,getAdminDashboard} from '../src/services/adminDashboard.service.js';
import {buildCollectionResult} from '../src/services/collection.service.js';
import {readFile} from 'node:fs/promises';
const rules=JSON.parse(await readFile(new URL('../config/mertel-collection-rules.json',import.meta.url)));
const now=new Date('2026-10-08T02:00:00Z');
test('server Bogota date and period boundaries, including custom validation',()=>{
  assert.equal(dashboardPeriod({},now).reference_date,'2026-10-07');
  assert.equal(dashboardPeriod({period:'7'},now).from,'2026-10-01');
  assert.equal(dashboardPeriod({period:'month'},now).from,'2026-10-01');
  assert.equal(dashboardPeriod({},now).to_utc,'2026-10-08 05:00:00');
  assert.equal(dashboardPeriod({period:'custom',from:'2026-09-01',to:'2026-10-01'},now).from,'2026-09-01');
  for(const query of [{period:'bad'},{period:'custom',from:'2026-02-30',to:'2026-10-01'},{period:'custom',from:'2026-10-08',to:'2026-10-08'},{period:'custom',from:'2024-01-01',to:'2026-10-01'}])assert.throws(()=>dashboardPeriod(query,now),{status:400});
});
test('stage balances count only engine-classified invoices, top and priority reuse engine',()=>{
  const dates=[['2020-01-01','2020-02-01'],['2026-09-01','2026-10-07'],['2026-09-01','2026-10-12'],['2026-10-07','2026-11-07']];
  const invoices=dates.map(([issue_date,due_date],n)=>({invoice_id:n+1,customer_id:n+1,company_id:1,issue_date,due_date,balance:`${(n+1)*100}.00`,base_value:'100.00',invoice_number:`INV-${n+1}`}));
  invoices.push({...invoices[0],invoice_id:5,due_date:'2027-01-01',balance:'900.00'});
  const collection=buildCollectionResult({company:{id:1},referenceDate:'2026-10-07',customers:dates.map((_,n)=>({id:n+1,company_id:1,name:`Cliente ${n+1}`,nit:String(n)})),invoices,rules});
  const result=dashboardPortfolio(collection);
  assert.equal(result.summary.total_balance,'1900.00');
  for(const [key,balance]of [['overdue','100.00'],['due_today','200.00'],['five_days_before_due','300.00'],['prompt_payment','400.00']])assert.equal(result.summary.stages.find(stage=>stage.key===key).balance,balance);
  assert.equal(result.top_customers[0].balance,'1000.00');
  assert.deepEqual(result.priority_customers.map(row=>row.id),collection.customers.map(row=>String(row.customer.id)));
});
test('partial section errors are sanitized; bounded queries, no secrets, read-only transaction',async()=>{
  const queries=[];let released=false;
  const db={async query(sql){queries.push(sql);if(sql.includes('mertel_customer_resolution_rows'))throw new Error('SQL credentials secret');
    if(sql.includes('collection_rules'))return [[]];if(sql.includes('FROM customers')||sql.includes('FROM invoices')||sql.includes('FROM payment_promises p')||sql.includes('FROM audit_logs l'))return [[]];
    if(sql.includes('setting_key'))return [[{setting_value:JSON.stringify({provider:'MOCK',connection_status:'CONNECTED',encrypted_credentials:'SECRET',token:'SECRET'})}]];
    return [[{}]];},async commit(){},async rollback(){},release(){released=true;}};
  const data=await getAdminDashboard({scope:{companyId:'1'},now},{getConnection:async()=>db});
  assert.equal(data.resolution.status,'error');assert.equal(data.recovery.status,'ok');assert.equal(data.whatsapp.data.provider,'MOCK');
  assert.ok(!JSON.stringify(data).includes('SECRET'));assert.ok(!JSON.stringify(data).includes('SQL'));
  assert.equal(queries[0],'START TRANSACTION READ ONLY');assert.ok(queries.length<25);assert.ok(queries.every(sql=>!/^\s*(INSERT|UPDATE|DELETE|ALTER)/i.test(sql)));assert.ok(released);
});
