import api from "./api";

export async function getInvoices() {
  const response = await api.get("/invoices");
  return response.data;
}

export async function getInvoiceById(id) {
  const response = await api.get(`/invoices/${id}`);
  return response.data;
}

export async function createInvoice(invoice) {
  const response = await api.post("/invoices", invoice);
  return response.data;
}

export async function updateInvoice(id, invoice) {
  const response = await api.put(`/invoices/${id}`, invoice);
  return response.data;
}

export async function deleteInvoice(id) {
  const response = await api.delete(`/invoices/${id}`);
  return response.data;
}
