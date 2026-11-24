import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';
let db;
try {
  db=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,multipleStatements:true});
  await db.query(await readFile(new URL('../config/user-access.sql',import.meta.url),'utf8'));
  console.log('Roles personalizados y recuperación de contraseñas preparados.');
} catch {console.error('No se pudo preparar la migración de acceso.');process.exitCode=1;}
finally {if(db)await db.end();}
