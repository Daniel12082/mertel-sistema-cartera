import {createHash,randomBytes,randomUUID} from 'node:crypto';
import nodemailer from 'nodemailer';
import pool from '../config/database.js';
import {hashPassword} from '../utils/password.js';
import {findUserById,findUserByLogin,isActiveUser,userRoles,passwordVersion} from '../models/auth.model.js';
import {permissionsForRoles} from '../config/permissions.js';
import {validCompanyId} from '../utils/companyScope.js';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const digest=token=>createHash('sha256').update(token).digest('hex');
export const RECOVERY_MESSAGE='Si el correo corresponde a una cuenta activa, recibirás un enlace para restablecer tu contraseña. Revisa también la carpeta de correo no deseado.';
async function auditCompany(user,db){if(user.company_id!==null)return user.company_id;const [[company]]=await db.query("SELECT id FROM companies WHERE name='MERTEL IMPORTACIONES' AND status='active' AND deleted_at IS NULL ORDER BY id LIMIT 1");return company?.id??null;}
export function mailConfiguration(env=process.env){
  const port=Number(env.SMTP_PORT||465),user=env.SMTP_USER||'cartera@cobranzasmertelimportaciones.com',from=env.SMTP_FROM||user;
  const ready=Boolean(env.SMTP_PASSWORD&&[465,587].includes(port)&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user)&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from));
  return {ready,host:env.SMTP_HOST||'smtp.hostinger.com',port,user,from,password:env.SMTP_PASSWORD};
}
export function recoveryStatus(env=process.env){const config=mailConfiguration(env);return {configured:config.ready,from:config.from,provider:'Hostinger SMTP'};}
function transport(config){return nodemailer.createTransport({host:config.host,port:config.port,secure:config.port===465,requireTLS:config.port!==465,auth:{user:config.user,pass:config.password},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,logger:false,debug:false,disableFileAccess:true,disableUrlAccess:true});}
export async function verifyRecoveryMail(){const config=mailConfiguration();if(!config.ready)throw fail(503,'El correo de recuperación aún no está configurado.');const mail=transport(config);try{await mail.verify();return recoveryStatus();}finally{mail.close();}}
async function deliver({to,url},env){const config=mailConfiguration(env),mail=transport(config);try{await mail.sendMail({from:{name:'MERTEL · Acceso',address:config.from},to,subject:'Restablece tu contraseña de MERTEL',text:`Recibimos una solicitud para restablecer tu contraseña de MERTEL.\n\nAbre este enlace para elegir una nueva contraseña:\n${url}\n\nEl enlace vence en 30 minutos y solo puede utilizarse una vez. Si no solicitaste este cambio, ignora este correo; tu contraseña no ha cambiado.\n\nMERTEL Importaciones`,disableFileAccess:true,disableUrlAccess:true});}finally{mail.close();}}
function validPassword(password){if(typeof password!=='string'||password.length<8||Buffer.byteLength(password)>1024)throw fail(400,'La nueva contraseña debe tener al menos 8 caracteres y máximo 1024 bytes.');}
export async function applyPasswordChange(db,{user,actorId,hash,action,companyId}){
  const version=randomUUID();
  await db.query('UPDATE users SET password_hash=? WHERE id=?',[hash,user.id]);
  await db.query('UPDATE auth_refresh_sessions SET revoked_at=UTC_TIMESTAMP(3) WHERE user_id=? AND revoked_at IS NULL',[user.id]);
  await db.query('UPDATE auth_password_resets SET used_at=UTC_TIMESTAMP(3) WHERE user_id=? AND used_at IS NULL',[user.id]);
  await db.query("INSERT INTO audit_logs(company_id,user_id,entity_type,entity_id,action,new_values) VALUES (?,?,'user',?,?,?)",[companyId??await auditCompany(user,db),actorId,user.id,action,JSON.stringify({password_changed:true,password_version:version})]);
  return {id:String(user.id),password_changed:true};
}
export async function changeManagedPassword({scope,actorId,userId,body},dbPool=pool){
  if(!validCompanyId(scope?.companyId)||!validCompanyId(actorId)||!validCompanyId(userId))throw fail(400,'Usuario inválido.');
  if(!body||Object.keys(body).length!==1||!Object.hasOwn(body,'password'))throw fail(400,'Envía únicamente la nueva contraseña.');
  validPassword(body.password);const hash=await hashPassword(body.password),db=await dbPool.getConnection();
  try{await db.beginTransaction();
    const actor=await findUserById(actorId,db,true),roles=await userRoles(actorId,db),grants=permissionsForRoles(roles);
    if(!isActiveUser(actor)||!grants.includes('users.reset_password')||(actor.company_id!==null&&String(actor.company_id)!==String(scope.companyId)))throw fail(403,'No tienes permiso para cambiar contraseñas.');
    const user=await findUserById(userId,db,true),targetRoles=user?await userRoles(userId,db):[];
    if(!user||user.deleted_at!==null||(String(user.company_id)!==String(scope.companyId)&&!(user.company_id===null&&targetRoles.some(role=>role.name==='admin'))))throw fail(404,'Usuario no encontrado.');
    if(permissionsForRoles(targetRoles).some(permission=>!grants.includes(permission)))throw fail(403,'No puedes cambiar la contraseña de una cuenta con permisos superiores a los tuyos.');
    const result=await applyPasswordChange(db,{user,actorId,hash,action:'USER_PASSWORD_CHANGED',companyId:scope.companyId});await db.commit();return result;
  }catch(error){await db.rollback();throw error;}finally{db.release();}
}
export async function requestPasswordRecovery(email,{dbPool=pool,env=process.env,send=deliver}={}){
  if(typeof email!=='string'||email.length>150||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))throw fail(400,'Ingresa un correo electrónico válido.');
  if(!mailConfiguration(env).ready)throw fail(503,'La recuperación por correo aún no está disponible. Contacta al administrador para cambiar tu contraseña.');
  const db=await dbPool.getConnection();let token,user;
  try{
    await db.beginTransaction();const candidate=await findUserByLogin(email.trim(),db);
    user=candidate?await findUserById(candidate.id,db,true):null;
    if(!isActiveUser(user)){await db.commit();return {message:RECOVERY_MESSAGE};}
    const [[recent]]=await db.query('SELECT id FROM auth_password_resets WHERE user_id=? AND created_at>UTC_TIMESTAMP(3)-INTERVAL 1 MINUTE LIMIT 1',[user.id]);
    if(recent){await db.commit();return {message:RECOVERY_MESSAGE};}
    token=randomBytes(32).toString('base64url');
    await db.query('UPDATE auth_password_resets SET used_at=UTC_TIMESTAMP(3) WHERE user_id=? AND used_at IS NULL',[user.id]);
    await db.query('INSERT INTO auth_password_resets(user_id,token_hash,password_version,expires_at) VALUES (?,?,?,UTC_TIMESTAMP(3)+INTERVAL 30 MINUTE)',[user.id,digest(token),await passwordVersion(user.id,db)]);
    await db.query("INSERT INTO audit_logs(company_id,user_id,entity_type,entity_id,action) VALUES (?,?,'user',?,'PASSWORD_RESET_REQUESTED')",[await auditCompany(user,db),user.id,user.id]);
    await db.commit();
  }catch(error){await db.rollback();throw error;}finally{db.release();}
  const origin=(env.FRONTEND_URL||'http://localhost:5173').split(',')[0].trim();
  const url=new URL('/restablecer-contrasena',origin);url.hash=new URLSearchParams({token}).toString();
  try{await send({to:user.email,url:url.toString()},env);}catch{
    await dbPool.query('UPDATE auth_password_resets SET used_at=UTC_TIMESTAMP(3) WHERE token_hash=?',[digest(token)]);
    await dbPool.query("INSERT INTO audit_logs(company_id,user_id,entity_type,entity_id,action) VALUES (?,?,'user',?,'PASSWORD_RESET_DELIVERY_FAILED')",[await auditCompany(user,dbPool),user.id,user.id]);
  }
  return {message:RECOVERY_MESSAGE};
}
export async function completePasswordRecovery({token,password},{dbPool=pool}={}){
  validPassword(password);if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))throw fail(400,'El enlace no es válido o ya venció. Solicita uno nuevo.');
  const hash=await hashPassword(password),db=await dbPool.getConnection();
  try{await db.beginTransaction();
    const [[known]]=await db.query('SELECT user_id FROM auth_password_resets WHERE token_hash=?',[digest(token)]);
    const user=known?await findUserById(known.user_id,db,true):null;
    const [[reset]]=await db.query('SELECT *,expires_at>UTC_TIMESTAMP(3) unexpired FROM auth_password_resets WHERE token_hash=? FOR UPDATE',[digest(token)]);
    if(!isActiveUser(user)||!reset||!reset.unexpired||reset.used_at!==null||(reset.password_version??null)!==await passwordVersion(user.id,db))throw fail(400,'El enlace no es válido o ya venció. Solicita uno nuevo.');
    const result=await applyPasswordChange(db,{user,actorId:user.id,hash,action:'PASSWORD_RESET_COMPLETED'});await db.commit();return result;
  }catch(error){await db.rollback();throw error;}finally{db.release();}
}
