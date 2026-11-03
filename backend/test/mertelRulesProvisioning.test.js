import test from 'node:test';
import assert from 'node:assert/strict';
import {provisionMertelCollectionRules} from '../src/services/mertelCompany.service.js';
import {collectionStageCatalog} from '../src/services/collectionPolicy.js';
function fixture({auditFails=false,missing=false}={}) {
  let setting=null,rollback=0,insertions=0,audits=0;
  const db={async beginTransaction(){},async commit(){},async rollback(){rollback++;setting=null;},async query(sql,values){
    if(sql.includes('WHERE name='))return [missing?[]:[{id:'1',name:'MERTEL IMPORTACIONES',status:'active',deleted_at:null}]];
    if(sql.includes('GET_LOCK'))return [[{acquired:1}]];if(sql.includes('RELEASE_LOCK'))return [[{}]];
    if(sql.includes('FROM companies'))return [[{id:1}]];
    if(sql.includes('FROM settings'))return [setting?[setting]:[]];
    if(sql.startsWith('INSERT INTO settings')){insertions++;setting={id:1,setting_value:values[1],value_type:'json'};return [{insertId:1}];}
    if(sql.startsWith('INSERT INTO audit_logs')){if(auditFails)throw new Error('Audit failure');audits++;assert.equal(JSON.parse(values[2]).actor_type,'SYSTEM');return [{}];}
    throw new Error('Unexpected query');
  }};
  return {db,state:()=>({setting,rollback,insertions,audits})};
}
test('provisions only existing MERTEL settings once, respecting confirmed policy and exclusions',async()=>{
  const {db,state}=fixture();assert.equal((await provisionMertelCollectionRules(db)).created,true);
  const original=state().setting.setting_value;assert.equal((await provisionMertelCollectionRules(db)).created,false);assert.equal(state().setting.setting_value,original);assert.equal(state().insertions,1);assert.equal(state().audits,1);
  const config=JSON.parse(original);assert.deepEqual(collectionStageCatalog(config).map(s=>s.key),['overdue','due_today','five_days_before_due','prompt_payment']);assert.equal(config.prompt_payment.percentage,'3');assert.equal(config.prompt_payment.window.include_day_ten,true);assert.equal(config.prompt_payment.window.day_type,'calendar');assert.equal(config.conditional_discount.active,false);assert.equal(config.prompt_payment.exclusions.promo_18,true);
});
test('missing MERTEL fails without creating companies',async()=>{const {db,state}=fixture({missing:true});await assert.rejects(provisionMertelCollectionRules(db),{status:503});assert.equal(state().insertions,0);});
test('audit failure rolls back configuration',async()=>{const {db,state}=fixture({auditFails:true});await assert.rejects(provisionMertelCollectionRules(db),/Audit failure/);assert.equal(state().rollback,1);assert.equal(state().setting,null);});
