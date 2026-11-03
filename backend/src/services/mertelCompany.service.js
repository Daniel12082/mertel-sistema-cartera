import {readFile} from 'node:fs/promises';
import {resolveCollectionPolicy} from './collectionPolicy.js';

export const MERTEL_COMPANY_NAME = "MERTEL IMPORTACIONES";
const PROVISION_LOCK = "mertel_single_company_provision_v1";

// Explicit provisioning only: reads never seed rules, and existing configuration is never overwritten.
export async function provisionMertelCollectionRules(db) {
  const company=await resolveMertelCompany(db);
  const configuration=JSON.parse(await readFile(new URL('../../config/mertel-collection-rules.json',import.meta.url),'utf8'));
  // This correction authorizes the four confirmed stages, not the separate conditional benefit.
  configuration.conditional_discount.active=false;
  resolveCollectionPolicy(configuration);
  const lock=`mertel_collection_rules_${company.id}`;
  const [[{acquired}]]=await db.query('SELECT GET_LOCK(?,10) AS acquired',[lock]);
  if(acquired!==1)throw new Error('No se pudo bloquear la configuración de MERTEL.');
  try {
    await db.beginTransaction();
    const [[active]]=await db.query("SELECT id FROM companies WHERE id=? AND status='active' AND deleted_at IS NULL FOR UPDATE",[company.id]);
    if(!active)throw new Error('MERTEL no está activa; no se modificó la configuración.');
    const [rows]=await db.query("SELECT id,setting_value,value_type FROM settings WHERE company_id=? AND setting_key='collection_rules' FOR UPDATE",[company.id]);
    if(rows.length>1)throw new Error('Configuración duplicada; no se modificó.');
    if(rows.length) {
      if(rows[0].value_type!=='json')throw new Error('La configuración existente requiere revisión; no se modificó.');
      resolveCollectionPolicy(JSON.parse(rows[0].setting_value));
      await db.commit();return {company,configured:true,created:false};
    }
    const [insert]=await db.query("INSERT INTO settings(company_id,setting_key,setting_value,value_type,description) VALUES (?,'collection_rules',?,'json','Reglas comerciales confirmadas MERTEL')",[company.id,JSON.stringify(configuration)]);
    await db.query("INSERT INTO audit_logs(company_id,user_id,entity_type,entity_id,action,new_values) VALUES (?,NULL,'setting',?,'create',?)",[company.id,insert.insertId,JSON.stringify({actor_type:'SYSTEM',source:'provision-mertel:collection-rules-only',configuration})]);
    await db.commit();return {company,configured:true,created:true};
  } catch(error) {try{await db.rollback();}catch{/* preserve error */}throw error;}
  finally{await db.query('SELECT RELEASE_LOCK(?)',[lock]);}
}

export async function resolveMertelCompany(db) {
  const [rows] = await db.query(
    "SELECT CAST(id AS CHAR) AS id, name, status, deleted_at FROM companies WHERE name=? ORDER BY id LIMIT 2",
    [MERTEL_COMPANY_NAME],
  );
  if (rows.length !== 1 || rows[0].status !== "active" || rows[0].deleted_at !== null) {
    throw Object.assign(new Error("El contexto único de MERTEL no está provisionado o requiere revisión."), { status: 503 });
  }
  return rows[0];
}

export async function provisionMertelCompany(db) {
  const [[{ acquired }]] = await db.query("SELECT GET_LOCK(?, 10) AS acquired", [PROVISION_LOCK]);
  if (acquired !== 1) throw new Error("No se pudo adquirir el bloqueo de provisioning de MERTEL.");
  try {
    const [rows] = await db.query(
      "SELECT CAST(id AS CHAR) AS id, name, status, deleted_at FROM companies WHERE name=? ORDER BY id LIMIT 2",
      [MERTEL_COMPANY_NAME],
    );
    if (rows.length > 1) throw new Error("Hay más de un registro MERTEL; requiere revisión manual.");
    if (rows.length === 1) {
      if (rows[0].status !== "active" || rows[0].deleted_at !== null) {
        throw new Error("El registro MERTEL existente no está activo; no se modificó.");
      }
      return { company: rows[0], created: false };
    }
    const [insert] = await db.query("INSERT INTO companies (name, status) VALUES (?, 'active')", [MERTEL_COMPANY_NAME]);
    const [[company]] = await db.query(
      "SELECT CAST(id AS CHAR) AS id, name, status, deleted_at FROM companies WHERE id=?",
      [insert.insertId],
    );
    return { company, created: true };
  } finally {
    await db.query("SELECT RELEASE_LOCK(?)", [PROVISION_LOCK]);
  }
}
