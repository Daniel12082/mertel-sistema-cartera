import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import jwt from "jsonwebtoken";
import { loadAuthConfig } from "../src/config/auth.js";
import { hashPassword } from "../src/utils/password.js";
import { applyAuthMigrations } from "../src/services/authMigrations.service.js";

dotenv.config({ path: new URL("../.env", import.meta.url), quiet: true });
// Every company/user/document in this suite exists only in the generated disposable schema.
describe("multi-company HTTP / MySQL isolation", { skip: !(process.env.DB_HOST && process.env.DB_USER) }, () => {
  const databaseName = `mertel_company_test_${randomUUID().replaceAll("-", "")}`;
  const originalDatabase = process.env.DB_NAME;
  const password = randomBytes(32).toString("base64url");
  const config = loadAuthConfig({ JWT_SECRET: randomBytes(48).toString("base64url"), FRONTEND_URL: "http://localhost:5173",
    AUTH_COOKIE_SAME_SITE: "lax", NODE_ENV: "test", AUTH_RATE_LIMIT_MAX: "10000" });
  let db; let pool; let server; let url; let hash; let a; let b; let global; let unassigned;
  let getCompanySettings; let getCompanyMessageTemplates; let evaluateCompanyCollection; let loadCompanyCollectionRules;
  before(async () => {
    db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER,
      password: process.env.DB_PASSWORD, multipleStatements: true });
    await db.query(`CREATE DATABASE \`${databaseName}\``); await db.query(`USE \`${databaseName}\``);
    const schema = await readFile(new URL("../../database/migrations/001_initial_schema.sql", import.meta.url), "utf8");
    const tables = new Set(["companies","roles","users","user_roles","customers","invoices","payments","payment_allocations","payment_promises","audit_logs","settings","message_templates","messages","collection_actions"]);
    for (const match of schema.matchAll(/CREATE TABLE (\w+) \([\s\S]*?;/g)) if (tables.has(match[1])) await db.query(match[0]);
    await db.query("INSERT INTO roles (name) VALUES ('admin'),('supervisor'),('collector')");
    for (const file of ["002_payment_allocations_soft_delete.sql", "003_active_payment_invoice_allocation_unique.sql"]) {
      await db.query(await readFile(new URL(`../../database/migrations/${file}`, import.meta.url), "utf8"));
    }
    await applyAuthMigrations(db);
    process.env.DB_NAME = databaseName;
    ({ default: pool } = await import("../src/config/database.js"));
    ({ getCompanySettings, getCompanyMessageTemplates } = await import("../src/models/companyConfiguration.model.js"));
    ({ evaluateCompanyCollection, loadCompanyCollectionRules } = await import("../src/services/companyCollection.service.js"));
    const { createApp } = await import("../src/app.js");
    server = await new Promise(resolve => { const listener = createApp(config).listen(0, "127.0.0.1", () => resolve(listener)); });
    url = `http://127.0.0.1:${server.address().port}/api`;
    hash = await hashPassword(password);
  });
  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (pool) await pool.end();
    if (db) {
      assert.match(databaseName, /^mertel_company_test_[a-f0-9]{32}$/);
      assert.notEqual(databaseName, originalDatabase);
      await db.query(`DROP DATABASE IF EXISTS \`${databaseName}\``); await db.end();
    }
    if (originalDatabase === undefined) delete process.env.DB_NAME; else process.env.DB_NAME = originalDatabase;
  });
  async function user(companyId, role = "admin") {
    const email = `${randomUUID()}@example.test`;
    const [created] = await db.query("INSERT INTO users (company_id,first_name,email,password_hash) VALUES (?,'Company fixture',?,?)", [companyId, email, hash]);
    if (role) await db.query("INSERT INTO user_roles (user_id,role_id) SELECT ?,id FROM roles WHERE name=?", [created.insertId, role]);
    const login = await request("POST", "/auth/login", { body: { email, password } });
    assert.equal(login.status, 200);
    return { id: created.insertId, token: login.body.data.access_token, identity: login.body.data.user };
  }
  async function company(label) {
    const [created] = await db.query("INSERT INTO companies (name) VALUES (?)", [`${label} ${randomUUID()}`]);
    const companyId = created.insertId;
    const actor = await user(companyId);
    const [customer] = await db.query("INSERT INTO customers (company_id,nit,name) VALUES (?,'same-reference-across-companies',?)", [companyId, `${label} customer`]);
    const [invoice] = await db.query("INSERT INTO invoices (company_id,customer_id,invoice_number,document_value,base_value,iva_value,balance,due_date) VALUES (?,?,'same-number',100,100,0,100,'2026-10-04')", [companyId, customer.insertId]);
    const [payment] = await db.query("INSERT INTO payments (company_id,customer_id,payment_date,amount,created_by) VALUES (?,?,'2026-10-02',100,?)", [companyId, customer.insertId, actor.id]);
    return { companyId, customer: customer.insertId, invoice: invoice.insertId, payment: payment.insertId, ...actor };
  }
  beforeEach(async () => {
    a = await company("A"); b = await company("B"); global = await user(null); unassigned = await user(null, "collector");
    const [allocation] = await db.query("INSERT INTO payment_allocations (payment_id,invoice_id,amount) VALUES (?,?,20)", [b.payment,b.invoice]);
    b.allocation = allocation.insertId;
    await db.query("UPDATE invoices SET balance=80 WHERE id=?", [b.invoice]);
  });
  async function request(method, path, { token, body, headers = {} } = {}) {
    const response = await fetch(`${url}${path}`, { method, headers: { "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  }
  async function expect(method, path, actor, status, body, headers) {
    const result = await request(method,path,{token:actor?.token,body,headers});
    assert.equal(result.status,status, `${method} ${path}: ${JSON.stringify(result.body)}`); return result.body?.data;
  }
  const customerBody = (extra = {}) => ({ nit: randomUUID(), name: "Edited company customer", ...extra });
  const invoiceBody = (customerId, extra = {}) => ({ customer_id: customerId, invoice_number: randomUUID(),
    document_value: "100.00", base_value: "100.00", iva_value: "0.00", due_date: "2026-10-04", ...extra });
  const paymentBody = (customerId, extra = {}) => ({ customer_id: customerId, payment_date: "2026-10-02", amount: "100.00", ...extra });
  async function financialState() {
    const state = {};
    for (const table of ["customers","invoices","payments","payment_allocations"]) {
      const [rows] = await db.query(`SELECT * FROM \`${table}\` ORDER BY id`); state[table] = rows;
    }
    return state;
  }
  test("me exposes company/global context computed from the current user and roles", async () => {
    for (const [actor,companyId,isGlobal] of [[a,String(a.companyId),false],[b,String(b.companyId),false],[global,null,true],[unassigned,null,false]]) {
      const identity = await expect("GET","/auth/me",actor,200);
      assert.equal(identity.company_id,companyId); assert.equal(identity.is_global_admin,isGlobal);
      assert.equal(JSON.stringify(identity).includes(hash),false);
    }
  });
  test("A/B lists stay isolated despite query and header company spoofing", async () => {
    for (const [actor,other] of [[a,b],[b,a]]) for (const [path,key] of [["customers","customer"],["invoices","invoice"],["payments","payment"]]) {
      for (const suffix of ["",`?company_id=${other.companyId}`]) {
        const rows = await expect("GET",`/${path}${suffix}`,actor,200,undefined,{"X-Company-Id":String(other.companyId)});
        assert.deepEqual(rows.map(row=>row.id),[actor[key]]);
      }
    }
  });
  test("foreign detail IDs return the same 404 response as nonexistent IDs", async () => {
    for (const [actor,other] of [[a,b],[b,a]]) for (const [path,key] of [["customers","customer"],["invoices","invoice"],["payments","payment"]]) {
      const foreign = await request("GET",`/${path}/${other[key]}`,{token:actor.token});
      const missing = await request("GET",`/${path}/999999999`,{token:actor.token});
      assert.equal(foreign.status,404); assert.deepEqual(foreign.body,missing.body);
    }
    await expect("GET",`/portfolio/customer/${b.customer}?reference_date=2026-10-02`,a,404);
  });
  test("foreign customer/invoice/payment updates return 404 without changing data", async () => {
    const before = await financialState();
    await expect("PUT",`/customers/${b.customer}`,a,404,customerBody());
    await expect("PUT",`/invoices/${b.invoice}`,a,404,invoiceBody(a.customer));
    await expect("PUT",`/payments/${b.payment}`,a,404,paymentBody(a.customer));
    assert.deepEqual(await financialState(),before);
  });
  test("foreign delete/reversal routes fail before exposing financial dependencies", async () => {
    const before = await financialState();
    for (const [path,key] of [["customers","customer"],["invoices","invoice"],["payments","payment"]]) await expect("DELETE",`/${path}/${b[key]}`,a,404);
    await expect("GET",`/payments/${b.payment}/allocations`,a,404);
    await expect("DELETE",`/payments/${b.payment}/allocations/${b.allocation}`,a,404);
    await expect("DELETE",`/payments/${a.payment}/allocations/${b.allocation}`,a,404);
    assert.deepEqual(await financialState(),before);
  });
  test("tenant creation derives company and payment creator from the authenticated user", async () => {
    const customer = await expect("POST","/customers",a,201,customerBody({company_id:b.companyId}));
    const invoice = await expect("POST","/invoices",a,201,invoiceBody(customer.id,{company_id:b.companyId}));
    const payment = await expect("POST","/payments",a,201,paymentBody(customer.id,{company_id:b.companyId,created_by:b.id}));
    for (const record of [customer,invoice,payment]) assert.equal(String(record.company_id),String(a.companyId));
    assert.equal(String(payment.created_by),String(a.id));
    const otherRows = await expect("GET","/customers",b,200); assert.equal(otherRows.some(row=>row.id===customer.id),false);
  });
  test("tenant documents cannot reference foreign customers even with forged company_id", async () => {
    const before = await financialState();
    await expect("POST","/invoices",a,404,invoiceBody(b.customer,{company_id:a.companyId}));
    await expect("POST","/payments",a,404,paymentBody(b.customer,{company_id:a.companyId}));
    assert.deepEqual(await financialState(),before);
  });
  test("tenant company spoofing cannot move customers, invoices or payments", async () => {
    const customer = await expect("PUT",`/customers/${a.customer}`,a,200,customerBody({company_id:b.companyId}));
    const invoice = await expect("PUT",`/invoices/${a.invoice}`,a,200,invoiceBody(a.customer,{company_id:b.companyId,balance:"99999"}));
    const payment = await expect("PUT",`/payments/${a.payment}`,a,200,paymentBody(a.customer,{company_id:b.companyId,created_by:b.id}));
    for (const record of [customer,invoice,payment]) assert.equal(String(record.company_id),String(a.companyId));
    assert.equal(invoice.balance,"100.00"); assert.equal(String(payment.created_by),String(a.id));
  });
  test("invoice/payment customer reassignment cannot cross the company boundary", async () => {
    const before = await financialState();
    await expect("PUT",`/invoices/${a.invoice}`,a,404,invoiceBody(b.customer));
    await expect("PUT",`/payments/${a.payment}`,a,404,paymentBody(b.customer));
    assert.deepEqual(await financialState(),before);
  });
  test("global admin can inspect both companies and explicitly narrow financial scope", async () => {
    const companies = await expect("GET","/admin/companies",global,200);
    for (const actor of [a,b]) {
      assert.ok(companies.some(company=>company.id===String(actor.companyId)));
      await expect("GET",`/admin/companies/${actor.companyId}`,global,200);
      for (const [path,key] of [["customers","customer"],["invoices","invoice"],["payments","payment"]]) {
        assert.ok((await expect("GET",`/${path}`,global,200)).some(row=>row.id===actor[key]));
        assert.deepEqual((await expect("GET",`/${path}?company_id=${actor.companyId}`,global,200)).map(row=>row.id),[actor[key]]);
      }
    }
    await expect("GET",`/invoices/${b.invoice}?company_id=${a.companyId}`,global,404);
    await expect("GET","/customers?company_id=invalid",global,400);
    await expect("GET","/customers?company_id=999999999",global,404);
  });
  test("company admin role alone cannot access global administration", async () => {
    await expect("GET","/admin/companies",a,403);
    await expect("GET",`/admin/companies/${b.companyId}`,a,403);
    await expect("GET","/admin/companies",null,401);
    await expect("GET","/admin/companies/999999999",global,404);
    await expect("GET","/admin/companies/bad",global,400);
    await expect("GET","/admin/roles",a,200);
    await expect("GET","/health",null,200);
  });
  test("NULL company never grants global scope to collector/supervisor or a roleless user", async () => {
    for (const actor of [unassigned,await user(null,"supervisor"),await user(null,null)]) {
      await expect("GET","/auth/me",actor,200);
      for (const path of ["/customers","/invoices","/payments","/portfolio?reference_date=2026-10-02","/portfolio/reconciliation","/collection?reference_date=2026-10-02"]) {
        await expect("GET",path,actor,403);
      }
      await expect("POST","/payments",actor,403,paymentBody(a.customer,{company_id:a.companyId}));
    }
  });
  test("JWT company claims cannot override current database context; reassignment applies next request", async () => {
    const claimed = jwt.sign({company_id:b.companyId,is_global_admin:true,roles:["admin"]},config.secret,
      {algorithm:"HS256",subject:String(a.id),issuer:config.issuer,audience:config.audience,expiresIn:config.accessSeconds});
    await expect("GET",`/customers/${b.customer}`,{token:claimed},404);
    await db.query("UPDATE users SET company_id=NULL WHERE id=?",[unassigned.id]);
    await expect("GET","/customers",unassigned,403);
    await db.query("UPDATE users SET company_id=? WHERE id=?",[b.companyId,unassigned.id]);
    assert.deepEqual((await expect("GET","/customers",unassigned,200)).map(row=>row.id),[b.customer]);
    await db.query("DELETE FROM user_roles WHERE user_id=?",[global.id]);
    await expect("GET","/customers",global,403);
    assert.equal((await expect("GET","/auth/me",global,200)).is_global_admin,false);
  });
  test("inactive or soft-deleted company blocks normal users while global inspection remains available", async () => {
    for (const change of ["status='inactive'","status='active',deleted_at=NOW()"]) {
      await db.query(`UPDATE companies SET ${change} WHERE id=?`,[a.companyId]);
      await expect("GET","/customers",a,403);
      await expect("GET","/auth/me",a,200);
      await expect("GET",`/customers/${a.customer}`,global,200);
    }
  });
  test("cross-company allocation attempts roll back and reveal neither the foreign invoice nor its balance", async () => {
    const before = await financialState();
    await expect("POST",`/payments/${a.payment}/allocations`,a,404,{invoice_id:b.invoice,amount:"10.00",company_id:a.companyId});
    await expect("POST",`/payments/${b.payment}/allocations`,a,404,{invoice_id:a.invoice,amount:"10.00"});
    await expect("DELETE",`/payments/${b.payment}/allocations/${b.allocation}`,a,404);
    await expect("POST",`/payments/${a.payment}/allocations`,global,409,{invoice_id:b.invoice,amount:"10.00"});
    // Known/corrupt IDs can even have the same customer: the company check must still reject them.
    await db.query("UPDATE invoices SET customer_id=? WHERE id=?",[a.customer,b.invoice]);
    await expect("POST",`/payments/${a.payment}/allocations`,global,409,{invoice_id:b.invoice,amount:"10.00"});
    await db.query("UPDATE invoices SET customer_id=? WHERE id=?",[b.customer,b.invoice]);
    const restored = await financialState();
    // The fixture's updated_at can change when restoring deliberately corrupt data.
    for (const state of [before,restored]) for (const invoice of state.invoices) delete invoice.updated_at;
    assert.deepEqual(restored,before);
  });
  test("own-company allocation/reversal/reallocation preserves balances and deleted-customer historical reversal", async () => {
    const allocation = await expect("POST",`/payments/${a.payment}/allocations`,a,201,{invoice_id:a.invoice,amount:"30.00"});
    assert.equal(allocation.invoice_balance,"70.00"); assert.equal(allocation.payment_available,"70.00");
    const reversed = await expect("DELETE",`/payments/${a.payment}/allocations/${allocation.id}`,a,200);
    assert.equal(reversed.invoice_balance,"100.00"); assert.equal(reversed.payment_available,"100.00");
    const next = await expect("POST",`/payments/${a.payment}/allocations`,a,201,{invoice_id:a.invoice,amount:"50.00"});
    assert.notEqual(next.id,allocation.id);
    await db.query("UPDATE customers SET status='inactive',deleted_at=NOW() WHERE id=?",[a.customer]);
    assert.equal((await expect("DELETE",`/payments/${a.payment}/allocations/${next.id}`,a,200)).invoice_balance,"100.00");
    assert.equal((await expect("GET",`/invoices/${b.invoice}`,b,200)).balance,"80.00");
  });
  test("concurrent own/foreign allocation requests cannot overspend or affect the other company", async () => {
    const second = await expect("POST","/invoices",a,201,invoiceBody(a.customer));
    const results = await Promise.all([a.invoice,second.id,b.invoice].map(invoice_id=>request("POST",`/payments/${a.payment}/allocations`,{token:a.token,body:{invoice_id,amount:"70.00"}})));
    assert.deepEqual(results.map(result=>result.status).sort(),[201,404,409]);
    assert.equal((await expect("GET",`/payments/${a.payment}`,a,200)).available_amount,"30.00");
    assert.equal((await expect("GET",`/invoices/${b.invoice}`,b,200)).balance,"80.00");
  });
  test("all five portfolio routes and filters isolate totals/reconciliation and remain read-only", async () => {
    await db.query("UPDATE invoices SET balance=71 WHERE id=?",[b.invoice]);
    const before = await financialState();
    for (const actor of [a,b]) {
      const reference = "reference_date=2026-10-02";
      const invoices = await expect("GET",`/portfolio?${reference}`,actor,200);
      assert.deepEqual(invoices.map(row=>row.invoice_id),[actor.invoice]); assert.equal(invoices[0].days_overdue,0);
      const totals = await expect("GET",`/portfolio/summary?${reference}`,actor,200);
      assert.equal(totals.total_balance,actor===a?"100.00":"71.00");
      assert.deepEqual((await expect("GET",`/portfolio/customers?${reference}`,actor,200)).map(row=>row.customer_id),[actor.customer]);
      const detail = await expect("GET",`/portfolio/customer/${actor.customer}?${reference}`,actor,200);
      assert.deepEqual(detail.invoices.map(row=>row.invoice_id),[actor.invoice]);
      assert.deepEqual((await expect("GET","/portfolio/reconciliation",actor,200)).map(row=>row.invoice_id),actor===a?[]:[b.invoice]);
      assert.deepEqual(await expect("GET",`/portfolio?${reference}&overdue=true`,actor,200),[]);
      assert.deepEqual(await expect("GET",`/portfolio?${reference}&customer_id=${actor===a?b.customer:a.customer}`,actor,200),[]);
    }
    const globalTotals = await expect("GET",`/portfolio/summary?reference_date=2026-10-02&company_id=${a.companyId}`,global,200);
    assert.equal(globalTotals.total_balance,"100.00"); assert.deepEqual(await financialState(),before);
  });
  test("inconsistent historical joins cannot expose or mutate foreign customer/invoice data", async () => {
    await db.query("UPDATE invoices SET customer_id=? WHERE id=?",[b.customer,a.invoice]);
    await db.query("UPDATE payments SET customer_id=? WHERE id=?",[b.customer,a.payment]);
    assert.deepEqual(await expect("GET","/invoices",a,200),[]); assert.deepEqual(await expect("GET","/payments",a,200),[]);
    await expect("GET",`/invoices/${a.invoice}`,a,404); await expect("GET",`/payments/${a.payment}`,a,404);
    await expect("PUT",`/invoices/${a.invoice}`,a,404,invoiceBody(a.customer));
    await expect("PUT",`/payments/${a.payment}`,a,404,paymentBody(a.customer));
    await expect("DELETE",`/invoices/${a.invoice}`,a,404);
    await expect("POST",`/payments/${a.payment}/allocations`,a,404,{invoice_id:b.invoice,amount:"10.00"});
    assert.deepEqual(await expect("GET","/portfolio?reference_date=2026-10-02",a,200),[]);
    await db.query("UPDATE payments SET customer_id=? WHERE id=?",[a.customer,a.payment]);
    const [corrupt] = await db.query("INSERT INTO payment_allocations (payment_id,invoice_id,amount) VALUES (?,?,5)",[a.payment,b.invoice]);
    const before = await financialState();
    assert.deepEqual(await expect("GET",`/payments/${a.payment}/allocations`,a,200),[]);
    await expect("DELETE",`/payments/${a.payment}/allocations/${corrupt.insertId}`,a,404);
    assert.deepEqual(await financialState(),before);
  });
  test("company settings/templates/rules never inherit legacy global commercial configuration", async () => {
    const rulesA=[{key:"configured_reminder",active:true,days_before_due:2}];
    const rulesB=[{key:"configured_reminder",active:true,days_before_due:4}];
    await db.query("INSERT INTO settings (company_id,setting_key,setting_value,value_type) VALUES (NULL,'collection_rules',?,'json'),(?,'collection_rules',?,'json'),(?,'collection_rules',?,'json')",[JSON.stringify(rulesB),a.companyId,JSON.stringify(rulesA),b.companyId,JSON.stringify(rulesB)]);
    for (const companyId of [null,a.companyId,b.companyId]) await db.query("INSERT INTO message_templates (company_id,name,channel,stage,content) VALUES (?,'Fixture','email','configured_reminder','Fixture content')",[companyId]);
    assert.deepEqual(await loadCompanyCollectionRules(a.companyId,db),rulesA); assert.deepEqual(await loadCompanyCollectionRules(b.companyId,db),rulesB);
    const [emptyCompany]=await db.query("INSERT INTO companies (name) VALUES ('Empty settings fixture')");
    assert.deepEqual(await loadCompanyCollectionRules(emptyCompany.insertId,db),[]);
    assert.equal((await getCompanySettings(a.companyId,db)).length,1);
    const templates=await getCompanyMessageTemplates(a.companyId,{channel:"email",stage:"configured_reminder"},db);
    assert.equal(templates.length,1); assert.equal(templates[0].company_id,a.companyId);
    assert.deepEqual(await getCompanyMessageTemplates(a.companyId,{channel:"whatsapp"},db),[]);
    await assert.rejects(getCompanyMessageTemplates(null,{},db)); await assert.rejects(getCompanySettings(null,db));
    const input={company:{id:a.companyId},referenceDate:"2026-10-02",customers:[{id:a.customer,company_id:a.companyId}],
      invoices:[{id:a.invoice,company_id:a.companyId,customer_id:a.customer,due_date:"2026-10-04",balance:"100.00"}]};
    assert.equal(evaluateCompanyCollection({...input,rules:rulesA})[0].eligible,true);
    assert.equal(evaluateCompanyCollection({...input,rules:rulesB})[0].eligible,false);
    assert.throws(()=>evaluateCompanyCollection({...input,rules:rulesA,invoices:[{...input.invoices[0],company_id:b.companyId}]}));
  });
  test("collection endpoint groups authorized pending invoices, honors configured rules and stays read-only", async () => {
    const rules = [
      { key: "two_days_before", active: true, days_before_due: 2 },
      { key: "overdue", active: true, condition: "overdue" },
    ];
    await db.query("INSERT INTO settings (company_id,setting_key,setting_value,value_type) VALUES (?, 'collection_rules', ?, 'json')", [a.companyId, JSON.stringify(rules)]);
    await db.query("INSERT INTO settings (company_id,setting_key,setting_value,value_type) VALUES (?, 'collection_rules', ?, 'json')", [b.companyId, JSON.stringify(rules)]);
    const [promiseA] = await db.query("INSERT INTO payment_promises (company_id,customer_id,invoice_id,created_by,promised_date,promised_amount,status) VALUES (?,?,?,?,'2026-10-08',20,'pending')", [a.companyId, a.customer, a.invoice, a.id]);
    const [promiseB] = await db.query("INSERT INTO payment_promises (company_id,customer_id,invoice_id,created_by,promised_date,promised_amount,status) VALUES (?,?,?,?,'2026-10-09',30,'pending')", [b.companyId, b.customer, b.invoice, b.id]);
    const [noDue] = await db.query("INSERT INTO invoices (company_id,customer_id,invoice_number,document_value,base_value,iva_value,balance,due_date) VALUES (?,?,'no-due',25,25,0,25,NULL)", [a.companyId, a.customer]);
    const [zero] = await db.query("INSERT INTO invoices (company_id,customer_id,invoice_number,document_value,base_value,iva_value,balance,due_date) VALUES (?,?,'zero',0,0,0,0,'2026-09-30')", [a.companyId, a.customer]);
    const untouched = await financialState();
    const activityCounts = async () => {
      const counts = {};
      for (const table of ["collection_actions", "messages", "payment_promises"]) {
        const [[row]] = await db.query(`SELECT COUNT(*) AS total FROM \`${table}\``); counts[table] = row.total;
      }
      return counts;
    };
    const beforeActivities = await activityCounts();
    const path = "/collection?reference_date=2026-10-02";
    const response = await expect("GET", path, a, 200);
    assert.equal(response.reference_date, "2026-10-02");
    assert.equal(response.status, "ready");
    assert.equal(response.summary.total_balance, "125.00");
    assert.equal(response.summary.eligible_balance, "100.00");
    assert.equal(response.customers.length, 1);
    assert.equal(response.customers[0].stage, "two_days_before");
    assert.equal(String(response.customers[0].current_promise.id), String(promiseA.insertId));
    assert.equal(response.customers[0].total_balance, "125.00");
    assert.equal(response.customers[0].eligible_balance, "100.00");
    assert.equal(response.customers[0].invoices.length, 2);
    assert.equal(response.customers[0].invoices.find(item => item.invoice.invoice_id === noDue.insertId).stage, "no_eligible");
    assert.equal(response.customers[0].invoices.some(item => item.invoice.invoice_id === zero.insertId), false);
    assert.deepEqual(await expect("GET", `/collection?reference_date=2026-10-02&company_id=${b.companyId}`, a, 200), response);
    assert.deepEqual(await expect("GET", `/collection?reference_date=2026-10-02&company_id=${a.companyId}`, global, 200), response);
    const companyBResponse = await expect("GET", `/collection?reference_date=2026-10-02`, b, 200);
    assert.equal(String(companyBResponse.customers[0].current_promise.id), String(promiseB.insertId));
    assert.equal((await request("GET", "/collection", { token: a.token })).status, 400);
    assert.equal((await request("GET", "/collection?reference_date=2026-02-30", { token: a.token })).status, 400);
    assert.deepEqual(await financialState(), untouched);
    assert.deepEqual(await activityCounts(), beforeActivities);
  });
  test("collection rejects missing permission and requires explicit company scope for a global admin", async () => {
    const roleless = await user(a.companyId, null);
    assert.equal((await request("GET", "/collection?reference_date=2026-10-02", { token: roleless.token })).status, 403);
    assert.equal((await request("GET", "/collection?reference_date=2026-10-02", { token: global.token })).status, 400);
    const collector = await user(a.companyId, "collector");
    assert.equal((await request("GET", "/collection?reference_date=2026-10-02", { token: collector.token })).status, 200);
  });
  test("4.8 HTTP contract reads versioned policy, oldest invoice and pending prompt assessment without writes", async () => {
    const policy = { version: 2, stage_order: ["overdue", "due_today", "days_before_due", "prompt_payment"], rules: [
      { key: "overdue", active: true }, { key: "due_today", active: true },
      { key: "five_days_before_due", active: true, days_before_due: 5 },
      { key: "prompt_payment", active: true, condition: "days_since_issue" },
    ], prompt_payment: { window: { day_type: "pending", include_issue_date: null, include_day_ten: null } } };
    await db.query("INSERT INTO settings (company_id,setting_key,setting_value,value_type) VALUES (?,'collection_rules',?,'json')", [a.companyId, JSON.stringify(policy)]);
    const [oldest] = await db.query("INSERT INTO invoices (company_id,customer_id,invoice_number,issue_date,due_date,document_value,base_value,iva_value,balance) VALUES (?,?,'oldest','2026-08-01','2026-09-01',119,100,19,119)", [a.companyId, a.customer]);
    const beforeState = await financialState();
    const result = await expect("GET", "/collection?reference_date=2026-10-05", a, 200);
    assert.equal(result.customers.length, 1); assert.equal(result.customers[0].main_invoice.invoice.invoice_id, oldest.insertId);
    assert.equal(result.customers[0].priority, 4); assert.equal(result.priority_basis, "stage_order_ordinal");
    assert.equal(result.stage_catalog[0].label, "En mora"); assert.equal(result.stage_catalog[2].label, "Faltan 5 días");
    assert.equal(result.customers[0].main_invoice.prompt_payment.window.reference_basis, "issue_date");
    assert.equal(result.customers[0].main_invoice.prompt_payment.eligibility.status, "pending_configuration");
    assert.equal(result.customers[0].main_invoice.prompt_payment.discount.amount, null);
    assert.match(result.configuration_warnings[0], /pendiente/);
    assert.deepEqual(await financialState(), beforeState);
    assert.deepEqual(await expect("GET", `/collection?reference_date=2026-10-05&company_id=${b.companyId}`, a, 200), result);
  });
  test("collection does not inherit legacy NULL rules and reports missing company configuration", async () => {
    await db.query("INSERT INTO settings (company_id,setting_key,setting_value,value_type) VALUES (NULL,'collection_rules',?,'json')", [JSON.stringify([{ key: "legacy", active: true, priority: 999, condition: "overdue" }])]);
    const result = await expect("GET", "/collection?reference_date=2026-10-02", a, 200);
    assert.equal(result.status, "no_rules_configured");
    assert.equal(result.rules_configured, false);
    assert.match(result.message, /No hay reglas/);
    assert.deepEqual(result.customers, []);
  });
  test("phase 5 HTTP uses official company configuration, exposes independent benefits and pending invoices without financial writes", async () => {
    const policy = JSON.parse(await readFile(new URL("../config/mertel-collection-rules.json", import.meta.url), "utf8"));
    await db.query("INSERT INTO settings (company_id,setting_key,setting_value,value_type) VALUES (?,'collection_rules',?,'json')", [a.companyId, JSON.stringify(policy)]);
    await db.query("UPDATE invoices SET issue_date='2026-10-05',due_date='2026-11-05',base_value=100 WHERE id=?", [a.invoice]);
    const [older] = await db.query("INSERT INTO invoices (company_id,customer_id,invoice_number,issue_date,due_date,document_value,base_value,iva_value,balance) VALUES (?,?,'conditional','2026-08-16','2026-11-05',119,100,19,119)", [a.companyId, a.customer]);
    const beforeState = await financialState();
    const result = await expect("GET", "/collection?reference_date=2026-10-15", a, 200);
    assert.equal(result.customers.length, 1); assert.equal(result.customers[0].stage, "prompt_payment");
    assert.equal(result.customers[0].main_invoice.prompt_payment.window.end_date, "2026-10-15");
    assert.equal(result.customers[0].main_invoice.prompt_payment.eligibility.status, "manual_review");
    assert.equal(result.customers[0].main_invoice.prompt_payment.discount.preview_amount, null);
    const conditioned = result.non_overdue_pending.invoices.find(item => item.invoice.invoice_id === older.insertId);
    assert.equal(conditioned.conditional_discount.eligibility.status, "eligible");
    assert.equal(conditioned.benefits.combination.combined_amount, null);
    const afterWindow = await expect("GET", "/collection?reference_date=2026-10-16", a, 200);
    assert.equal(afterWindow.customers.length, 0); assert.equal(afterWindow.non_overdue_pending.customers.length, 1);
    assert.equal(afterWindow.non_overdue_pending.invoices.length, 2);
    assert.deepEqual(await expect("GET", `/collection?reference_date=2026-10-15&company_id=${b.companyId}`, a, 200), result);
    const foreign = await expect("GET", "/collection?reference_date=2026-10-15", b, 200);
    assert.equal(foreign.status, "no_rules_configured");
    assert.deepEqual(await financialState(), beforeState);
  });
  test("authentication audits retain real company context and global events retain NULL", async () => {
    const [rows]=await db.query("SELECT company_id,user_id FROM audit_logs WHERE action='login_success' AND user_id IN (?,?,?)",[a.id,b.id,global.id]);
    const context=new Map(rows.map(row=>[String(row.user_id),row.company_id]));
    assert.equal(context.get(String(a.id)),a.companyId); assert.equal(context.get(String(b.id)),b.companyId); assert.equal(context.get(String(global.id)),null);
  });
  test("global scope preserves legacy NULL data without assigning it; global writes respect real companies", async () => {
    const [legacy]=await db.query("INSERT INTO customers (nit,name) VALUES (?,'Unassigned legacy fixture')",[randomUUID()]);
    await expect("GET",`/customers/${legacy.insertId}`,a,404); await expect("GET",`/customers/${legacy.insertId}`,global,200);
    await expect("POST","/customers",global,400,customerBody());
    await expect("POST","/customers",global,404,customerBody({company_id:999999999}));
    const created=await expect("POST","/customers",global,201,customerBody({company_id:b.companyId})); assert.equal(created.company_id,b.companyId);
    const inferred=await expect("POST","/invoices",global,201,invoiceBody(a.customer)); assert.equal(inferred.company_id,a.companyId);
    const legacyInvoice=await expect("POST","/invoices",global,201,invoiceBody(legacy.insertId)); assert.equal(legacyInvoice.company_id,null);
    await expect("POST","/invoices",global,409,invoiceBody(a.customer,{company_id:b.companyId}));
    for(const [path,key,body] of [["customers","customer",customerBody({company_id:b.companyId})],["invoices","invoice",invoiceBody(a.customer,{company_id:b.companyId})],["payments","payment",paymentBody(a.customer,{company_id:b.companyId})]]) {
      await expect("PUT",`/${path}/${a[key]}`,global,409,body);
    }
    const [[unchanged]]=await db.query("SELECT company_id FROM customers WHERE id=?",[legacy.insertId]); assert.equal(unchanged.company_id,null);
  });
  test("adjacent BIGINT company IDs cannot compare equal through JavaScript number rounding", async () => {
    const left="9007199254740992"; const right="9007199254740993";
    await db.query("INSERT INTO companies (id,name) VALUES (?,'Large ID fixture A'),(?,'Large ID fixture B')",[left,right]);
    const [customer]=await db.query("INSERT INTO customers (company_id,nit,name) VALUES (?,?,'Large company customer')",[left,randomUUID()]);
    const invoice=await expect("POST","/invoices",global,201,invoiceBody(customer.insertId));
    const payment=await expect("POST","/payments",global,201,paymentBody(customer.insertId));
    const [[stored]]=await db.query("SELECT CAST(company_id AS CHAR) AS company_id FROM invoices WHERE id=?",[invoice.id]);
    assert.equal(stored.company_id,left);
    const [foreign]=await db.query("INSERT INTO invoices (company_id,customer_id,invoice_number,document_value,base_value,iva_value,balance) VALUES (?,?,?,100,100,0,100)",[right,customer.insertId,randomUUID()]);
    await expect("POST",`/payments/${payment.id}/allocations`,global,409,{invoice_id:foreign.insertId,amount:"10.00"});
    assert.equal((await expect("GET",`/payments/${payment.id}`,global,200)).available_amount,"100.00");
    assert.deepEqual((await expect("GET",`/invoices?company_id=${left}`,global,200)).map(row=>row.id),[invoice.id]);
  });
});
