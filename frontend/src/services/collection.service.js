import api from "./api";

// HTTP contract from backend/src/services/collection.service.js (phase 4.7A).
// Unwrap the API envelope without renaming or reconstructing its fields.
export function readCollectionResponse(response) {
  const body = response?.data ?? response;
  const customers = body?.customers;
  if (!Array.isArray(customers) || typeof body.rules_configured !== "boolean" ||
      !body.summary?.stages || response?.success === false) throw new Error("collection_contract");
  if (body.stage_catalog !== undefined && (!Array.isArray(body.stage_catalog) || body.stage_catalog.some(stage => typeof stage?.key !== "string" || typeof stage.label !== "string") || new Set(body.stage_catalog.map(stage => stage.key)).size !== body.stage_catalog.length)) throw new Error("collection_contract");
  if (body.configuration_warnings !== undefined && (!Array.isArray(body.configuration_warnings) || body.configuration_warnings.some(warning => typeof warning !== "string"))) throw new Error("collection_contract");
  const ids = new Set();
  for (const item of customers) {
    if (item?.customer?.id == null || typeof item.stage !== "string" ||
        !Array.isArray(item.invoices) || ids.has(String(item.customer.id))) throw new Error("collection_contract");
    ids.add(String(item.customer.id));
  }
  return body;
}

export function collectionError(error) {
  const status = error?.response?.status;
  if (status === 403) return "No tienes permiso para consultar cobranza.";
  if (status === 404 || status === 501) return "La consulta de cobranza no está disponible en este servidor. Verifica el despliegue de la API.";
  if (status === 400 && error.response?.data?.message === "El administrador global debe indicar company_id para consultar una empresa.") return "Esta sesión requiere un contexto de empresa para consultar MERTEL. Utiliza una cuenta asignada a MERTEL.";
  if (status === 400) return "Revisa la fecha de referencia seleccionada.";
  if (error?.message === "collection_contract") return "No fue posible interpretar la respuesta de cobranza del servidor. Intenta nuevamente.";
  return "No fue posible consultar cobranza. Intenta nuevamente.";
}

export async function getCollection(referenceDate, { signal } = {}) {
  try {
    const { data } = await api.get("/collection", { params: { reference_date: referenceDate }, signal });
    return readCollectionResponse(data);
  } catch (error) {
    if (signal?.aborted) throw error;
    const safe = new Error(collectionError(error));
    safe.status = error?.response?.status;
    throw safe;
  }
}
