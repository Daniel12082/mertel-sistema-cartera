import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createApp } from '../src/app.js';
import { loadAuthConfig } from '../src/config/auth.js';
import pool from '../src/config/database.js';

let server, origin, queries = 0; const originalQuery = pool.query;
before(async () => {
  pool.query = async () => { queries++; throw new Error('Simulation must not reach MySQL'); };
  const config = loadAuthConfig({ NODE_ENV: 'test', JWT_SECRET: randomBytes(48).toString('base64url'), FRONTEND_URL: 'http://localhost:5173', AUTH_COOKIE_SAME_SITE: 'lax' });
  server = await new Promise(resolve => { const listener = createApp(config).listen(0, '127.0.0.1', () => resolve(listener)); });
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise(resolve => server.close(resolve)); pool.query = originalQuery; await pool.end(); });
for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) for (const path of ['/api/customers', '/api/payments', '/api/collection/results/customers/1/payments', '/api/admin/portfolio/imports/analyze', '/api/admin/whatsapp/queue', '/api/auth/login', '/api/auth/refresh', '/api/auth/logout']) {
  test(`explicit simulation ${method} ${path} is rejected before auth, audit or any SQL`, async () => {
    const response = await fetch(origin + path, { method, headers: { 'X-Mertel-Simulation': 'true', 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 409); assert.equal((await response.json()).code, 'SIMULATION_LOCAL_ONLY'); assert.equal(queries, 0);
  });
}
test('explicit simulated reads cannot disclose operational data; normal auth guards stay intact', async () => {
  assert.equal((await fetch(origin + '/api/invoices', { headers: { 'X-Mertel-Simulation': 'true' } })).status, 409);
  assert.equal((await fetch(origin + '/api/invoices')).status, 401);
  assert.equal((await fetch(origin + '/api/health')).status, 200);
  assert.equal(queries, 0);
});
