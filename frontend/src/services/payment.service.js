import api from "./api";

export async function getPayments() {
  const response = await api.get("/payments");
  return response.data;
}

export async function getPaymentById(id) {
  const response = await api.get(`/payments/${id}`);
  return response.data;
}

export async function createPayment(data) {
  const response = await api.post("/payments", data);
  return response.data;
}

export async function updatePayment(id, data) {
  const response = await api.put(`/payments/${id}`, data);
  return response.data;
}

export async function getPaymentAllocations(paymentId) {
  const response = await api.get(`/payments/${paymentId}/allocations`);
  return response.data;
}

export async function createPaymentAllocation(paymentId, data) {
  const response = await api.post(`/payments/${paymentId}/allocations`, data);
  return response.data;
}

export async function reversePaymentAllocation(paymentId, allocationId) {
  const response = await api.delete(`/payments/${paymentId}/allocations/${allocationId}`);
  return response.data;
}
