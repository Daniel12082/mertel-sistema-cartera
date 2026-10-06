import api from "./api";

function unwrap(response) {
  if (response?.data?.success !== true) throw new Error(response?.data?.message || "No fue posible analizar el archivo.");
  return response.data.data;
}
function safeError(error) {
  if (error?.name === "CanceledError" || error?.code === "ERR_CANCELED") throw error;
  const status = error?.response?.status;
  if ([400, 403, 404, 409, 413, 503].includes(status)) throw new Error(error.response.data?.message || "No fue posible analizar el archivo.");
  throw new Error("No fue posible consultar las importaciones. Intenta nuevamente.");
}
export async function analyzePortfolioFile(file, { signal } = {}) {
  const mimeType = file.name.toLowerCase().endsWith(".xlsx")
    ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    : "text/csv";
  try {
    return unwrap(await api.post("/admin/portfolio/imports/analyze", file, {
      params: { file_name: file.name }, signal,
      headers: { "Content-Type": mimeType }, timeout: 60000,
    }));
  } catch (error) { return safeError(error); }
}
export async function getPortfolioImports({ signal } = {}) {
  try {
    return unwrap(await api.get("/admin/portfolio/imports", { signal }));
  } catch (error) { return safeError(error); }
}
