import api from "./api";
export async function getAuthenticatedUser(accessToken) {
  const response = await api.get("/auth/me", { headers: { Authorization: `Bearer ${accessToken}` } });
  return response.data.data;
}
export async function getRoleCatalog(accessToken) {
  const response = await api.get("/admin/roles", { headers: { Authorization: `Bearer ${accessToken}` } });
  return response.data.data;
}
