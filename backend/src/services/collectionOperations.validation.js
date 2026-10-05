import { validCompanyId } from "../utils/companyScope.js";

export function operationError(status, message) { return Object.assign(new Error(message), { status }); }
export function operationId(value, name) {
  if (!validCompanyId(value)) throw operationError(400, `${name} debe ser un ID positivo válido.`);
  return String(value);
}
function text(value, name, max, required = false) {
  if (value == null && !required) return null;
  if (typeof value !== "string" || value.trim().length > max || (required && !value.trim())) throw operationError(400, `${name} no es válido.`);
  return value.trim() || null;
}
function date(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw operationError(400, "La fecha prometida debe ser YYYY-MM-DD.");
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(0); parsed.setUTCFullYear(year, month - 1, day);
  if (year < 1000 || parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) throw operationError(400, "La fecha prometida no existe.");
  return value;
}
function amount(value) {
  const input = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
  if (typeof input !== "string" || !/^\d{1,13}(?:\.\d{1,2})?$/.test(input)) throw operationError(400, "El valor prometido debe ser un monto positivo con máximo dos decimales.");
  const [whole, fraction = ""] = input.split(".");
  if (BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2)) <= 0n) throw operationError(400, "El valor prometido debe ser positivo.");
  return input;
}
export function validateOperation(kind, body) {
  const fields = kind === "action" ? ["invoice_id", "action_type", "description"] : ["invoice_id", "promised_date", "promised_amount", "notes"];
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !fields.includes(key))) throw operationError(400, "Campos de operación no válidos.");
  const invoice_id = body.invoice_id == null || body.invoice_id === "" ? null : operationId(body.invoice_id, "invoice_id");
  return kind === "action" ? { invoice_id, action_type: text(body.action_type, "Tipo de gestión", 50, true), description: text(body.description, "Observación", 4000, true) } :
    { invoice_id, promised_date: date(body.promised_date), promised_amount: amount(body.promised_amount), notes: text(body.notes, "Observación", 4000) };
}
