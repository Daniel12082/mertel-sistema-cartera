import pool from "../config/database.js";
import { companyFilter, validCompanyId } from "../utils/companyScope.js";
import { operationId, operationError } from "./collectionOperations.validation.js";

const PAGE_SIZE_MAX = 100;
const TYPES = new Set(["action", "promise", "configuration", "import"]);
function normalizePage(page, limit) {
  const validInteger = value => typeof value === "string" && /^\d{1,6}$/.test(value);
  if ((page !== undefined && !validInteger(page)) || (limit !== undefined && !validInteger(limit))) throw operationError(400, "page y limit deben ser enteros positivos.");
  const parsedPage = page === undefined ? 1 : Number(page);
  const parsedLimit = limit === undefined ? 20 : Number(limit);
  if (!Number.isSafeInteger(parsedPage) || parsedPage < 1 || parsedPage > 100000 || !Number.isSafeInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > PAGE_SIZE_MAX) {
    throw operationError(400, "page debe ser positivo y limit debe estar entre 1 y 100.");
  }
  return { page: parsedPage, limit: parsedLimit, offset: (parsedPage - 1) * parsedLimit };
}
function normalizeType(type, allowed) {
  if (type === undefined || type === "all") return null;
  if (!allowed.has(type)) throw operationError(400, "type no es un tipo de evento disponible.");
  return type;
}
function toIso(value) { return value == null ? null : new Date(Number(value)).toISOString(); }
function actionSelect({ company, customerId, type, dateFrom, dateTo, actorId, query, includeFinancialEvents = false }) {
  const values = [customerId, ...company.values];
  let where = `a.customer_id=? ${company.sql} AND (a.invoice_id IS NULL OR i.id IS NOT NULL)`;
  if (type && type !== "action") return null;
  if (dateFrom) { where += " AND DATE(a.action_date)>=?"; values.push(dateFrom); }
  if (dateTo) { where += " AND DATE(a.action_date)<=?"; values.push(dateTo); }
  if (actorId) { where += includeFinancialEvents ? " AND (a.user_id=? OR a.action_type IN ('PAYMENT_REPORTED','PAYMENT_REGISTERED','PARTIAL_PAYMENT','PAYMENT_CONFIRMED','PAYMENT_REJECTED'))" : " AND a.user_id=?"; values.push(actorId); }
  if (query) { where += " AND (c.name LIKE ? OR c.nit LIKE ? OR i.invoice_number LIKE ? OR CONCAT_WS(' ',u.first_name,u.last_name) LIKE ? OR a.action_type LIKE ?)"; values.push(...Array(5).fill(`%${query}%`)); }
  return { sql: `SELECT CONCAT('action:',a.id) AS id,'action' AS type,UNIX_TIMESTAMP(a.action_date)*1000 AS occurred_ms,CONCAT(DATE_FORMAT(a.action_date,'%Y-%m-%dT%H:%i:%s'),'Z') AS occurred_at,
    CONCAT_WS(' ',u.first_name,u.last_name) AS actor,c.name AS customer_name,c.nit AS customer_nit,i.invoice_number,
    a.action_type AS title,a.description,a.status,NULL AS promised_date,NULL AS amount,NULL AS notes,
    NULL AS old_values,NULL AS new_values,NULL AS file_name,NULL AS total_rows,NULL AS failed_rows
    FROM collection_actions a JOIN customers c ON c.id=a.customer_id
    LEFT JOIN invoices i ON i.id=a.invoice_id AND i.customer_id=a.customer_id AND i.company_id=a.company_id
    LEFT JOIN users u ON u.id=a.user_id AND (u.company_id=a.company_id OR u.company_id IS NULL) WHERE ${where}`, values };
}

function promiseSelect({ company, customerId, type, dateFrom, dateTo, actorId, query }) {
  const values = [customerId, ...company.values];
  let where = `p.customer_id=? ${company.sql} AND (p.invoice_id IS NULL OR i.id IS NOT NULL)`;
  if (type && type !== "promise") return null;
  if (dateFrom) { where += " AND DATE(p.created_at)>=?"; values.push(dateFrom); }
  if (dateTo) { where += " AND DATE(p.created_at)<=?"; values.push(dateTo); }
  if (actorId) { where += " AND p.created_by=?"; values.push(actorId); }
  if (query) { where += " AND (c.name LIKE ? OR c.nit LIKE ? OR i.invoice_number LIKE ? OR CONCAT_WS(' ',u.first_name,u.last_name) LIKE ?)"; values.push(...Array(4).fill(`%${query}%`)); }
  return { sql: `SELECT CONCAT('promise:',p.id) AS id,'promise' AS type,UNIX_TIMESTAMP(p.created_at)*1000 AS occurred_ms,NULL AS occurred_at,
    CONCAT_WS(' ',u.first_name,u.last_name) AS actor,c.name AS customer_name,c.nit AS customer_nit,i.invoice_number,
    'Promesa de pago' AS title,NULL AS description,p.status,DATE_FORMAT(p.promised_date,'%Y-%m-%d') AS promised_date,
    CAST(p.promised_amount AS CHAR) AS amount,p.notes,NULL AS old_values,NULL AS new_values,NULL AS file_name,NULL AS total_rows,NULL AS failed_rows
    FROM payment_promises p JOIN customers c ON c.id=p.customer_id
    LEFT JOIN invoices i ON i.id=p.invoice_id AND i.customer_id=p.customer_id AND i.company_id=p.company_id
    LEFT JOIN users u ON u.id=p.created_by AND (u.company_id=p.company_id OR u.company_id IS NULL) WHERE ${where}`, values };
}

function eventView(row) {
  const resultTitles = { CONTACTED:'Cliente contactado',WHATSAPP:'WhatsApp informado por el cobrador',PROMISE:'Promesa de pago',NO_RESPONSE:'Cliente no responde',INCONSISTENCY:'Inconsistencia reportada',WRONG_NUMBER:'Número incorrecto',OTHER:'Otra gestión',PAYMENT_REPORTED:'Pago reportado',PAYMENT_REGISTERED:'Pago registrado',PARTIAL_PAYMENT:'Pago parcial registrado',PAYMENT_CONFIRMED:'Pago confirmado',PAYMENT_REJECTED:'Pago reportado rechazado' };
  const base = { id: String(row.id), type: row.type, occurred_at: row.occurred_at || toIso(row.occurred_ms), actor: row.actor || null,
    customer: row.customer_name ? { name: row.customer_name, identification: row.customer_nit || null } : null,
    invoice: row.invoice_number || null, title: row.type === 'action' ? resultTitles[row.title] || row.title : row.title };
  if (row.type === "action") return { ...base, description: row.description || null, status: row.status || null, metadata: { action_type: row.title } };
  if (row.type === "promise") return { ...base, description: row.notes || null, status: row.status || null,
    metadata: { promised_date: row.promised_date, amount: row.amount } };
  if (row.type === 'message') return { ...base, description: row.description, status: row.status, metadata: {} };
  if (row.type === 'financial') {
    const value=typeof row.new_values==='string'?JSON.parse(row.new_values):row.new_values;
    const metadata={};
    for(const key of ['actor_type','triggered_by','correlation_id','payment_id','allocation_id','amount','old_balance','new_balance','total_balance_before','total_balance_after','stage_before','stage_after']) if(value?.[key]!==undefined)metadata[key]=value[key];
    return {...base,description:value?.description||null,status:null,metadata};
  }
  if (row.type === "configuration") return { ...base, description: row.description, status: row.status,
    metadata: { before: safeStages(row.old_values), after: safeStages(row.new_values) } };
  return { ...base, description: row.description, status: row.status,
    metadata: { file_name: row.file_name, total_rows: row.total_rows, failed_rows: row.failed_rows } };
}

function messageSelect({ companyId, customerId, type }) {
  if (type && type !== 'message') return null;
  return { sql: `SELECT CONCAT('message:',a.id) AS id,'message' AS type,UNIX_TIMESTAMP(a.created_at)*1000 AS occurred_ms,NULL AS occurred_at,
    CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(a.new_values,'$.actor_type'))='SYSTEM' THEN 'SYSTEM' ELSE CONCAT_WS(' ',u.first_name,u.last_name) END AS actor,c.name AS customer_name,c.nit AS customer_nit,i.invoice_number,
    CASE a.action WHEN 'sent' THEN 'Mensaje enviado' WHEN 'delivered' THEN 'Mensaje entregado' WHEN 'read' THEN 'Mensaje leído'
      WHEN 'incoming' THEN 'Respuesta recibida' WHEN 'failed' THEN 'Mensaje fallido' WHEN 'cancelled' THEN 'Mensaje cancelado' ELSE 'Mensaje en cola' END AS title,
    m.content AS description,a.action AS status,NULL AS promised_date,NULL AS amount,NULL AS notes,
    NULL AS old_values,NULL AS new_values,NULL AS file_name,NULL AS total_rows,NULL AS failed_rows
    FROM audit_logs a JOIN messages m ON m.id=a.entity_id AND m.company_id=a.company_id
    JOIN customers c ON c.id=m.customer_id AND c.company_id=m.company_id
    LEFT JOIN invoices i ON i.id=m.invoice_id AND i.company_id=m.company_id AND i.customer_id=m.customer_id
    LEFT JOIN users u ON u.id=a.user_id WHERE a.company_id=? AND m.customer_id=? AND a.entity_type='whatsapp_message'`,
    values: [companyId, customerId] };
}

function financialSelect({companyId,customerId,type}){
  if(type&&type!=='financial')return null;
  return {sql:`SELECT CONCAT('financial:',LPAD(a.id,20,'0')) AS id,'financial' AS type,UNIX_TIMESTAMP(a.created_at)*1000 AS occurred_ms,NULL AS occurred_at,
    CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(a.new_values,'$.actor_type'))='SYSTEM' THEN 'SYSTEM' ELSE CONCAT_WS(' ',u.first_name,u.last_name) END AS actor,
    c.name AS customer_name,c.nit AS customer_nit,i.invoice_number,
    CASE a.action WHEN 'allocation_created' THEN 'Pago asignado a factura' WHEN 'balance_updated' THEN 'Saldo actualizado' WHEN 'invoice_settled' THEN 'Factura saldada'
      WHEN 'pipeline_recalculated' THEN 'Cobranza recalculada' WHEN 'pipeline_exited' THEN 'Cliente fuera del pipeline' WHEN 'automatic_collection_blocked' THEN 'Cobranza automática bloqueada' END AS title,
    NULL AS description,NULL AS status,NULL AS promised_date,NULL AS amount,NULL AS notes,NULL AS old_values,a.new_values,NULL AS file_name,NULL AS total_rows,NULL AS failed_rows
    FROM audit_logs a JOIN customers c ON c.company_id=a.company_id AND CAST(c.id AS CHAR)=JSON_UNQUOTE(JSON_EXTRACT(a.new_values,'$.customer_id'))
    LEFT JOIN invoices i ON CAST(i.id AS CHAR)=JSON_UNQUOTE(JSON_EXTRACT(a.new_values,'$.invoice_id')) AND i.customer_id=c.id AND i.company_id=a.company_id
    LEFT JOIN users u ON u.id=a.user_id AND (u.company_id=a.company_id OR u.company_id IS NULL)
    WHERE a.company_id=? AND c.id=? AND a.entity_type IN ('payment_allocation','invoice','collection_pipeline')
      AND a.action IN ('allocation_created','balance_updated','invoice_settled','pipeline_recalculated','pipeline_exited','automatic_collection_blocked')`,values:[companyId,customerId]};
}

function safeStages(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(parsed?.stages)) return null;
    return parsed.stages.filter(item => typeof item?.key === "string" && typeof item?.active === "boolean")
      .map(item => ({ key: item.key, active: item.active }));
  } catch { return null; }
}

function pagination(page, limit, total) { return { page, limit, total, pages: Math.ceil(total / limit), has_next: page * limit < total, has_previous: page > 1 }; }

export async function getCustomerCollectionHistory({ customerId, scope, page, limit, type, ownUserOnly = false }, dbPool = pool) {
  customerId = operationId(customerId, "customer_id");
  if (!validCompanyId(scope?.companyId)) throw operationError(scope?.globalAdmin ? 400 : 403, "Se requiere empresa para consultar el historial.");
  const paging = normalizePage(page, limit); const selectedType = normalizeType(type, new Set(["action", "promise", "message", "financial"]));
  const db = await dbPool.getConnection();
  try {
    await db.query("START TRANSACTION READ ONLY");
    const company = companyFilter(scope, "c.company_id");
    const [customers] = await db.query(`SELECT c.id FROM customers c WHERE c.id=? AND c.deleted_at IS NULL ${company.sql}`, [customerId, ...company.values]);
    if (!customers.length) throw operationError(404, "Cliente no encontrado.");
    const action = actionSelect({ company: companyFilter(scope, "a.company_id", "c.company_id"), customerId, type: selectedType,
      ...(ownUserOnly ? { actorId: scope.actorId, includeFinancialEvents: true } : {}) });
    const promise = promiseSelect({ company: companyFilter(scope, "p.company_id", "c.company_id"), customerId, type: selectedType,
      ...(ownUserOnly ? { actorId: scope.actorId } : {}) });
    const message = messageSelect({ companyId: scope.companyId, customerId, type: selectedType });
    const financial = financialSelect({companyId:scope.companyId,customerId,type:selectedType});
    const sources = [action, promise, message, financial].filter(Boolean);
    const union = sources.map(source => source.sql).join(" UNION ALL ");
    const [rows] = await db.query(`SELECT * FROM (${union}) events ORDER BY occurred_ms DESC,id DESC LIMIT ? OFFSET ?`, [...sources.flatMap(source => source.values), paging.limit + 1, paging.offset]);
    const hasNext = rows.length > paging.limit; const events = rows.slice(0, paging.limit).map(eventView);
    const countUnion = sources.map(source => `SELECT COUNT(*) AS total FROM (${source.sql}) source_rows`).join(" UNION ALL ");
    const [[countRow]] = await db.query(`SELECT COALESCE(SUM(total),0) AS total FROM (${countUnion}) counts`, sources.flatMap(source => source.values));
    const total = Number(countRow.total);
    await db.commit();
    return { events, pagination: { ...pagination(paging.page, paging.limit, total), has_next: hasNext } };
  } catch (error) { try { await db.rollback(); } catch { /* preserve original */ } throw error; }
  finally { db.release(); }
}

function globalSelects({ companyId, type, dateFrom, dateTo, actorId, query }) {
  const defs = [];
  const filter = (alias, companyColumn, actorColumn, timeColumn, customerAlias = "c", invoiceAlias = "i", userAlias = "u") => {
    const values = [companyId]; let sql = `${alias}.${companyColumn}=?`;
    if (dateFrom) { sql += ` AND DATE(${timeColumn})>=?`; values.push(dateFrom); }
    if (dateTo) { sql += ` AND DATE(${timeColumn})<=?`; values.push(dateTo); }
    if (actorId) { sql += ` AND ${alias}.${actorColumn}=?`; values.push(actorId); }
    if (query) { sql += ` AND (${customerAlias}.name LIKE ? OR ${customerAlias}.nit LIKE ? OR ${invoiceAlias}.invoice_number LIKE ? OR CONCAT_WS(' ',${userAlias}.first_name,${userAlias}.last_name) LIKE ?)`; values.push(...Array(4).fill(`%${query}%`)); }
    return { sql, values };
  };
  if (!type || type === "action") {
    const where = filter("a", "company_id", "user_id", "a.action_date");
    defs.push({ sql: `SELECT CONCAT('action:',a.id) AS id,'action' AS type,UNIX_TIMESTAMP(a.action_date)*1000 AS occurred_ms,CONCAT(DATE_FORMAT(a.action_date,'%Y-%m-%dT%H:%i:%s'),'Z') AS occurred_at,CONCAT_WS(' ',u.first_name,u.last_name) AS actor,c.name AS customer_name,c.nit AS customer_nit,i.invoice_number,a.action_type AS title,a.description,a.status,NULL AS promised_date,NULL AS amount,NULL AS notes,NULL AS old_values,NULL AS new_values,NULL AS file_name,NULL AS total_rows,NULL AS failed_rows FROM collection_actions a JOIN customers c ON c.id=a.customer_id AND c.company_id=a.company_id LEFT JOIN invoices i ON i.id=a.invoice_id AND i.customer_id=a.customer_id AND i.company_id=a.company_id LEFT JOIN users u ON u.id=a.user_id AND (u.company_id=a.company_id OR u.company_id IS NULL) WHERE ${where.sql}`, values: where.values });
  }
  if (!type || type === "promise") {
    const where = filter("p", "company_id", "created_by", "p.created_at");
    defs.push({ sql: `SELECT CONCAT('promise:',p.id) AS id,'promise' AS type,UNIX_TIMESTAMP(p.created_at)*1000 AS occurred_ms,NULL AS occurred_at,CONCAT_WS(' ',u.first_name,u.last_name) AS actor,c.name AS customer_name,c.nit AS customer_nit,i.invoice_number,'Promesa de pago' AS title,NULL AS description,p.status,DATE_FORMAT(p.promised_date,'%Y-%m-%d') AS promised_date,CAST(p.promised_amount AS CHAR) AS amount,p.notes,NULL AS old_values,NULL AS new_values,NULL AS file_name,NULL AS total_rows,NULL AS failed_rows FROM payment_promises p JOIN customers c ON c.id=p.customer_id AND c.company_id=p.company_id LEFT JOIN invoices i ON i.id=p.invoice_id AND i.customer_id=p.customer_id AND i.company_id=p.company_id LEFT JOIN users u ON u.id=p.created_by AND (u.company_id=p.company_id OR u.company_id IS NULL) WHERE ${where.sql}`, values: where.values });
  }
  if (!type || type === "configuration") {
    const values = [companyId]; let where = "a.company_id=? AND a.entity_type='setting' AND a.action='update' AND s.setting_key='collection_rules'";
    if (dateFrom) { where += " AND DATE(a.created_at)>=?"; values.push(dateFrom); }
    if (dateTo) { where += " AND DATE(a.created_at)<=?"; values.push(dateTo); }
    if (actorId) { where += " AND a.user_id=?"; values.push(actorId); }
    if (query) { where += " AND (CONCAT_WS(' ',u.first_name,u.last_name) LIKE ? OR 'configuracion' LIKE ?)"; values.push(`%${query}%`, `%${query}%`); }
    defs.push({ sql: `SELECT CONCAT('configuration:',a.id) AS id,'configuration' AS type,UNIX_TIMESTAMP(a.created_at)*1000 AS occurred_ms,NULL AS occurred_at,CONCAT_WS(' ',u.first_name,u.last_name) AS actor,NULL AS customer_name,NULL AS customer_nit,NULL AS invoice_number,'Configuración de cobranza' AS title,'Se actualizaron las etapas operativas de cobranza.' AS description,a.action AS status,NULL AS promised_date,NULL AS amount,NULL AS notes,a.old_values,a.new_values,NULL AS file_name,NULL AS total_rows,NULL AS failed_rows FROM audit_logs a JOIN settings s ON s.id=a.entity_id LEFT JOIN users u ON u.id=a.user_id AND (u.company_id=a.company_id OR u.company_id IS NULL) WHERE ${where}`, values });
  }
  if (!type || type === "import") {
    const values = [companyId]; let where = "b.company_id=?";
    if (dateFrom) { where += " AND DATE(b.created_at)>=?"; values.push(dateFrom); }
    if (dateTo) { where += " AND DATE(b.created_at)<=?"; values.push(dateTo); }
    if (actorId) { where += " AND b.user_id=?"; values.push(actorId); }
    if (query) { where += " AND (b.file_name LIKE ? OR CONCAT_WS(' ',u.first_name,u.last_name) LIKE ?)"; values.push(`%${query}%`, `%${query}%`); }
    defs.push({ sql: `SELECT CONCAT('import:',b.id) AS id,'import' AS type,UNIX_TIMESTAMP(b.created_at)*1000 AS occurred_ms,NULL AS occurred_at,CONCAT_WS(' ',u.first_name,u.last_name) AS actor,NULL AS customer_name,NULL AS customer_nit,NULL AS invoice_number,'Análisis de importación' AS title,'El análisis estructural no aplica cambios a la cartera.' AS description,b.status,NULL AS promised_date,NULL AS amount,NULL AS notes,NULL AS old_values,NULL AS new_values,b.file_name,b.total_rows,b.failed_rows FROM import_batches b LEFT JOIN users u ON u.id=b.user_id AND (u.company_id=b.company_id OR u.company_id IS NULL) WHERE ${where}`, values });
  }
  return defs;
}

export async function getAdministrativeCollectionHistory({ scope, page, limit, type, dateFrom, dateTo, actorId, query }, dbPool = pool) {
  if (!validCompanyId(scope?.companyId)) throw operationError(403, "El contexto MERTEL no está disponible.");
  const paging = normalizePage(page, limit); const selectedType = normalizeType(type, TYPES);
  if (dateFrom && dateTo && dateFrom > dateTo) throw operationError(400, "date_from no puede ser posterior a date_to.");
  if (actorId !== undefined && (!/^[1-9]\d{0,19}$/.test(String(actorId)) || BigInt(actorId) > 18446744073709551615n)) throw operationError(400, "actor_id inválido.");
  if (query !== undefined && (typeof query !== "string" || query.length > 120)) throw operationError(400, "q debe tener máximo 120 caracteres.");
  const sources = globalSelects({ companyId: scope.companyId, type: selectedType, dateFrom, dateTo, actorId, query: query?.trim() || "" });
  const union = sources.map(source => source.sql).join(" UNION ALL "); const values = sources.flatMap(source => source.values);
  const db = await dbPool.getConnection();
  try {
    await db.query("START TRANSACTION READ ONLY");
    const [companies] = await db.query("SELECT id FROM companies WHERE id=? AND status='active' AND deleted_at IS NULL", [scope.companyId]);
    if (!companies.length) throw operationError(404, "Empresa no encontrada o no activa.");
    const [rows] = await db.query(`SELECT * FROM (${union}) events ORDER BY occurred_ms DESC,id DESC LIMIT ? OFFSET ?`, [...values, paging.limit + 1, paging.offset]);
    const hasNext = rows.length > paging.limit; const events = rows.slice(0, paging.limit).map(eventView);
    const [[count]] = await db.query(`SELECT COUNT(*) AS total FROM (${union}) events`, values);
    await db.commit();
    return { events, pagination: { ...pagination(paging.page, paging.limit, Number(count.total)), has_next: hasNext } };
  } catch (error) { try { await db.rollback(); } catch { /* preserve original */ } throw error; }
  finally { db.release(); }
}

export async function getAdministrativeHistoryActors({ scope }, dbPool = pool) {
  if (!validCompanyId(scope?.companyId)) throw operationError(403, "El contexto MERTEL no está disponible.");
  const db = await dbPool.getConnection();
  try {
    await db.query("START TRANSACTION READ ONLY");
    const [[company]] = await db.query("SELECT id FROM companies WHERE id=? AND status='active' AND deleted_at IS NULL", [scope.companyId]);
    if (!company) throw operationError(404, "Empresa no encontrada o no activa.");
    const [rows] = await db.query(`SELECT CAST(actor_id AS CHAR) AS id,actor_name AS name FROM (
      SELECT a.user_id AS actor_id,CONCAT_WS(' ',u.first_name,u.last_name) AS actor_name FROM collection_actions a JOIN users u ON u.id=a.user_id WHERE a.company_id=?
      UNION SELECT p.created_by,CONCAT_WS(' ',u.first_name,u.last_name) FROM payment_promises p JOIN users u ON u.id=p.created_by WHERE p.company_id=?
      UNION SELECT a.user_id,CONCAT_WS(' ',u.first_name,u.last_name) FROM audit_logs a JOIN settings s ON s.id=a.entity_id AND s.setting_key='collection_rules' JOIN users u ON u.id=a.user_id WHERE a.company_id=? AND a.entity_type='setting'
      UNION SELECT b.user_id,CONCAT_WS(' ',u.first_name,u.last_name) FROM import_batches b JOIN users u ON u.id=b.user_id WHERE b.company_id=?
    ) actors WHERE actor_id IS NOT NULL AND actor_name<>'' GROUP BY actor_id,actor_name ORDER BY actor_name,actor_id LIMIT 500`,
    [scope.companyId, scope.companyId, scope.companyId, scope.companyId]);
    await db.commit(); return rows;
  } catch (error) { try { await db.rollback(); } catch { /* preserve original */ } throw error; }
  finally { db.release(); }
}
