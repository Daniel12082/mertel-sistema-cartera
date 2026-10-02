import {
  getAllInvoices,
  getInvoiceById,
  createInvoice,
  updateInvoice,
  deleteInvoice,
} from "../models/invoice.model.js";

export function calculateDiscountFromRule(baseValue, rule) {
  if (!rule || rule.active !== true) {
    return null;
  }

  if (rule.baseCalculation !== "base_value") {
    throw new Error("Regla de descuento con base de cálculo no soportada");
  }

  const percentageInput = rule.percentage;
  const baseInput = baseValue;
  const percentage = Number(percentageInput);
  const base = Number(baseInput);
  if (
    (typeof percentageInput !== "number" &&
      !(typeof percentageInput === "string" && percentageInput.trim() !== "")) ||
    !Number.isFinite(percentage) ||
    percentage < 0
  ) {
    throw new Error("Regla de descuento con porcentaje inválido");
  }
  if (
    (typeof baseInput !== "number" &&
      !(typeof baseInput === "string" && baseInput.trim() !== "")) ||
    !Number.isFinite(base) ||
    base < 0
  ) {
    throw new Error("Valor base de descuento inválido");
  }

  return Number(((base * percentage) / 100).toFixed(2));
}

export async function listInvoices(scope) {
  return await getAllInvoices(scope);
}

export async function getInvoice(id, scope) {
  return await getInvoiceById(id, scope);
}

export async function addInvoice(invoice, scope) {
  return await createInvoice(invoice, scope);
}

export async function editInvoice(id, invoice, scope) {
  return await updateInvoice(id, invoice, scope);
}

export async function removeInvoice(id, scope) {
  return await deleteInvoice(id, scope);
}
