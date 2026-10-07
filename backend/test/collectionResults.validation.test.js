import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {parseCollectionPayment,positiveMoney,operationKey,payloadHash,signPaymentPreview,verifyPaymentPreview} from '../src/services/collectionResults.validation.js';

test('exact monetary validation, manual allocations and no frontend balance authority',()=>{
  const body={amount:'119.00',payment_date:'2026-10-07',payment_kind:'TOTAL',allocations:[{invoice_id:'1',amount:'119.00'}]};
  assert.equal(parseCollectionPayment(body).amount,'119.00');
  assert.equal(positiveMoney('9999999999999.99'),'9999999999999.99');
  for(const value of ['0','-1','1.001',NaN,'Infinity','1e3'])assert.throws(()=>positiveMoney(value));
  for(const extra of [{new_balance:'0'}, {allocations:[]},{payment_date:'2026-02-30'},{allocations:[{invoice_id:'1',amount:'120.00'}]},
    {payment_kind:'MULTIPLE',allocations:[{invoice_id:'1',amount:'50'},{invoice_id:'1',amount:'50'}]}])assert.throws(()=>parseCollectionPayment({...body,...extra}));
});
test('confirmation binds actor, customer, payload, idempotency key and expiry',()=>{
  const scope={companyId:'1',actorId:'2'};const customerId='3';const uuid=randomUUID();const key=operationKey(uuid,scope,customerId);const hash=payloadHash({amount:'100.00'});
  assert.equal(key,operationKey(uuid.toUpperCase(),scope,customerId));
  const claims={company_id:'1',actor_id:'2',customer_id:'3',key,hash,expires_at:Date.now()+60000,balances:{'4':'100.00'}};
  const token=signPaymentPreview(claims,'fixture-secret');
  assert.deepEqual(verifyPaymentPreview(token,{scope,customerId,key,hash},'fixture-secret'),claims);
  for(const context of [{scope:{...scope,actorId:'9'},customerId,key,hash},{scope,customerId:'9',key,hash},{scope,customerId,key,hash:'bad'}])assert.throws(()=>verifyPaymentPreview(token,context,'fixture-secret'));
  assert.throws(()=>verifyPaymentPreview(token+'x',{scope,customerId,key,hash},'fixture-secret'));
  assert.throws(()=>verifyPaymentPreview(signPaymentPreview({...claims,expires_at:1},'fixture-secret'),{scope,customerId,key,hash},'fixture-secret'));
});
