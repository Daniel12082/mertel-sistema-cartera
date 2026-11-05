import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRequestStructure, transportSecurity } from '../src/middleware/security.js';
function check(body, query = {}) {
  let status = 200;
  validateRequestStructure({ body, query }, { status(code) { status = code; return this; }, json() {} }, () => {});
  return status;
}
test('request structure preserves business text and rejects prototype keys and control bytes', () => {
  assert.equal(check({ notes: '<texto> & dirección\nsegunda línea', amount: '10.50' }), 200);
  assert.equal(check(JSON.parse('{"__proto__":{"admin":true}}')), 400);
  assert.equal(check({nested:{constructor:{admin:true}}}), 400);
  assert.equal(check({notes:'a\u0000b'}), 400);
});
test('request structure bounds nesting and node count', () => {
  let nested = {}; for(let i=0;i<25;i++) nested = {nested};
  assert.equal(check(nested), 400);
  assert.equal(check({rows:Array(10001).fill(1)}), 400);
});
test('HTTPS is mandatory only when secure transport is configured', () => {
  for(const [secure, requestSecure, expected] of [[true,false,403],[true,true,200],[false,false,200]]) {
    let status=200;
    transportSecurity({cookieOptions:{secure}})({secure:requestSecure},{set(){},status(code){status=code;return this;},json(){}},()=>{});
    assert.equal(status,expected);
  }
});
