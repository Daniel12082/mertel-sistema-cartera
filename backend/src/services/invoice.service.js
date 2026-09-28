import {
  getAllInvoices,
  getInvoiceById,
  createInvoice,
  updateInvoice,
  deleteInvoice,
} from "../models/invoice.model.js";

export async function listInvoices() {
  return await getAllInvoices();
}

export async function getInvoice(id) {
  return await getInvoiceById(id);
}

export async function addInvoice(invoice, discountRule = null) {
  return await createInvoice(invoice, discountRule);
}

export async function editInvoice(id, invoice, discountRule = null) {
  return await updateInvoice(id, invoice, discountRule);
}

export async function removeInvoice(id) {
  return await deleteInvoice(id);
}
