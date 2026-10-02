import argon2 from "argon2";
import { randomBytes } from "node:crypto";
export function hashPassword(password) {
  if (typeof password !== "string" || !password || Buffer.byteLength(password) > 1024) throw new TypeError("Contraseña inválida");
  return argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
}
let dummyHash;
export async function verifyPassword(hash, password) {
  // Absent/incompatible users also require a real verification.
  dummyHash ??= hashPassword(randomBytes(32).toString("base64url"));
  const dummy = await dummyHash;
  const compatible = typeof hash === "string" && hash.startsWith("$argon2id$");
  try { return (await argon2.verify(compatible ? hash : dummy, password)) && compatible; }
  catch { await argon2.verify(dummy, password); return false; }
}
