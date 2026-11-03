import pool from '../config/database.js';
import {hashPassword} from '../utils/password.js';
import {ROLE_LABELS,permissionsForRoles} from '../config/permissions.js';
import {validCompanyId} from '../utils/companyScope.js';
import {findUserById,isActiveUser,userRoles} from '../models/auth.model.js';

const fail=(status,message)=>Object.assign(new Error(message),{status});
const ownership="(u.company_id=? OR (u.company_id IS NULL AND EXISTS (SELECT 1 FROM user_roles legacy JOIN roles lr ON lr.id=legacy.role_id WHERE legacy.user_id=u.id AND lr.name='admin')))";
const columns='CAST(u.id AS CHAR) id,u.username,u.first_name,u.last_name,u.email,u.phone,u.status';
function text(value,max,required=false){
  if(value==null&&!required)return null;
  if(typeof value!=='string'||value.trim().length>max||(required&&!value.trim()))throw fail(400,'Revisa los datos básicos del usuario.');
  return value.trim()||null;
}
export function parseManagedUser(body,creating=false){
  const allowed=['first_name','last_name','username','email','phone','roles',...(creating?['password']:[])];
  if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).some(key=>!allowed.includes(key)))throw fail(400,'Campos de usuario no permitidos.');
  const data={first_name:text(body.first_name,100,true),last_name:text(body.last_name,100),username:text(body.username,50),email:text(body.email,150,true),phone:text(body.phone,50)};
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))throw fail(400,'Correo electrónico inválido.');
  if(data.username&&!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,49}$/.test(data.username))throw fail(400,'Usuario inválido: usa entre 3 y 50 letras, números, puntos, guiones o guiones bajos.');
  if(!Array.isArray(body.roles)||!body.roles.length||body.roles.length>Object.keys(ROLE_LABELS).length||new Set(body.roles).size!==body.roles.length||body.roles.some(role=>!Object.hasOwn(ROLE_LABELS,role)))throw fail(400,'Selecciona únicamente roles existentes, sin duplicados.');
  data.roles=[...body.roles].sort();
  if(creating&&(typeof body.password!=='string'||!body.password||Buffer.byteLength(body.password)>1024))throw fail(400,'La contraseña es obligatoria y admite hasta 1024 bytes.');
  return data;
}
async function roleList(db){
  const [rows]=await db.query('SELECT CAST(id AS CHAR) id,name FROM roles ORDER BY id');
  return rows.filter(role=>Object.hasOwn(ROLE_LABELS,role.name)).map(role=>({...role,label:ROLE_LABELS[role.name]}));
}
async function readUsers(db,scope){
  const [users]=await db.query(`SELECT ${columns} FROM users u WHERE ${ownership} AND u.deleted_at IS NULL ORDER BY u.first_name,u.id`,[scope.companyId]);
  const [assignments]=await db.query(`SELECT CAST(ur.user_id AS CHAR) user_id,r.name FROM user_roles ur JOIN roles r ON r.id=ur.role_id JOIN users u ON u.id=ur.user_id WHERE ${ownership} AND u.deleted_at IS NULL ORDER BY r.id`,[scope.companyId]);
  const byUser=new Map();for(const row of assignments){if(!byUser.has(row.user_id))byUser.set(row.user_id,[]);byUser.get(row.user_id).push(row.name);}
  return users.map(user=>({...user,roles:byUser.get(user.id)||[]}));
}
export async function listManagedUsers(scope,dbPool=pool){
  if(!validCompanyId(scope?.companyId))throw fail(403,'El contexto MERTEL no está disponible.');
  const db=await dbPool.getConnection();try{await db.query('START TRANSACTION READ ONLY');const users=await readUsers(db,scope),roles=await roleList(db);await db.commit();return {users,roles};}
  catch(error){try{await db.rollback();}catch{}throw error;}finally{db.release();}
}
export async function saveManagedUser({scope,actorId,userId,body,statusOnly=false},dbPool=pool){
  if(!validCompanyId(scope?.companyId)||!validCompanyId(actorId))throw fail(403,'El contexto administrativo no está disponible.');
  const creating=userId===undefined;if(!creating&&!validCompanyId(userId))throw fail(400,'Usuario inválido.');
  let data;
  if(statusOnly){if(creating||!body||Object.keys(body).length!==1||!['active','inactive'].includes(body.status))throw fail(400,'Estado de usuario inválido.');data={status:body.status};}
  else data=parseManagedUser(body,creating);
  // Reuse the existing Argon2id implementation, outside database locks.
  const passwordHash=creating?await hashPassword(body.password):null;
  const db=await dbPool.getConnection();
  try{
    await db.beginTransaction();
    const [[company]]=await db.query("SELECT id FROM companies WHERE id=? AND status='active' AND deleted_at IS NULL FOR UPDATE",[scope.companyId]);
    if(!company)throw fail(403,'MERTEL no está disponible.');
    const actor=await findUserById(actorId,db,true),actorRoles=await userRoles(actorId,db);
    if(!isActiveUser(actor)||!permissionsForRoles(actorRoles).includes('settings.manage')||(actor.company_id!==null&&String(actor.company_id)!==String(scope.companyId)))throw fail(403,'La sesión ya no tiene acceso administrativo.');
    let previous=null;
    if(!creating){const [[user]]=await db.query(`SELECT ${columns},u.company_id FROM users u WHERE u.id=? AND ${ownership} AND u.deleted_at IS NULL FOR UPDATE`,[userId,scope.companyId]);if(!user)throw fail(404,'Usuario no encontrado.');previous=user;
      const [roles]=await db.query('SELECT r.name FROM roles r JOIN user_roles ur ON ur.role_id=r.id WHERE ur.user_id=?',[userId]);previous.roles=roles.map(role=>role.name);
      const removingAdmin=previous.roles.includes('admin')&&(statusOnly?data.status==='inactive':!data.roles.includes('admin'));
      if(String(actorId)===String(userId)&&removingAdmin)throw fail(409,'No puedes desactivar tu cuenta ni retirar tu propio rol administrativo.');
      if(previous.company_id===null&&!statusOnly&&!data.roles.includes('admin'))throw fail(409,'La cuenta administrativa original debe conservar su rol admin.');
      if(removingAdmin&&previous.status==='active'){
        const [[count]]=await db.query(`SELECT COUNT(DISTINCT u.id) count FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE ${ownership} AND u.deleted_at IS NULL AND u.status='active' AND r.name='admin' AND u.id<>?`,[scope.companyId,userId]);
        if(Number(count.count)===0)throw fail(409,'Debe permanecer al menos un administrador activo.');
      }
    }
    if(statusOnly){await db.query('UPDATE users SET status=? WHERE id=?',[data.status,userId]);}
    else{
      const roles=await roleList(db),selected=data.roles.map(name=>roles.find(role=>role.name===name));
      if(selected.some(role=>!role))throw fail(400,'Un rol seleccionado no existe en la base de datos.');
      if(creating){await db.query("INSERT INTO users(company_id,first_name,last_name,username,email,phone,password_hash,status) VALUES (?,?,?,?,?,?,?,'active')",[scope.companyId,data.first_name,data.last_name,data.username,data.email,data.phone,passwordHash]);const [[created]]=await db.query('SELECT CAST(LAST_INSERT_ID() AS CHAR) id');userId=created.id;}
      else await db.query('UPDATE users SET first_name=?,last_name=?,username=?,email=?,phone=? WHERE id=?',[data.first_name,data.last_name,data.username,data.email,data.phone,userId]);
      await db.query('DELETE FROM user_roles WHERE user_id=?',[userId]);
      for(const role of selected)await db.query('INSERT INTO user_roles(user_id,role_id) VALUES (?,?)',[userId,role.id]);
    }
    const rolesChanged=previous&&!statusOnly&&[...previous.roles].sort().join(',')!==data.roles.join(',');
    if(previous&&(rolesChanged||(statusOnly&&previous.status!==data.status)))await db.query('UPDATE auth_refresh_sessions SET revoked_at=UTC_TIMESTAMP(3) WHERE user_id=? AND revoked_at IS NULL',[userId]);
    const after={...(statusOnly?{status:data.status}:data),...(creating?{status:'active'}:{})};
    await db.query("INSERT INTO audit_logs(company_id,user_id,entity_type,entity_id,action,old_values,new_values) VALUES (?,?,'user',?,?,?,?)",[scope.companyId,actorId,userId,creating?'USER_CREATED':statusOnly?'USER_STATUS_CHANGED':'USER_UPDATED',previous?JSON.stringify({first_name:previous.first_name,last_name:previous.last_name,username:previous.username,email:previous.email,phone:previous.phone,status:previous.status,roles:previous.roles}):null,JSON.stringify(after)]);
    await db.commit();return {id:String(userId),...after};
  }catch(error){try{await db.rollback();}catch{}if(error.code==='ER_DUP_ENTRY')throw fail(409,'El correo o nombre de usuario ya está registrado.');throw error;}
  finally{db.release();}
}
