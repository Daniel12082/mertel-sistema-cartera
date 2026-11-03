import {createHash} from 'node:crypto';
import pool from '../config/database.js';
import {APPEARANCE_KEY, DEFAULT_APPEARANCE, MAX_LOGO_BYTES, contrastRatio} from '../config/appearance.js';
import {validCompanyId} from '../utils/companyScope.js';
import {findUserById, userRoles, isActiveUser} from '../models/auth.model.js';
import {permissionsForRoles} from '../config/permissions.js';

const invalid = message => Object.assign(new Error(message), {status: 400});
function exactObject(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function rasterDimensions(bytes, type) {
  if (type === 'png' && bytes.length >= 33) return [bytes.readUInt32BE(16),bytes.readUInt32BE(20)];
  if (type === 'webp') {
    const chunk=bytes.toString('ascii',12,16);
    if(chunk==='VP8X'&&bytes.length>=30)return [bytes.readUIntLE(24,3)+1,bytes.readUIntLE(27,3)+1];
    if(chunk==='VP8L'&&bytes.length>=25&&bytes[20]===47){const bits=bytes.readUInt32LE(21);return [(bits&16383)+1,((bits>>>14)&16383)+1];}
    if(chunk==='VP8 '&&bytes.length>=30&&bytes.subarray(23,26).equals(Buffer.from([157,1,42])))return [bytes.readUInt16LE(26)&16383,bytes.readUInt16LE(28)&16383];
  }
  if(type==='jpeg') {
    let offset=2;
    while(offset+4<=bytes.length) {
      if(bytes[offset]!==255)return null;
      while(bytes[offset]===255)offset++;
      const marker=bytes[offset++];
      if(marker===217||marker===218)break;
      if(marker===1||(marker>=208&&marker<=215))continue;
      if(offset+2>bytes.length)return null;
      const size=bytes.readUInt16BE(offset);
      if(size<2||offset+size>bytes.length)return null;
      if(marker>=192&&marker<=207&&![196,200,204].includes(marker)&&size>=8)return [bytes.readUInt16BE(offset+5),bytes.readUInt16BE(offset+3)];
      offset+=size;
    }
  }
  return null;
}
function validateLogo(value) {
  if (value === null) return;
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_LOGO_BYTES / 3) * 4 + 40) throw invalid('El logo debe ser una imagen de hasta 20 KB.');
  const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw invalid('Usa un logo PNG, JPG o WebP.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_LOGO_BYTES || bytes.toString('base64') !== match[2]) throw invalid('El archivo del logo no es válido.');
  const valid = match[1] === 'png' ? bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.toString('ascii',12,16) === 'IHDR' && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(16) <= 2048 && bytes.readUInt32BE(20) > 0 && bytes.readUInt32BE(20) <= 2048 && bytes.toString('ascii',bytes.length-8,bytes.length-4) === 'IEND'
    : match[1] === 'jpeg' ? bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217
      : bytes.length >= 20 && bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP' && bytes.readUInt32LE(4) === bytes.length-8;
  const dimensions=valid?rasterDimensions(bytes,match[1]):null;
  if (!dimensions || dimensions.some(value=>value<1||value>2048)) throw invalid('Usa una imagen válida de hasta 2048 × 2048 píxeles.');
}
export function validateAppearance(body) {
  if (!exactObject(body, Object.keys(DEFAULT_APPEARANCE)) || !exactObject(body.colors, Object.keys(DEFAULT_APPEARANCE.colors))) throw invalid('Envía únicamente los campos de personalización visual.');
  for (const [field, max] of [['name',50],['description',120]]) if (typeof body[field] !== 'string' || !body[field].trim() || body[field].length > max || /[<>\u0000-\u001f\u007f]/.test(body[field])) throw invalid('El nombre y la descripción deben ser texto válido.');
  for (const color of Object.values(body.colors)) if (typeof color !== 'string' || !/^#[\da-f]{6}$/i.test(color)) throw invalid('Introduce colores HEX de seis dígitos.');
  if (contrastRatio(body.colors.text,body.colors.surface) < 4.5 || contrastRatio(body.colors.text,body.colors.background) < 4.5) throw invalid('El texto necesita mayor contraste con el fondo y las tarjetas (mínimo 4.5:1).');
  validateLogo(body.logo); validateLogo(body.compactLogo);
  const value = {name: body.name.trim(), description: body.description.trim(), logo: body.logo, compactLogo: body.compactLogo, colors: {...body.colors}};
  if (Buffer.byteLength(JSON.stringify(value)) > 60 * 1024) throw invalid('La personalización excede el tamaño permitido.');
  return value;
}
function companyId(scope) {
  if (!validCompanyId(scope?.companyId)) throw Object.assign(new Error('El contexto MERTEL no está disponible.'), {status:403});
  return scope.companyId;
}
function readValue(rows) {
  if (!rows.length) return structuredClone(DEFAULT_APPEARANCE);
  if (rows.length !== 1 || rows[0].value_type !== 'json') throw Object.assign(new Error('No se pudo cargar la apariencia guardada.'), {status:409});
  try { return validateAppearance(JSON.parse(rows[0].setting_value)); }
  catch { throw Object.assign(new Error('No se pudo cargar la apariencia guardada.'), {status:409}); }
}
export async function getAppearance(scope, dbPool = pool) {
  const [rows] = await dbPool.query('SELECT setting_value,value_type FROM settings WHERE company_id=? AND setting_key=?', [companyId(scope), APPEARANCE_KEY]);
  return {appearance: readValue(rows), company_name: scope.companyName};
}
function auditValue(value) {
  const logo = data => data ? {sha256:createHash('sha256').update(data).digest('hex'), bytes:Buffer.byteLength(data)} : null;
  return {...value, logo:logo(value.logo), compactLogo:logo(value.compactLogo)};
}
export async function saveAppearance({scope, actorId, body}, dbPool = pool) {
  const id = companyId(scope), appearance = validateAppearance(body), db = await dbPool.getConnection();
  try {
    await db.beginTransaction();
    const [[company]] = await db.query("SELECT id FROM companies WHERE id=? AND status='active' AND deleted_at IS NULL FOR UPDATE", [id]);
    const actor = await findUserById(actorId, db), roles = actor ? await userRoles(actorId,db) : [];
    if (!company || !isActiveUser(actor) || !permissionsForRoles(roles).includes('settings.manage') || (actor.company_id !== null && String(actor.company_id) !== String(id))) throw Object.assign(new Error('No tienes permiso para personalizar MERTEL.'), {status:403});
    const [rows] = await db.query('SELECT id,setting_value,value_type FROM settings WHERE company_id=? AND setting_key=? FOR UPDATE', [id, APPEARANCE_KEY]);
    const previous = readValue(rows);
    if (JSON.stringify(previous) !== JSON.stringify(appearance)) {
      if (rows.length) await db.query('UPDATE settings SET setting_value=? WHERE id=? AND company_id=? AND setting_key=?', [JSON.stringify(appearance),rows[0].id,id,APPEARANCE_KEY]);
      else await db.query("INSERT INTO settings(company_id,setting_key,setting_value,value_type) VALUES (?,?,?,'json')", [id,APPEARANCE_KEY,JSON.stringify(appearance)]);
      const [[setting]] = await db.query('SELECT id FROM settings WHERE company_id=? AND setting_key=?', [id, APPEARANCE_KEY]);
      await db.query("INSERT INTO audit_logs(company_id,user_id,entity_type,entity_id,action,old_values,new_values) VALUES (?,?,'setting',?,'APPEARANCE_UPDATED',?,?)", [id,actorId,setting.id,JSON.stringify({key:APPEARANCE_KEY,appearance:auditValue(previous)}),JSON.stringify({key:APPEARANCE_KEY,appearance:auditValue(appearance)})]);
    }
    await db.commit();
    return {appearance, company_name:scope.companyName};
  } catch (error) { await db.rollback().catch(()=>{}); throw error; }
  finally { db.release(); }
}
