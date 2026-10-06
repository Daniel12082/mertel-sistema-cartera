import { getCompanyCollection } from "../services/collection.service.js";

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return year >= 1000 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function parseId(value) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function parseQuery(query) {
  if (!validDate(query.reference_date)) return { error: "reference_date es obligatorio y debe ser una fecha válida YYYY-MM-DD" };
  if (query.customer_id !== undefined && parseId(query.customer_id) === null) return { error: "customer_id debe ser un entero positivo" };
  if (query.stage !== undefined && (typeof query.stage !== "string" || !query.stage.trim() || query.stage.length > 100)) {
    return { error: "stage debe ser texto de máximo 100 caracteres" };
  }
  return { criteria: {
    referenceDate: query.reference_date,
    filters: {
      ...(query.customer_id !== undefined ? { customerId: parseId(query.customer_id) } : {}),
      ...(query.stage !== undefined ? { stage: query.stage } : {}),
    },
  } };
}

export async function getCollection(req, res) {
  const parsed = parseQuery(req.query);
  if (parsed.error) return res.status(400).json({ success: false, message: parsed.error });
  try {
    const data = await getCompanyCollection({ ...parsed.criteria, scope: req.companyScope });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ success: false, message: error.message });
    console.error("Error consultando cobranza");
    return res.status(500).json({ success: false, message: "No se pudo consultar la cobranza" });
  }
}
