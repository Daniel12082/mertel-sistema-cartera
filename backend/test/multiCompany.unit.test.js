import test from "node:test";
import assert from "node:assert/strict";
import { companyContext, companyFilter, documentCompany, sameCompany, validCompanyId } from "../src/utils/companyScope.js";
import { evaluateCompanyCollection } from "../src/services/companyCollection.service.js";

test("global context requires both a real admin role and explicit NULL company",()=>{
  assert.equal(companyContext({id:"1",company_id:null,roles:[{name:"admin"}]}).globalAdmin,true);
  for(const user of [{company_id:null,roles:[{name:"collector"}]},{company_id:null,roles:[]},{roles:[{name:"admin"}]},{company_id:"1",roles:[{name:"admin"}]}]) assert.equal(companyContext(user).globalAdmin,false);
});
test("company identifiers validate unsigned BIGINT without lossy numeric coercion",()=>{
  for(const value of ["1",1,"18446744073709551615"]) assert.equal(validCompanyId(value),true);
  for(const value of [null,undefined,0,-1,"01","18446744073709551616",Number.MAX_SAFE_INTEGER+1,{},["1"]]) assert.equal(validCompanyId(value),false);
});
test("SQL ownership filters fail closed without scope and filter every joined company",()=>{
  for(const scope of [undefined,{},companyContext({company_id:null,roles:[{name:"supervisor"}]})]) assert.throws(()=>companyFilter(scope,"company_id"));
  assert.deepEqual(companyFilter(companyContext({id:"1",company_id:"2",roles:[]}),"i.company_id","c.company_id"),{sql:" AND i.company_id = ? AND c.company_id = ?",values:["2","2"]});
  assert.deepEqual(companyFilter(companyContext({id:"1",company_id:null,roles:[{name:"admin"}]}),"company_id"),{sql:"",values:[]});
});
test("strict company equality never treats NULL as a wildcard",()=>{
  assert.equal(sameCompany(null,null),true); assert.equal(sameCompany("1",1),true);
  for(const [left,right] of [[null,1],[1,null],[1,2]]) assert.equal(sameCompany(left,right),false);
});
test("company binding ignores tenant claims and prevents foreign references and global moves",()=>{
  const tenant=companyContext({id:"1",company_id:"2",roles:[{name:"admin"}]});
  assert.equal(documentCompany({company_id:"3"},{company_id:"2"},tenant),"2");
  assert.throws(()=>documentCompany({},{company_id:"3"},tenant));
  const global=companyContext({id:"1",company_id:null,roles:[{name:"admin"}]});
  assert.equal(documentCompany({},{company_id:"2"},global),"2");
  assert.throws(()=>documentCompany({company_id:"3"},{company_id:"2"},global,{company_id:"2"}));
});
test("company collection adapter keeps the generic engine pure and rejects cross-company input",()=>{
  const input={company:{id:"2"},referenceDate:"2026-10-02",customers:[{id:"1",company_id:"2"}],
    invoices:[{id:"1",company_id:"2",customer_id:"1",due_date:"2026-10-02",balance:"100.00"}],rules:[]};
  const before=structuredClone(input); assert.equal(evaluateCompanyCollection(input)[0].eligible,false); assert.deepEqual(input,before);
  assert.throws(()=>evaluateCompanyCollection({...input,company:{id:null}}));
  assert.throws(()=>evaluateCompanyCollection({...input,customers:[{id:"1",company_id:"3"}]}));
});
