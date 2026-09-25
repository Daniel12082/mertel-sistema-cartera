import api from "./api";

export async function getCustomers() {
  const response = await api.get("/customers");

  return response.data;
}