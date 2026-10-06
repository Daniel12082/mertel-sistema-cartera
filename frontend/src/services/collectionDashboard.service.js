import api from "./api";

export async function getCollectionDashboard(params, { signal } = {}) {
  try {
    const response = await api.get("/admin/collection/dashboard", { params, signal });
    if (response.data?.success !== true || !response.data?.data) throw new Error("Respuesta inválida del dashboard.");
    return response.data.data;
  } catch (error) {
    if (error?.name === "CanceledError" || error?.code === "ERR_CANCELED") throw error;
    if (error?.response?.status === 400) throw new Error(error.response.data?.message || "Revisa las fechas seleccionadas.", { cause: error });
    if (error?.response?.status === 403) throw new Error("No tienes permiso para consultar el dashboard administrativo.", { cause: error });
    throw new Error("No fue posible cargar el dashboard de cobranza.", { cause: error });
  }
}

export async function getDashboardCompanies({ signal } = {}) {
  const response = await api.get("/admin/companies", { signal });
  const companies = response.data?.data;
  if (!Array.isArray(companies)) throw new Error("No fue posible consultar las empresas disponibles.");
  return companies.filter(company => company.status === "active");
}
