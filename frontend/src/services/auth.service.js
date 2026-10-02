import api from "./api";
export async function getAuthenticatedUser() {
  const response = await api.get("/auth/me");
  return response.data.data;
}
export async function getRoleCatalog() {
  const response = await api.get("/admin/roles");
  return response.data.data;
}
