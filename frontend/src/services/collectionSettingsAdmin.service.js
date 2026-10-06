import api from "./api";

function unwrap(response) {
  const body = response?.data;
  if (body?.success !== true || !body.data) throw new Error("No fue posible interpretar la configuración de cobranza.");
  return body.data;
}
function safeError(error) {
  const status = error?.response?.status;
  if (status === 400) return new Error(error.response.data?.message || "Revisa los valores enviados.");
  if (status === 403) return new Error("No tienes permiso o la empresa no está disponible.");
  if (status === 409) return new Error(error.response.data?.message || "La configuración no está disponible para esta empresa.");
  return new Error("No fue posible administrar la configuración de cobranza. Intenta nuevamente.");
}
function config(companyId, signal) {
  return { params: companyId ? { company_id: companyId } : undefined, signal };
}
async function request(action) {
  try { return await action(); }
  catch (error) {
    if (error?.name === "CanceledError" || error?.code === "ERR_CANCELED") throw error;
    throw safeError(error);
  }
}
export async function getCollectionSettings({ companyId, signal } = {}) {
  return request(async () => unwrap(await api.get("/admin/settings", config(companyId, signal))));
}
export async function updateCollectionStages(stages, { companyId } = {}) {
  return request(async () => unwrap(await api.put("/admin/settings/collection-rules", { stages }, config(companyId))));
}
export async function getSettingsAdminCompanies({ signal } = {}) {
  return request(async () => {
    const body = await api.get("/admin/companies", { signal });
    const data = body?.data?.data;
    if (!Array.isArray(data)) throw new Error("No fue posible interpretar las empresas disponibles.");
    return data;
  });
}
