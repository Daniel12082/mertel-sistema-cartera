import pool from "../config/database.js";
import { validCompanyId } from "../utils/companyScope.js";
import { loadCompanyCollectionRules } from "./companyCollection.service.js";
import { collectionStageCatalog } from "./collectionPolicy.js";
import { operationError, operationId } from "./collectionOperations.validation.js";
import { messageTemplateVariableCatalog, renderMessageTemplate } from "../utils/messageTemplate.js";

const templateFields = new Set(["name", "channel", "content", "stage"]);
const createFields = new Set([...templateFields, "status"]);
const templateColumns = `CAST(id AS CHAR) AS id, name, channel, stage, status, content,
  CAST(created_by AS CHAR) AS created_by, created_at, updated_at`;

function parseTemplate(body, { creating = false } = {}) {
  const fields = creating ? createFields : templateFields;
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !fields.has(key))) {
    throw operationError(400, "Campos de plantilla no válidos.");
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 150) throw operationError(400, "El nombre es obligatorio y debe tener máximo 150 caracteres.");
  if (body.channel !== "whatsapp") throw operationError(400, "El canal debe ser whatsapp.");
  const content = body.content;
  if (typeof content !== "string" || !content.trim()) throw operationError(400, "El contenido de la plantilla es obligatorio.");
  if (Buffer.byteLength(content, "utf8") > 65535 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(content)) {
    throw operationError(400, "El contenido de la plantilla tiene caracteres o tamaño no permitidos.");
  }
  const rendered = renderMessageTemplate(content, {});
  if (rendered.malformed_variables) throw operationError(400, "El contenido tiene variables mal formadas.");
  if (rendered.unsupported_variables.length) throw operationError(400, `Variable no soportada: {{${rendered.unsupported_variables[0]}}}.`);
  const stage = body.stage == null || body.stage === "" ? null : typeof body.stage === "string" ? body.stage.trim() : null;
  if (body.stage != null && body.stage !== "" && (!stage || stage.length > 50)) throw operationError(400, "La etapa de cobranza no es válida.");
  const status = creating ? (body.status ?? "inactive") : undefined;
  if (creating && !["active", "inactive"].includes(status)) throw operationError(400, "El estado debe ser active o inactive.");
  return { name, channel: "whatsapp", content, stage, ...(creating ? { status } : {}) };
}

function authorizedCompany(scope) {
  if (!validCompanyId(scope?.companyId)) {
    throw operationError(scope?.globalAdmin ? 400 : 403, "Se requiere un contexto de empresa autorizado.");
  }
  return String(scope.companyId);
}

async function beginCompanyTransaction(scope, { readOnly = false } = {}) {
  const companyId = authorizedCompany(scope);
  const db = await pool.getConnection();
  try {
    if (readOnly) await db.query("START TRANSACTION READ ONLY"); else await db.beginTransaction();
    const [[company]] = await db.query("SELECT id FROM companies WHERE id=? AND status='active' AND deleted_at IS NULL", [companyId]);
    if (!company) throw operationError(403, "Empresa no disponible.");
    const rules = await loadCompanyCollectionRules(companyId, db);
    return { db, companyId, rules, stages: collectionStageCatalog(rules) };
  } catch (error) {
    try { await db.rollback(); } catch { /* preserve the original error */ }
    db.release();
    throw error;
  }
}

function validateStage(stage, stages) {
  if (stage !== null && !stages.some(item => item.key === stage)) {
    throw operationError(400, "La etapa debe pertenecer al catálogo activo de cobranza de la empresa.");
  }
}

export async function listMessageTemplates({ scope }) {
  const { db, companyId, stages } = await beginCompanyTransaction(scope, { readOnly: true });
  try {
    const [templates] = await db.query(`SELECT ${templateColumns} FROM message_templates WHERE company_id=? AND channel='whatsapp' ORDER BY updated_at DESC,id DESC`, [companyId]);
    await db.commit();
    return { templates, stage_catalog: stages, variables: messageTemplateVariableCatalog() };
  } catch (error) { try { await db.rollback(); } catch { /* preserve original */ } throw error; }
  finally { db.release(); }
}

export async function createMessageTemplate({ scope, actorId, body }) {
  const template = parseTemplate(body, { creating: true });
  const { db, companyId, stages } = await beginCompanyTransaction(scope);
  try {
    validateStage(template.stage, stages);
    const [inserted] = await db.query(`INSERT INTO message_templates (company_id,name,channel,content,stage,status,created_by)
      VALUES (?,?,?,?,?,?,?)`, [companyId, template.name, template.channel, template.content, template.stage, template.status, actorId]);
    const [[created]] = await db.query(`SELECT ${templateColumns} FROM message_templates WHERE id=? AND company_id=?`, [inserted.insertId, companyId]);
    await db.commit();
    return created;
  } catch (error) { try { await db.rollback(); } catch { /* preserve original */ } throw error; }
  finally { db.release(); }
}

export async function updateMessageTemplate({ scope, templateId, body }) {
  const id = operationId(templateId, "template_id");
  const template = parseTemplate(body);
  const { db, companyId, stages } = await beginCompanyTransaction(scope);
  try {
    validateStage(template.stage, stages);
    const [[existing]] = await db.query("SELECT id FROM message_templates WHERE id=? AND company_id=? FOR UPDATE", [id, companyId]);
    if (!existing) throw operationError(404, "Plantilla no encontrada.");
    await db.query(`UPDATE message_templates SET name=?,channel=?,content=?,stage=? WHERE id=? AND company_id=?`,
      [template.name, template.channel, template.content, template.stage, id, companyId]);
    const [[result]] = await db.query(`SELECT ${templateColumns} FROM message_templates WHERE id=? AND company_id=?`, [id, companyId]);
    await db.commit();
    return result;
  } catch (error) { try { await db.rollback(); } catch { /* preserve original */ } throw error; }
  finally { db.release(); }
}

export async function setMessageTemplateStatus({ scope, templateId, status }) {
  const id = operationId(templateId, "template_id");
  if (!new Set(["active", "inactive"]).has(status)) throw operationError(400, "Estado no válido.");
  const { db, companyId } = await beginCompanyTransaction(scope);
  try {
    const [[existing]] = await db.query("SELECT id FROM message_templates WHERE id=? AND company_id=? FOR UPDATE", [id, companyId]);
    if (!existing) throw operationError(404, "Plantilla no encontrada.");
    await db.query("UPDATE message_templates SET status=? WHERE id=? AND company_id=?", [status, id, companyId]);
    const [[result]] = await db.query(`SELECT ${templateColumns} FROM message_templates WHERE id=? AND company_id=?`, [id, companyId]);
    await db.commit();
    return result;
  } catch (error) { try { await db.rollback(); } catch { /* preserve original */ } throw error; }
  finally { db.release(); }
}
