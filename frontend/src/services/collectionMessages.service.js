import api from "./api";

function messageError(error) {
  const status = error?.response?.status;
  if (status === 403) return "No tienes permiso para preparar mensajes de este cliente.";
  if (status === 404) return "El cliente o la plantilla ya no están disponibles dentro de tu alcance.";
  if (status === 409) return "Falta información para preparar el mensaje. Revisa el teléfono y las variables.";
  if (status === 400) return "Revisa la plantilla y la fecha de referencia.";
  return "No fue posible consultar o preparar el mensaje. Intenta nuevamente.";
}
async function request(customerId, referenceDate, { templateId, prepare = false, signal, companyId } = {}) {
  try {
    const root = `/collection/customers/${encodeURIComponent(customerId)}`;
    const response = templateId ? (companyId ? await api.post(`${root}/messages/${prepare ? "prepare" : "preview"}`,
      { template_id: templateId, reference_date: referenceDate }, { params: { company_id: companyId }, signal }) : await api.post(`${root}/messages/${prepare ? "prepare" : "preview"}`,
      { template_id: templateId, reference_date: referenceDate }, { signal })) :
      await api.get(`${root}/message-templates`, { params: { reference_date: referenceDate, ...(companyId ? { company_id: companyId } : {}) }, signal });
    const data = response.data?.data;
    if (response.data?.success !== true || (templateId ? !data?.customer || !data?.template || typeof data.content !== "string" ||
        String(data.customer.id) !== String(customerId) || String(data.template.id) !== String(templateId) ||
        data.prepared !== prepare || !Array.isArray(data.variables) || !Array.isArray(data.missing_variables) ||
        !Array.isArray(data.unsupported_variables) || typeof data.can_prepare !== "boolean" : !Array.isArray(data))) throw new Error("message_contract");
    return data;
  } catch (error) {
    if (signal?.aborted) throw error;
    throw Object.assign(new Error(messageError(error)), { status: error?.response?.status });
  }
}
export const getCollectionMessageTemplates = (customerId, referenceDate, options = {}) => request(customerId, referenceDate, options);
export const previewCollectionMessage = (customerId, referenceDate, templateId, options = {}) => request(customerId, referenceDate, { ...options, templateId });
export const prepareCollectionMessage = (customerId, referenceDate, templateId, options = {}) => request(customerId, referenceDate, { ...options, templateId, prepare: true });
