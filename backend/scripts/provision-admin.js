import dotenv from "dotenv";
import mysql from "mysql2/promise";
import { createInterface, emitKeypressEvents } from "node:readline";
import { provisionFirstAdmin } from "../src/services/adminProvisioning.service.js";
dotenv.config({ path: new URL("../.env", import.meta.url), quiet: true });

function hiddenInput(prompt) {
  return new Promise((resolve, reject) => {
    const wasRaw = process.stdin.isRaw;
    let value = "";
    process.stdout.write(prompt);
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true); process.stdin.resume();
    function finish(error) {
      process.stdin.removeListener("keypress", onKey);
      process.stdin.setRawMode(Boolean(wasRaw)); process.stdin.pause();
      process.stdout.write("\n");
      const result = value; value = "";
      if (error) reject(error); else resolve(result);
    }
    function onKey(text, key = {}) {
      if (key.ctrl && key.name === "c") return finish(new Error("Provisioning cancelado"));
      if (key.name === "return" || key.name === "enter") return finish();
      if (key.name === "backspace") { value = Array.from(value).slice(0, -1).join(""); return; }
      if (!key.ctrl && !key.meta && text && !/[\x00-\x1f\x7f]/.test(text)) {
        if (Buffer.byteLength(value + text) > 1024) return finish(new Error("La contraseña supera el máximo de 1024 bytes"));
        value += text;
      }
    }
    process.stdin.on("keypress", onKey);
  });
}
let db;
try {
  const args = process.argv.slice(2);
  if ((args.length !== 0 && !(args.length === 2 && args[0] === "--email")) || !process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Usa una terminal interactiva; solo se admite --email, nunca contraseña en argumentos/ENV o redirecciones");
  }
  db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  let email = args[1];
  if (email === undefined) {
    const readline = createInterface({ input: process.stdin, output: process.stdout });
    email = await new Promise(resolve => readline.question("Email real del propietario: ", resolve));
    readline.close();
  } else console.log(`Email del propietario: ${email}`);
  const result = await provisionFirstAdmin(db, { email, passwordProvider: async () => {
    let password = await hiddenInput("Contraseña inicial (oculta): ");
    let confirmation = await hiddenInput("Confirmar contraseña (oculta): ");
    if (!password || password !== confirmation) throw new Error("Las contraseñas deben coincidir y no estar vacías");
    confirmation = undefined;
    const result = password; password = undefined;
    return result;
  } });
  console.log(JSON.stringify({ created: result.created, username: result.user.username, role: result.role, status: result.user.status }));
} catch (error) {
  console.error(error.code || error.sql ? "No se pudo conectar/provisionar; revisa configuración y migraciones de auth" : error.message);
  process.exitCode = 1;
} finally { if (db) await db.end(); }
