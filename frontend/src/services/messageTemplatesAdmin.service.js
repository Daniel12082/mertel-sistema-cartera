import api from "./api";

function unwrap(response) {
  const body = response?.data;
  if (body?.success !== true || !body.data) throw new Error("No fue posible interpretar la respuesta de plantillas.");
  return body.data;
}
function safeError(error) {
  if (error?.response?.status === 403) return new Error("No tienes permiso para administrar plantillas WhatsApp.");
  if (error?.response?.status === 404) return new Error("La plantilla no existe dentro del alcance de tu empresa.");
  if (error?.response?.status === 400) return new Error(error.response.data?.message || "Revisa los datos de la plantilla.");
  return new Error("No fue posible administrar las plantillas. Intenta nuevamente.");
}
function config(companyId, signal) {
  return { params: companyId ? { company_id: companyId } : undefined, signal };
}
async function request(action) {
  try { return await action(); } catch (error) { if (error?.name === "CanceledError" || error?.code === "ERR_CANCELED") throw error; throw safeError(error); }
}

export async function getMessageTemplateAdminData({ companyId, signal } = {}) {
  return request(async () => unwrap(await api.get("/collection/message-templates", config(companyId, signal))));
}
export async function createMessageTemplate(payload, { companyId } = {}) {
  return request(async () => unwrap(await api.post("/collection/message-templates", payload, config(companyId))));
}
export async function updateMessageTemplate(templateId, payload, { companyId } = {}) {
  return request(async () => unwrap(await api.put(`/collection/message-templates/${encodeURIComponent(templateId)}`, payload, config(companyId))));
}
export async function setMessageTemplateActive(templateId, active, { companyId } = {}) {
  const operation = active ? "activate" : "deactivate";
  return request(async () => unwrap(await api.post(`/collection/message-templates/${encodeURIComponent(templateId)}/${operation}`, {}, config(companyId))));
}
export async function getAdminCompanies({ signal } = {}) {
  return request(async () => {
    const body = await api.get("/admin/companies", { signal });
    const data = body?.data?.data;
    if (!Array.isArray(data)) throw new Error("No fue posible interpretar las empresas disponibles.");
    return data;
  });
}
