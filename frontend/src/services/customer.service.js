import api from "./api";

export async function getCustomers() {
  const response = await api.get("/customers");
  return response.data;
}

export async function createCustomer(customer) {
  const response = await api.post("/customers", customer);
  return response.data;
}