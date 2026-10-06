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
async function request(action) {
  try { return await action(); } catch (error) { if (error?.name === "CanceledError" || error?.code === "ERR_CANCELED") throw error; throw safeError(error); }
}

export async function getMessageTemplateAdminData({ signal } = {}) {
  return request(async () => unwrap(await api.get("/collection/message-templates", { signal })));
}
export async function createMessageTemplate(payload) {
  return request(async () => unwrap(await api.post("/collection/message-templates", payload)));
}
export async function updateMessageTemplate(templateId, payload) {
  return request(async () => unwrap(await api.put(`/collection/message-templates/${encodeURIComponent(templateId)}`, payload)));
}
export async function setMessageTemplateActive(templateId, active) {
  const operation = active ? "activate" : "deactivate";
  return request(async () => unwrap(await api.post(`/collection/message-templates/${encodeURIComponent(templateId)}/${operation}`, {})));
}
