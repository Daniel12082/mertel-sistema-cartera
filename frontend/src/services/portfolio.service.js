import api from "./api";

export async function getPortfolio(params) {
  const response = await api.get("/portfolio", { params });
  return response.data;
}

export async function getPortfolioSummary(params) {
  const response = await api.get("/portfolio/summary", { params });
  return response.data;
}

export async function getPortfolioCustomers(params) {
  const response = await api.get("/portfolio/customers", { params });
  return response.data;
}

export async function getPortfolioCustomer(customerId, params) {
  const response = await api.get(`/portfolio/customer/${customerId}`, { params });
  return response.data;
}

export async function getPortfolioReconciliation(params) {
  const response = await api.get("/portfolio/reconciliation", { params });
  return response.data;
}
