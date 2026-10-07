import { createHash } from "node:crypto";
import pool from "../config/database.js";
import { normalizeMertelNit, parseMertelAmount, parseMertelPortfolioXlsx } from "./mertelPortfolioXlsxParser.js";
import { validCompanyId } from "../utils/companyScope.js";

const fail = (message, status = 400, code) => Object.assign(new Error(message), { status, code });
const json = value => typeof value === "string" ? JSON.parse(value) : value;
const maxField = (value, size) => value == null ? null : String(value).trim().slice(0, size) || null;
const editable = Object.freeze({ name: "Nombre cliente", address: "Direccion", city: "Ciudad", phone: "Telefono", credit_limit: "Cupo" });
const validSourceNit = row => /^\d{6,15}$/.test(row.customer_nit_normalized || "") && /^[\d\s.,-]+$/.test(String(row.customer_nit_original || "").trim());

function sourceCustomer(row) {
  const v = row.values || {};
  return {
    nit: row.customer_nit_original || v["Nit Cliente"] || "", nit_normalized: row.customer_nit_normalized || "",
    name: maxField(v["Nombre cliente"], 200), representative: maxField(v["Rep Legal"], 255),
    address: maxField(v.Direccion, 255), city: maxField(v.Ciudad, 100), department: maxField(v.Departamento, 100),
    phone: maxField(v.Telefono, 50), mobile: maxField(v.Celular, 50), credit_limit: parseMertelAmount(v.Cupo),
    collector: maxField(v.Cobrador, 200), seller: maxField(v.Vendedor, 200), zone: maxField(v.Zona, 100),
  };
}

async function getBatch(db, batchId, companyId, digest) {
  if (!/^\d+$/.test(String(batchId || ""))) throw fail("Lote de importación inválido.");
  const [rows] = await db.query("SELECT id,file_sha256,file_name FROM import_batches WHERE id=? AND company_id=? AND file_type='xlsx'", [batchId, companyId]);
  if (!rows[0] || rows[0].file_sha256 !== digest) throw fail("El archivo no corresponde al lote de importación.", 409, "IMPORT_BATCH_MISMATCH");
  return rows[0];
}

function aggregate(parsed) {
  const groups = new Map();
  for (const row of parsed.customer_records || []) {
    const source = sourceCustomer(row);
    const key = source.nit_normalized || `invalid:${row.row_number}`;
    if (!groups.has(key)) groups.set(key, { key, nit: source.nit_normalized || null, source, rows: [], conflicts: new Map() });
    const group = groups.get(key); group.rows.push(row.row_number);
    // Keep the most complete non-empty attributes seen for this identity; source rows remain available.
    for (const [field, value] of Object.entries(source)) {
      if ((group.source[field] == null || group.source[field] === "") && value != null && value !== "") group.source[field] = value;
      else if (value != null && value !== "" && group.source[field] != null && String(group.source[field]) !== String(value) && Object.hasOwn(editable,field)) {
        const alternatives=group.conflicts.get(field)||new Set([String(group.source[field])]);alternatives.add(String(value));group.conflicts.set(field,alternatives);
      }
    }
    if (!source.name) group.invalid = true;
  }
  return [...groups.values()];
}

export async function analyzeCustomerResolution({ bytes, scope, batchId, actorId }) {
  if (!validCompanyId(scope?.companyId)) throw fail("El contexto MERTEL no está disponible.", 403);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const parsed = await parseMertelPortfolioXlsx(bytes);
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const batch = await getBatch(db, batchId, scope.companyId, digest);
    const groups = aggregate(parsed);
    const [existing] = await db.query("SELECT id,nit,name,address,city,phone,credit_limit FROM customers WHERE company_id=? AND deleted_at IS NULL", [scope.companyId]);
    for (const group of groups) {
      const candidates = existing.filter(customer => normalizeMertelNit(customer.nit).normalized === group.nit && group.nit);
      let status = "SEARCHING"; let customerId = null; let differences = [];
      group.source.source_conflicts=Object.fromEntries([...group.conflicts].map(([field,values])=>[field,[...values]]));
      if (group.invalid || !validSourceNit({ customer_nit_normalized: group.nit, customer_nit_original: group.source.nit }) || !group.source.name) status = "INVALID";
      else if (candidates.length > 1) status = "AMBIGUOUS";
      else if (candidates.length === 1) {
        const customer = candidates[0]; customerId = String(customer.id);
        differences = Object.keys(editable).flatMap(field => {
          const current = customer[field] == null ? null : String(customer[field]);
          const incoming = group.source[field] == null ? null : String(group.source[field]);
          if(field==="credit_limit"&&current!=null&&incoming!=null&&Number(current)===Number(incoming))return [];
          return current !== incoming && incoming != null ? [{ field, current, source: incoming }] : [];
        });
        // Exact NIT remains the identity; important profile conflicts need a human confirmation.
        const criticalConflict = group.conflicts.size > 0 || differences.some(item => ["name","address","phone"].includes(item.field));
        status = criticalConflict ? "AMBIGUOUS" : "PERSISTENT";
      } else status = group.conflicts.size ? "AMBIGUOUS" : "NEW";
      await db.query(`INSERT INTO mertel_customer_resolution_rows
        (company_id,import_batch_id,identity_key,nit_normalized,source_rows,source_data,status,customer_id,differences,updated_by,resolved_at)
        VALUES (?,?,?,?,CAST(? AS JSON),CAST(? AS JSON),?,?,CAST(? AS JSON),?,?)
        ON DUPLICATE KEY UPDATE source_rows=VALUES(source_rows),source_data=IF(decision='correct' OR status IN ('PERSISTENT','RESOLVED'),source_data,VALUES(source_data)),
          status=IF(decision='correct' OR status IN ('PERSISTENT','RESOLVED'),status,VALUES(status)),
          customer_id=COALESCE(customer_id,VALUES(customer_id)),differences=VALUES(differences),updated_by=VALUES(updated_by),
          resolved_at=IF(status IN ('PERSISTENT','RESOLVED'),resolved_at,VALUES(resolved_at))`,
      [scope.companyId, batch.id, group.key, group.nit, JSON.stringify(group.rows), JSON.stringify(group.source), status,
        customerId, JSON.stringify(differences), actorId, status === "PERSISTENT" ? new Date() : null]);
      if(status==="PERSISTENT"){
        const [[resolutionRow]]=await db.query("SELECT id FROM mertel_customer_resolution_rows WHERE company_id=? AND import_batch_id=? AND identity_key=?",[scope.companyId,batch.id,group.key]);
        const [matchedAudit]=await db.query("SELECT id FROM audit_logs WHERE company_id=? AND entity_type='customer_resolution' AND entity_id=? AND action='CLIENT_MATCHED' LIMIT 1",[scope.companyId,resolutionRow.id]);
        if(!matchedAudit.length)await db.query("INSERT INTO audit_logs(company_id,user_id,entity_type,entity_id,action,new_values) VALUES (?,?, 'customer_resolution',?,'CLIENT_MATCHED',CAST(? AS JSON))",
          [scope.companyId,actorId,resolutionRow.id,JSON.stringify({import_batch_id:batch.id,source_hash:digest,nit_normalized:group.nit,customer_id:customerId,source_data:group.source,differences})]);
      }
    }
    await db.query("INSERT INTO audit_logs(company_id,user_id,entity_type,entity_id,action,new_values) VALUES (?,?, 'customer_resolution_batch',?,'analyzed',CAST(? AS JSON))",
      [scope.companyId, actorId, batch.id, JSON.stringify({ source_hash: digest, file_name: batch.file_name, customer_count: groups.length })]);
    await db.commit();
    return getCustomerResolution({ scope, batchId });
  } catch (error) { try { await db.rollback(); } catch {} throw error; }
  finally { db.release(); }
}

export async function getCustomerResolution({ scope, batchId, status, search = "" }) {
  if (!validCompanyId(scope?.companyId)) throw fail("El contexto MERTEL no está disponible.", 403);
  const values = [scope.companyId, batchId]; let filter = "";
  if (status && status !== "ALL") { filter += " AND r.status=?"; values.push(status); }
  if (search) { filter += " AND (r.nit_normalized LIKE ? OR JSON_UNQUOTE(JSON_EXTRACT(r.source_data,'$.name')) LIKE ? OR CAST(r.customer_id AS CHAR)=?)"; values.push(`%${search}%`, `%${search}%`, search); }
  const [all] = await pool.query(`SELECT status,COUNT(*) AS count FROM mertel_customer_resolution_rows WHERE company_id=? AND import_batch_id=? GROUP BY status`, [scope.companyId, batchId]);
  const [companyCustomers] = await pool.query("SELECT CAST(id AS CHAR) id,nit,name,address,city,phone,credit_limit FROM customers WHERE company_id=? AND deleted_at IS NULL", [scope.companyId]);
  const [rows] = await pool.query(`SELECT CAST(r.id AS CHAR) id,r.import_batch_id,r.nit_normalized,r.source_rows,r.source_data,r.status,
    CAST(r.customer_id AS CHAR) customer_id,r.differences,r.decision,r.decision_reason,r.resolved_at,
    c.nit AS current_nit,c.name AS current_name,c.address AS current_address,c.city AS current_city,c.phone AS current_phone,c.credit_limit AS current_credit_limit
    FROM mertel_customer_resolution_rows r LEFT JOIN customers c ON c.id=r.customer_id AND c.company_id=r.company_id
    WHERE r.company_id=? AND r.import_batch_id=?${filter} ORDER BY FIELD(r.status,'AMBIGUOUS','INVALID','NEW','SEARCHING','FOUND','PERSISTENT','RESOLVED'),r.id LIMIT 10000`, values);
  const counts = Object.fromEntries(["SEARCHING","FOUND","NEW","AMBIGUOUS","INVALID","PERSISTENT","RESOLVED"].map(key => [key, Number(all.find(item => item.status === key)?.count || 0)]));
  return { batch_id: String(batchId), counts, pending: counts.SEARCHING + counts.NEW + counts.AMBIGUOUS + counts.INVALID,
    ready_for_pipeline: counts.SEARCHING + counts.NEW + counts.AMBIGUOUS + counts.INVALID === 0, rows: rows.map(row => ({ ...row,
      source_rows: json(row.source_rows), source_data: json(row.source_data), differences: json(row.differences) || [], current: row.current_nit ? { nit: row.current_nit,
        name: row.current_name, address: row.current_address, city: row.current_city, phone: row.current_phone, credit_limit: row.current_credit_limit } : null,
      candidates: row.nit_normalized ? companyCustomers.filter(customer => normalizeMertelNit(customer.nit).normalized === row.nit_normalized) : [] })) };
}

export async function getCustomerResolutionDashboard(scope) {
  if (!validCompanyId(scope?.companyId)) throw fail("El contexto MERTEL no está disponible.", 403);
  const [rows] = await pool.query(`SELECT status,COUNT(*) count FROM mertel_customer_resolution_rows WHERE company_id=? GROUP BY status`, [scope.companyId]);
  const counts = Object.fromEntries(["SEARCHING","FOUND","NEW","AMBIGUOUS","INVALID","PERSISTENT","RESOLVED"].map(key => [key, Number(rows.find(item => item.status === key)?.count || 0)]));
  const [batches] = await pool.query(`SELECT DISTINCT b.id,b.file_name FROM import_batches b JOIN mertel_customer_resolution_rows r ON r.import_batch_id=b.id
    WHERE b.company_id=? AND r.status IN ('SEARCHING','NEW','AMBIGUOUS','INVALID') ORDER BY b.id DESC LIMIT 10`, [scope.companyId]);
  return { counts, pending: counts.SEARCHING + counts.NEW + counts.AMBIGUOUS + counts.INVALID, batches: batches.map(row => ({ id:String(row.id), file_name:row.file_name })) };
}

export async function decideCustomerResolution({ scope, actorId, rowId, body, ipAddress, userAgent }) {
  if (!validCompanyId(scope?.companyId) || !/^\d+$/.test(String(rowId || ""))) throw fail("Registro de resolución inválido.", 400);
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["decision","reason","fields","customer_id","corrections","batch_id"].includes(key))) throw fail("Decisión no válida.");
  if (!/^\d+$/.test(String(body.batch_id || ""))) throw fail("Lote de importación inválido.");
  const db = await pool.getConnection(); let nitLock = null;
  try {
    await db.beginTransaction();
    const [rows] = await db.query("SELECT * FROM mertel_customer_resolution_rows WHERE id=? AND company_id=? AND import_batch_id=? FOR UPDATE", [rowId, scope.companyId, body.batch_id]);
    const row = rows[0]; if (!row) throw fail("Registro no encontrado en esta empresa.", 404);
    if (["PERSISTENT","RESOLVED"].includes(row.status) && body.decision !== "update") {
      if (body.customer_id && String(body.customer_id) !== String(row.customer_id)) throw fail("El cliente enviado no coincide con la asociación persistida.", 400);
      if (body.decision === "confirm_same") {
        const [current] = await db.query("SELECT id,nit FROM customers WHERE id=? AND company_id=? AND deleted_at IS NULL", [row.customer_id,scope.companyId]);
        if (!current[0] || normalizeMertelNit(current[0].nit).normalized !== row.nit_normalized) throw fail("La asociación de cliente requiere revisión.",409);
      }
      await db.commit(); return getCustomerResolution({ scope, batchId: row.import_batch_id });
    }
    const source = json(row.source_data); const beforeStatus = row.status; let customerId = row.customer_id; let afterStatus = "PERSISTENT";
    if (body.decision === "correct") {
      if (row.status !== "INVALID" || !body.corrections || typeof body.corrections !== "object" || Object.keys(body.corrections).some(key => !["nit","name"].includes(key))) throw fail("Corrección no válida para este registro.");
      const correctedNit = normalizeMertelNit(body.corrections.nit).normalized; const correctedName = maxField(body.corrections.name,200);
      if (!/^\d{6,15}$/.test(correctedNit) || !/^[\d\s.,-]+$/.test(String(body.corrections.nit).trim()) || !correctedName) throw fail("Escribe un NIT válido y un nombre de cliente.");
      const [conflict] = await db.query("SELECT id FROM mertel_customer_resolution_rows WHERE company_id=? AND import_batch_id=? AND nit_normalized=? AND id<>?", [scope.companyId,row.import_batch_id,correctedNit,row.id]);
      if (conflict.length) throw fail("El NIT corregido ya está en otro registro de esta importación; revisa ese registro.",409);
      const correctedSource={...source,nit:String(body.corrections.nit).trim(),nit_normalized:correctedNit,name:correctedName};
      await db.query("UPDATE mertel_customer_resolution_rows SET nit_normalized=?,source_data=CAST(? AS JSON),status='NEW',decision='correct',decision_reason=?,updated_by=?,resolved_at=NULL WHERE id=? AND company_id=?",
        [correctedNit,JSON.stringify(correctedSource),maxField(body.reason,500),actorId,row.id,scope.companyId]);
      await db.query("INSERT INTO audit_logs(company_id,user_id,entity_type,entity_id,action,old_values,new_values,ip_address,user_agent) VALUES (?,?, 'customer_resolution',?,'CLIENT_MANUAL_RESOLUTION',CAST(? AS JSON),CAST(? AS JSON),?,?)",
        [scope.companyId,actorId,row.id,JSON.stringify({status:beforeStatus,source_data:source}),JSON.stringify({import_batch_id:row.import_batch_id,nit_normalized:correctedNit,status:"NEW",source_data:correctedSource}),ipAddress,userAgent?.slice(0,500)||null]);
      await db.commit(); return getCustomerResolution({scope,batchId:row.import_batch_id});
    }
    const candidates = async () => {
      const [matches] = await db.query("SELECT id,nit,name,address,city,phone,credit_limit FROM customers WHERE company_id=? AND deleted_at IS NULL", [scope.companyId]);
      return matches.filter(item => normalizeMertelNit(item.nit).normalized === row.nit_normalized);
    };
    let changes = [];
    if (body.decision === "confirm_same" || body.decision === "create" || body.decision === "update") {
      if (!/^\d{6,15}$/.test(row.nit_normalized || "")) throw fail("Corrige el NIT antes de crear o asociar el cliente.");
      let matches = await candidates();
      if (body.decision === "confirm_same") {
        const selected = matches.find(item => String(item.id) === String(body.customer_id || customerId || ""));
        if ((matches.length !== 1 && !body.customer_id) || !selected) throw fail("Selecciona una coincidencia del mismo NIT validada por el servidor.", 409);
        customerId = selected.id; afterStatus = "RESOLVED";
      } else if (body.decision === "create") {
        nitLock = `mertel_nit_${createHash("sha256").update(`${scope.companyId}:${row.nit_normalized}`).digest("hex").slice(0,32)}`;
        const [[lock]] = await db.query("SELECT GET_LOCK(?,10) acquired", [nitLock]);
        if (lock.acquired !== 1) throw fail("No se pudo bloquear la creación concurrente de este NIT.", 409);
        matches = await candidates();
        if (matches.length) throw fail("El NIT ya existe; revisa y asocia el cliente existente.", 409);
        const name = maxField(source.name, 200); if (!name) throw fail("El nombre del cliente es obligatorio.");
        const [created] = await db.query(`INSERT INTO customers(company_id,nit,name,address,city,phone,credit_limit,available_credit,status,notes)
          VALUES (?,?,?,?,?,?,?,0,'active',NULL)`, [scope.companyId, source.nit, name, source.address, source.city, source.phone, Number(source.credit_limit) || 0]);
        customerId = created.insertId; afterStatus = "PERSISTENT";
        await db.query("INSERT INTO audit_logs(company_id,user_id,entity_type,entity_id,action,old_values,new_values,ip_address,user_agent) VALUES (?,?, 'customer',?,'CLIENT_CREATED',NULL,CAST(? AS JSON),?,?)",
          [scope.companyId, actorId, customerId, JSON.stringify({ import_batch_id: row.import_batch_id, nit_normalized: row.nit_normalized, source_data: source }), ipAddress, userAgent?.slice(0,500) || null]);
      } else if (body.decision === "update") {
        const customer = matches.find(item => String(item.id) === String(body.customer_id || customerId || ""));
        if (!customer) throw fail("Selecciona una coincidencia con el mismo NIT validada por el servidor.", 409);
        customerId = customer.id;
        const fields = body.fields; if (!fields || typeof fields !== "object" || Array.isArray(fields) || Object.keys(fields).some(key => !Object.hasOwn(editable,key))) throw fail("Campos de actualización no válidos.");
        for (const field of Object.keys(editable)) if (Object.hasOwn(fields,field)) {
          const choice = fields[field]; if (!choice || !["keep","source","manual"].includes(choice.mode)) throw fail(`Decisión de campo inválida: ${field}`);
          const oldValue = customer[field]; const value = choice.mode === "keep" ? oldValue : choice.mode === "source" ? source[field] : maxField(choice.value, field === "credit_limit" ? 30 : field === "name" ? 200 : field === "address" ? 255 : field === "city" ? 100 : 50);
          if (choice.mode === "manual" && (typeof choice.value !== "string" || !choice.value.trim())) throw fail(`El valor manual de ${field} es obligatorio.`);
          if (field === "name" && !value) throw fail("El nombre no puede quedar vacío.");
          if (field === "credit_limit" && value != null && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 9999999999999.99 || !/^\d+(?:\.\d{1,2})?$/.test(String(value)))) throw fail("El cupo debe ser un valor numérico no negativo con máximo dos decimales.");
          if (choice.mode !== "keep" && value != null && String(value) !== String(oldValue)) changes.push({ field, old: oldValue, source: source[field], final: value, mode: choice.mode });
        }
        if (changes.some(change => change.mode !== "keep")) {
          const sets = changes.map(change => `\`${change.field}\`=?`); await db.query(`UPDATE customers SET ${sets.join(",")} WHERE id=? AND company_id=?`, [...changes.map(change => change.final), customer.id, scope.companyId]);
        }
        afterStatus = "RESOLVED";
      }
    } else if (body.decision === "review") { afterStatus = "AMBIGUOUS"; customerId = null; }
    else if (body.decision === "invalidate") { afterStatus = "INVALID"; customerId = null; }
    else throw fail("Decisión no reconocida.");
    const reason = maxField(body.reason, 500);
    const decisionName = body.decision === "confirm_same" ? "CLIENT_MANUAL_RESOLUTION" : body.decision === "create" ? "CLIENT_CREATED" : body.decision === "update" ? "CLIENT_UPDATED" : body.decision === "review" ? "CLIENT_MARKED_AMBIGUOUS" : "CLIENT_REJECTED";
    await db.query("UPDATE mertel_customer_resolution_rows SET status=?,customer_id=?,decision=?,decision_reason=?,updated_by=?,resolved_at=IF(? IN ('PERSISTENT','RESOLVED'),NOW(),NULL) WHERE id=? AND company_id=?",
      [afterStatus, customerId, body.decision, reason, actorId, afterStatus, row.id, scope.companyId]);
    await db.query("INSERT INTO audit_logs(company_id,user_id,entity_type,entity_id,action,old_values,new_values,ip_address,user_agent) VALUES (?,?, 'customer_resolution',?,?,CAST(? AS JSON),CAST(? AS JSON),?,?)",
      [scope.companyId, actorId, row.id, decisionName, JSON.stringify({ status: beforeStatus, customer_id: row.customer_id, source_data: source }), JSON.stringify({ import_batch_id: row.import_batch_id, nit_normalized: row.nit_normalized, status: afterStatus, customer_id: customerId, decision: body.decision, reason, changes }), ipAddress, userAgent?.slice(0,500) || null]);
    await db.commit();
    return getCustomerResolution({ scope, batchId: row.import_batch_id });
  } catch (error) { try { await db.rollback(); } catch {} throw error; }
  finally { if (nitLock) { try { await db.query("SELECT RELEASE_LOCK(?)", [nitLock]); } catch {} } db.release(); }
}
