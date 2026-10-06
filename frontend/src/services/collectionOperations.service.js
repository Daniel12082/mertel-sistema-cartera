import api from "./api";

export function operationErrorMessage(error) {
  const status = error?.response?.status;
  if (status === 403) return "No tienes permiso para esta operación de cobranza.";
  if (status === 404) return "No se encontró el cliente o la factura dentro de tu alcance.";
  if (status === 400) return "Revisa el tipo, la observación, la fecha y el valor ingresados.";
  if (status === 409) return "El cliente no está disponible para registrar operaciones.";
  return "No fue posible procesar la operación. Intenta nuevamente.";
}
async function request(kind, customerId, { body, invoiceId, signal } = {}) {
  try {
    const path = `/collection/customers/${encodeURIComponent(customerId)}/${kind}`;
    const params = { ...(invoiceId ? { invoice_id: invoiceId } : {}) };
    const response = body ? await api.post(path, body) : await api.get(path, { params, signal });
    if (response.data?.success !== true || (body ? !response.data.data?.id : !Array.isArray(response.data.data))) throw new Error("operation_contract");
    return response.data.data;
  } catch (error) {
    if (signal?.aborted) throw error;
    throw Object.assign(new Error(operationErrorMessage(error)), { status: error?.response?.status });
  }
}
export const getCollectionActions = (customerId, options) => request("actions", customerId, options);
export const getPaymentPromises = (customerId, options) => request("promises", customerId, options);
export const createCollectionAction = (customerId, body, options) => request("actions", customerId, { ...options, body });
export const createPaymentPromise = (customerId, body, options) => request("promises", customerId, { ...options, body });
