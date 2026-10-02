import {
  addPayment,
  addPaymentAllocation,
  editPayment,
  getPayment,
  listPaymentAllocations,
  listPayments,
  removePayment,
  reversePaymentAllocation,
} from "../services/payment.service.js";

function parsePositiveId(value) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function normalizeMoney(value, { allowZero = true } = {}) {
  let text;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0 || value > 9999999999999.99 || Number(value.toFixed(2)) !== value) return null;
    text = value.toFixed(2);
  } else if (typeof value === "string") {
    text = value.trim();
  } else {
    return null;
  }

  if (!/^\d{1,13}(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const cents = BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
  if (!allowZero && cents === 0n) return null;
  return text;
}

function isPositiveId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isDate(value) {
  const match = typeof value === "string" ? value.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(0);
  date.setUTCFullYear(y, m - 1, d);
  return y >= 1000 && date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function optionalId(value) {
  if (value === undefined || value === null) return { valid: true, value: null };
  return isPositiveId(value) ? { valid: true, value } : { valid: false, value: null };
}

function optionalText(value, maxLength = Infinity) {
  return value === undefined || value === null || (typeof value === "string" && value.length <= maxLength);
}

function normalizePayment(body = {}) {
  const company = optionalId(body?.company_id);
  const creator = optionalId(body?.created_by);
  const amount = normalizeMoney(body?.amount, { allowZero: false });
  if (!isPositiveId(body?.customer_id) || !isDate(body?.payment_date) || !amount || !company.valid || !creator.valid) return null;
  if (!optionalText(body.payment_method, 50) || !optionalText(body.reference, 150) || !optionalText(body.status, 30) || !optionalText(body.notes)) return null;

  const status = body.status === undefined ? "confirmed" : body.status;
  if (typeof status !== "string" || status.trim() === "") return null;

  return {
    company_id: body.company_id === undefined ? undefined : company.value,
    customer_id: body.customer_id,
    payment_date: body.payment_date,
    amount,
    payment_method: body.payment_method ?? null,
    reference: body.reference ?? null,
    status,
    notes: body.notes ?? null,
    created_by: creator.value,
  };
}

function publicError(res, error) {
  if (error.status) return res.status(error.status).json({ success: false, message: error.message });
  const knownErrors = {
    CUSTOMER_NOT_FOUND: [404, "Cliente no encontrado"],
    COMPANY_NOT_FOUND: [404, "Empresa no encontrada"],
    USER_NOT_FOUND: [404, "Usuario creador no encontrado"],
    PAYMENT_NOT_FOUND: [404, "Pago no encontrado"],
    INVOICE_NOT_FOUND: [404, "Factura no encontrada"],
    ALLOCATION_NOT_FOUND: [404, "Asignación no encontrada para este pago"],
    CUSTOMER_MISMATCH: [409, "El pago y la factura pertenecen a clientes diferentes"],
    PAYMENT_OVERALLOCATION: [409, "El valor supera el disponible del pago"],
    INVOICE_OVERALLOCATION: [409, "El valor supera el saldo disponible de la factura"],
    INVOICE_BALANCE_CONFLICT: [409, "No fue posible actualizar el saldo de la factura"],
    ALLOCATION_ALREADY_EXISTS: [409, "Este pago ya tiene una asignación activa para la factura"],
    ALLOCATION_ALREADY_REVERSED: [409, "La asignación ya fue revertida"],
    PAYMENT_AMOUNT_IN_USE: [409, "No se puede cambiar el valor de un pago con asignaciones o historial de asignaciones"],
    PAYMENT_CUSTOMER_IN_USE: [409, "No se puede cambiar el cliente de un pago con asignaciones o historial de asignaciones"],
    PAYMENT_AMOUNT_BELOW_ALLOCATED: [409, "El valor del pago no puede ser menor que sus asignaciones activas"],
    PAYMENT_DELETE_UNSUPPORTED: [409, "No se pueden eliminar pagos: la tabla no tiene baja lógica y el borrado físico está deshabilitado"],
  };
  const mapped = knownErrors[error.code];
  if (mapped) return res.status(mapped[0]).json({ success: false, message: mapped[1] });
  if (error.code === "ER_DUP_ENTRY") {
    return res.status(409).json({ success: false, message: "Ya existe una asignación para esta pareja de pago y factura" });
  }
  if (error.code === "ER_NO_REFERENCED_ROW_2") {
    return res.status(404).json({ success: false, message: "No se encontró una referencia del pago" });
  }
  console.error("Error procesando pagos:", error);
  return res.status(500).json({ success: false, message: "No se pudo procesar la solicitud de pagos" });
}

export async function getPayments(req, res) {
  try {
    return res.status(200).json({ success: true, data: await listPayments(req.companyScope) });
  } catch (error) { return publicError(res, error); }
}

export async function getPaymentById(req, res) {
  const id = parsePositiveId(req.params.id);
  if (id === null) return res.status(400).json({ success: false, message: "ID inválido" });
  try {
    const payment = await getPayment(id, req.companyScope);
    if (!payment) return res.status(404).json({ success: false, message: "Pago no encontrado" });
    return res.status(200).json({ success: true, data: payment });
  } catch (error) { return publicError(res, error); }
}

export async function createPayment(req, res) {
  const payment = normalizePayment(req.body);
  if (!payment) return res.status(400).json({ success: false, message: "Cliente, fecha y valor positivo del pago son obligatorios y válidos" });
  try {
    return res.status(201).json({ success: true, data: await addPayment(payment, req.companyScope) });
  } catch (error) { return publicError(res, error); }
}

export async function updatePayment(req, res) {
  const id = parsePositiveId(req.params.id);
  if (id === null) return res.status(400).json({ success: false, message: "ID inválido" });
  const payment = normalizePayment(req.body);
  if (!payment) return res.status(400).json({ success: false, message: "Cliente, fecha y valor positivo del pago son obligatorios y válidos" });
  try {
    const updated = await editPayment(id, payment, req.companyScope);
    if (!updated) return res.status(404).json({ success: false, message: "Pago no encontrado" });
    return res.status(200).json({ success: true, data: updated });
  } catch (error) { return publicError(res, error); }
}

export async function deletePayment(req, res) {
  const id = parsePositiveId(req.params.id);
  if (id === null) return res.status(400).json({ success: false, message: "ID inválido" });
  try {
    const removed = await removePayment(id, req.companyScope);
    if (!removed) return res.status(404).json({ success: false, message: "Pago no encontrado" });
    return res.status(204).end();
  } catch (error) {
    if (error.code === "PAYMENT_DELETE_UNSUPPORTED") return publicError(res, error);
    if (error.code === "PAYMENT_NOT_FOUND") return publicError(res, error);
    return publicError(res, error);
  }
}

export async function getPaymentAllocations(req, res) {
  const paymentId = parsePositiveId(req.params.paymentId);
  if (paymentId === null) return res.status(400).json({ success: false, message: "ID de pago inválido" });
  try {
    return res.status(200).json({ success: true, data: await listPaymentAllocations(paymentId, req.companyScope) });
  } catch (error) { return publicError(res, error); }
}

export async function createPaymentAllocation(req, res) {
  const paymentId = parsePositiveId(req.params.paymentId);
  const invoiceId = req.body?.invoice_id;
  const amount = normalizeMoney(req.body?.amount, { allowZero: false });
  if (paymentId === null) return res.status(400).json({ success: false, message: "ID de pago inválido" });
  if (!isPositiveId(invoiceId) || !amount) return res.status(400).json({ success: false, message: "Factura y valor positivo de asignación son obligatorios y válidos" });
  try {
    const allocation = await addPaymentAllocation(paymentId, { invoice_id: invoiceId, amount }, req.companyScope);
    return res.status(201).json({ success: true, data: allocation });
  } catch (error) { return publicError(res, error); }
}

export async function deletePaymentAllocation(req, res) {
  const paymentId = parsePositiveId(req.params.paymentId);
  const allocationId = parsePositiveId(req.params.allocationId);
  if (paymentId === null || allocationId === null) return res.status(400).json({ success: false, message: "ID inválido" });
  try {
    return res.status(200).json({ success: true, data: await reversePaymentAllocation(paymentId, allocationId, req.companyScope) });
  } catch (error) { return publicError(res, error); }
}
