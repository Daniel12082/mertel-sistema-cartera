import api from "./api";

function message(error) {
  if (error?.response?.status === 403) return "No tienes permiso para consultar este historial.";
  if ([400, 404].includes(error?.response?.status)) return error.response.data?.message || "Revisa el alcance y los filtros del historial.";
  return "No fue posible consultar el historial. Intenta nuevamente.";
}
async function request(path, params, signal) {
  try {
    const response = await api.get(path, { params, signal });
    const data = response.data?.data;
    if (response.data?.success !== true || !Array.isArray(data?.events) || !data?.pagination) throw new Error("history_contract");
    return data;
  } catch (error) {
    if (signal?.aborted || error?.name === "CanceledError" || error?.code === "ERR_CANCELED") throw error;
    throw new Error(message(error), { cause: error });
  }
}
export const getCustomerHistory = (customerId, params, { signal } = {}) => request(`/collection/customers/${encodeURIComponent(customerId)}/history`, params, signal);
export const getAdministrativeHistory = (params, { signal } = {}) => request("/admin/collection/history", params, signal);
export async function getAdministrativeHistoryActors({ signal } = {}) {
  try {
    const response = await api.get("/admin/collection/history/actors", { signal });
    if (response.data?.success !== true || !Array.isArray(response.data?.data)) throw new Error("history_actors_contract");
    return response.data.data;
  } catch (error) {
    if (signal?.aborted || error?.name === "CanceledError" || error?.code === "ERR_CANCELED") throw error;
    throw new Error(message(error), { cause: error });
  }
}
