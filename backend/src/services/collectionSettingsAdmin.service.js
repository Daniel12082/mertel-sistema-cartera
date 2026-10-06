import pool from "../config/database.js";
import { getCompanySettings } from "../models/companyConfiguration.model.js";
import { validCompanyId } from "../utils/companyScope.js";
import { MERTEL_STAGE_ORDER, resolveCollectionPolicy } from "./collectionPolicy.js";

const STAGE_LABELS = Object.freeze({
  overdue: ["En mora", "Factura con saldo cuyo vencimiento ya pasó."],
  due_today: ["Vence hoy", "Factura con saldo que vence en la fecha de evaluación."],
  five_days_before_due: ["Faltan 5 días", "Aviso exactamente cinco días calendario antes del vencimiento."],
  prompt_payment: ["Pronto pago", "Clasificación de facturas dentro de diez días calendario desde emisión."],
});
const editableStageKeys = new Set(Object.keys(STAGE_LABELS));

function settingError(status, message) { return Object.assign(new Error(message), { status }); }
function companyIdFor(scope) {
  if (!validCompanyId(scope?.companyId)) throw settingError(403, "El contexto MERTEL no está disponible.");
  return String(scope.companyId);
}
function parseConfiguration(setting) {
  if (!setting) return null;
  if (setting.value_type !== "json") throw settingError(409, "La configuración de cobranza no tiene un formato compatible.");
  let value;
  try { value = JSON.parse(setting.setting_value); } catch { throw settingError(409, "La configuración de cobranza no es válida."); }
  try { resolveCollectionPolicy(value); } catch { throw settingError(409, "La configuración de cobranza no es compatible con la política MERTEL."); }
  if (value?.version !== 2 || value?.commercial_policy !== "mertel_phase_5" || !Array.isArray(value.rules)) {
    throw settingError(409, "La empresa no tiene una configuración versionada administrable.");
  }
  const byKey = new Map(value.rules.map(rule => [rule.key, rule]));
  if (byKey.size !== editableStageKeys.size || [...editableStageKeys].some(key => !byKey.has(key))) {
    throw settingError(409, "Las etapas configuradas no coinciden con el catálogo MERTEL.");
  }
  if (value.stage_order.join(",") !== MERTEL_STAGE_ORDER.join(",") || [...byKey.values()].some(rule => typeof rule.active !== "boolean") ||
      byKey.get("five_days_before_due").days_before_due !== 5 || byKey.get("prompt_payment").condition !== "days_since_issue") {
    throw settingError(409, "La configuración altera condiciones comerciales confirmadas.");
  }
  return value;
}
function present(value) {
  const policy = resolveCollectionPolicy(value);
  const stages = Object.entries(STAGE_LABELS).map(([key, [label, description]]) => {
    const rule = value.rules.find(item => item.key === key);
    return { key, label, description, type: "boolean", value: rule.active,
      editable: true, allowed_values: [true, false], group: "Etapas de cobranza" };
  });
  const prompt = [
    { key: "prompt_payment.percentage", label: "Descuento por pronto pago", description: "Porcentaje confirmado aplicado sobre el valor antes de IVA.", type: "number", value: 3, unit: "%", editable: false },
    { key: "prompt_payment.days", label: "Duración de pronto pago", description: "Días calendario desde la fecha de factura; día 0 y día 10 incluidos.", type: "integer", value: 10, unit: "días calendario", editable: false },
    { key: "five_days_before_due.days", label: "Aviso previo al vencimiento", description: "Cinco días calendario antes del vencimiento.", type: "integer", value: 5, unit: "días calendario", editable: false },
    { key: "stage_order", label: "Prioridad de etapas", description: "En mora, Vence hoy, Faltan 5 días, Pronto pago.", type: "ordered_list", value: [...policy.stageOrder], editable: false },
    { key: "prompt_payment.rounding", label: "Redondeo monetario", description: "Redondeo convencional half-up al peso entero colombiano.", type: "string", value: "half_up", unit: "COP entero", editable: false },
  ];
  return { configured: true, settings: [...stages, ...prompt], stages };
}

export async function getCollectionSettings(scope, dbPool = pool) {
  const companyId = companyIdFor(scope);
  const db = await dbPool.getConnection();
  try {
    await db.query("START TRANSACTION READ ONLY");
    const [[company]] = await db.query("SELECT id FROM companies WHERE id=? AND status='active' AND deleted_at IS NULL", [companyId]);
    if (!company) throw settingError(403, "Empresa no disponible.");
    const settings = await getCompanySettings(companyId, db);
    const rows = settings.filter(item => item.setting_key === "collection_rules");
    if (rows.length > 1) throw settingError(409, "Configuración duplicada.");
    const config = parseConfiguration(rows[0]);
    await db.commit();
    return config ? present(config) : { configured: false, settings: [], stages: [] };
  } catch (error) { try { await db.rollback(); } catch { /* preserve original */ } throw error; }
  finally { db.release(); }
}

function parseUpdate(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => key !== "stages") ||
      !Array.isArray(body.stages) || body.stages.length !== editableStageKeys.size) {
    throw settingError(400, "Envía únicamente el estado de las cuatro etapas de cobranza.");
  }
  const values = new Map();
  for (const item of body.stages) {
    if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).some(key => !["key", "active"].includes(key)) ||
        !editableStageKeys.has(item.key) || typeof item.active !== "boolean" || values.has(item.key)) {
      throw settingError(400, "Cada etapa debe incluir una clave válida y un estado booleano.");
    }
    values.set(item.key, item.active);
  }
  if (values.size !== editableStageKeys.size) throw settingError(400, "Debes enviar todas las etapas permitidas.");
  return values;
}

export async function updateCollectionStageSettings({ scope, actorId, body, ipAddress, userAgent }, dbPool = pool) {
  const companyId = companyIdFor(scope);
  const desired = parseUpdate(body);
  const db = await dbPool.getConnection();
  try {
    await db.beginTransaction();
    const [[company]] = await db.query("SELECT id FROM companies WHERE id=? AND status='active' AND deleted_at IS NULL FOR UPDATE", [companyId]);
    if (!company) throw settingError(403, "Empresa no disponible.");
    const [rows] = await db.query("SELECT id,setting_value,value_type FROM settings WHERE company_id=? AND setting_key='collection_rules' FOR UPDATE", [companyId]);
    if (rows.length !== 1) throw settingError(409, "La configuración de cobranza no está disponible para esta empresa.");
    const configuration = parseConfiguration(rows[0]);
    const oldValues = configuration.rules.map(rule => ({ key: rule.key, active: rule.active }));
    configuration.rules = configuration.rules.map(rule => ({ ...rule, active: desired.get(rule.key) }));
    // Revalidate the complete document so fixed commercial values and hierarchy cannot drift.
    parseConfiguration({ setting_key: "collection_rules", setting_value: JSON.stringify(configuration), value_type: "json" });
    const newValues = configuration.rules.map(rule => ({ key: rule.key, active: rule.active }));
    if (JSON.stringify(oldValues) !== JSON.stringify(newValues)) {
      await db.query("UPDATE settings SET setting_value=? WHERE id=? AND company_id=? AND setting_key='collection_rules'",
        [JSON.stringify(configuration), rows[0].id, companyId]);
      await db.query(`INSERT INTO audit_logs (company_id,user_id,entity_type,entity_id,action,old_values,new_values,ip_address,user_agent)
        VALUES (?,?,'setting',?,'update',?,?,?,?)`, [companyId, actorId, rows[0].id,
        JSON.stringify({ key: "collection_rules", stages: oldValues }), JSON.stringify({ key: "collection_rules", stages: newValues }),
        typeof ipAddress === "string" ? ipAddress.slice(0, 45) : null, typeof userAgent === "string" ? userAgent.slice(0, 500) : null]);
    }
    await db.commit();
    return present(configuration);
  } catch (error) { try { await db.rollback(); } catch { /* preserve original */ } throw error; }
  finally { db.release(); }
}
