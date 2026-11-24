import { randomBytes } from 'node:crypto';
import pool from '../config/database.js';
import { PERMISSIONS, ROLE_LABELS, ROLE_PERMISSIONS, permissionsForRoles, expandPermissions } from '../config/permissions.js';
import { findUserById,isActiveUser,userRoles } from '../models/auth.model.js';
import { validCompanyId } from '../utils/companyScope.js';
const fail=(status,message)=>Object.assign(new Error(message),{status});
export async function customRoleRows(db,companyId){
  try {const [rows]=await db.query('SELECT CAST(r.id AS CHAR) id,r.name,r.description,cr.label,cr.permissions,cr.active FROM custom_roles cr JOIN roles r ON r.id=cr.role_id WHERE cr.company_id=? ORDER BY cr.label',[companyId]);
    return rows.map(row=>({...row,custom:true,active:Boolean(row.active),permissions:typeof row.permissions==='string'?JSON.parse(row.permissions):row.permissions}));
  } catch(error){if(error.code==='ER_NO_SUCH_TABLE')return [];throw error;}
}
export async function assignableRoles(db,companyId){
  const [rows]=await db.query('SELECT CAST(id AS CHAR) id,name FROM roles ORDER BY id');
  return [...rows.filter(role=>Object.hasOwn(ROLE_LABELS,role.name)).map(role=>({...role,label:ROLE_LABELS[role.name],custom:false})),...(await customRoleRows(db,companyId)).filter(role=>role.active)];
}
export async function listRoleCatalog(scope,dbPool=pool){
  if(!validCompanyId(scope?.companyId))throw fail(403,'El contexto MERTEL no está disponible.');
  const db=await dbPool.getConnection();try{
    const custom=await customRoleRows(db,scope.companyId);
    return [...Object.entries(ROLE_LABELS).map(([name,label])=>({name,label,custom:false,active:true,permissions:PERMISSIONS.map(p=>({...p,enabled:ROLE_PERMISSIONS[name].includes(p.name)}))})),
      ...custom.map(role=>({...role,permissions:PERMISSIONS.map(p=>({...p,enabled:role.permissions.includes(p.name)}))}))];
  } finally{db.release();}
}
export async function saveCustomRole({scope,actorId,roleId,body},dbPool=pool){
  if(!validCompanyId(scope?.companyId)||!validCompanyId(actorId)||roleId!==undefined&&!validCompanyId(roleId))throw fail(403,'Contexto de roles inválido.');
  if(!body||Object.keys(body).some(k=>!['label','description','permissions','active'].includes(k))||typeof body.label!=='string'||!body.label.trim()||body.label.trim().length>80||body.description!=null&&(typeof body.description!=='string'||body.description.length>255)||!Array.isArray(body.permissions)||body.permissions.length>PERMISSIONS.length||new Set(body.permissions).size!==body.permissions.length||body.permissions.some(name=>!PERMISSIONS.some(p=>p.name===name&&p.implemented&&p.name!=='companies.view'))||body.active!==undefined&&typeof body.active!=='boolean')throw fail(400,'Revisa el nombre y los permisos del rol.');
  const data={label:body.label.trim(),description:body.description?.trim()||null,permissions:expandPermissions(body.permissions),active:body.active??true};
  const db=await dbPool.getConnection();try{
    await db.beginTransaction();
    const [[company]]=await db.query("SELECT id FROM companies WHERE id=? AND status='active' AND deleted_at IS NULL FOR UPDATE",[scope.companyId]);
    const actor=await findUserById(actorId,db,true),roles=await userRoles(actorId,db),grants=permissionsForRoles(roles);
    if(!company||!isActiveUser(actor)||!grants.includes('roles.manage')||(actor.company_id!==null&&String(actor.company_id)!==String(scope.companyId)))throw fail(403,'No tienes permiso para administrar roles.');
    if(data.permissions.some(p=>!grants.includes(p)))throw fail(403,'Solo puedes asignar permisos que tú tienes.');
    let previous=null,name;
    if(roleId!==undefined){const [[row]]=await db.query('SELECT cr.*,r.name FROM custom_roles cr JOIN roles r ON r.id=cr.role_id WHERE cr.role_id=? AND cr.company_id=? FOR UPDATE',[roleId,scope.companyId]);if(!row)throw fail(404,'Solo se pueden editar roles personalizados de MERTEL.');previous=row;name=row.name;}
    else {name='custom_'+randomBytes(12).toString('hex');const [created]=await db.query('INSERT INTO roles(name,description) VALUES (?,?)',[name,data.description]);roleId=String(created.insertId);}
    if(previous)await db.query('UPDATE custom_roles SET label=?,permissions=?,active=? WHERE role_id=? AND company_id=?',[data.label,JSON.stringify(data.permissions),data.active?1:0,roleId,scope.companyId]);
    else await db.query('INSERT INTO custom_roles(role_id,company_id,label,permissions,active) VALUES (?,?,?,?,?)',[roleId,scope.companyId,data.label,JSON.stringify(data.permissions),data.active?1:0]);
    await db.query('UPDATE roles SET description=? WHERE id=?',[data.description,roleId]);
    await db.query('UPDATE auth_refresh_sessions s JOIN user_roles ur ON ur.user_id=s.user_id SET s.revoked_at=UTC_TIMESTAMP(3) WHERE ur.role_id=? AND s.revoked_at IS NULL',[roleId]);
    await db.query("INSERT INTO audit_logs(company_id,user_id,entity_type,entity_id,action,old_values,new_values) VALUES (?,?,'role',?,?,?,?)",[scope.companyId,actorId,roleId,previous?'ROLE_UPDATED':'ROLE_CREATED',previous?JSON.stringify({label:previous.label,permissions:previous.permissions,active:previous.active}):null,JSON.stringify(data)]);
    await db.commit();return {id:String(roleId),name,...data};
  }catch(error){await db.rollback();if(error.code==='ER_DUP_ENTRY')throw fail(409,'Ya existe un rol con ese nombre.');throw error;}finally{db.release();}
}
