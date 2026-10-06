import api from "./api";

function unwrap(response) {
  if (response?.data?.success !== true) throw new Error(response?.data?.message || "No fue posible analizar el archivo.");
  return response.data.data;
}
function safeError(error) {
  if (error?.name === "CanceledError" || error?.code === "ERR_CANCELED") throw error;
  const status = error?.response?.status;
  if ([400, 403, 404, 409, 413].includes(status)) throw new Error(error.response.data?.message || "No fue posible analizar el archivo.");
  throw new Error("No fue posible consultar las importaciones. Intenta nuevamente.");
}
export async function analyzePortfolioFile(file, { companyId, signal } = {}) {
  try {
    return unwrap(await api.post("/admin/portfolio/imports/analyze", file, {
      params: { file_name: file.name, ...(companyId ? { company_id: companyId } : {}) }, signal,
      headers: { "Content-Type": "text/csv" }, timeout: 30000,
    }));
  } catch (error) { return safeError(error); }
}
export async function getPortfolioImports({ companyId, signal } = {}) {
  try {
    return unwrap(await api.get("/admin/portfolio/imports", { params: companyId ? { company_id: companyId } : undefined, signal }));
  } catch (error) { return safeError(error); }
}
export async function getPortfolioImportCompanies({ signal } = {}) {
  try {
    const response = await api.get("/admin/companies", { signal });
    const rows = response?.data?.data;
    if (!Array.isArray(rows)) throw new Error("Empresas inválidas");
    return rows.filter(company => company.status === "active");
  } catch (error) { return safeError(error); }
}
