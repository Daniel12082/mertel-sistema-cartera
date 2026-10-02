import {
  getCustomerPortfolio,
  getPortfolioSummary as fetchPortfolioSummary,
  listPortfolio,
  listPortfolioCustomers,
  listPortfolioInconsistencies,
} from "../services/portfolio.service.js";

const CALCULATED_STATUSES = new Set(["current", "due_today", "overdue", "no_due_date"]);
const SORT_FIELDS = new Set(["due_date", "balance", "customer"]);

function parseDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(0);
  parsed.setUTCFullYear(year, month - 1, day);
  return year >= 1000 && parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function parseId(value) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function parseCriteria(query) {
  const referenceDate = query.reference_date;
  if (!parseDate(referenceDate)) return { error: "reference_date es obligatorio y debe usar YYYY-MM-DD" };
  if (query.customer_id !== undefined && parseId(query.customer_id) === null) {
    return { error: "customer_id debe ser un entero positivo" };
  }
  if (query.status !== undefined && !CALCULATED_STATUSES.has(query.status)) {
    return { error: "status debe ser current, due_today, overdue o no_due_date" };
  }
  if (query.overdue !== undefined && query.overdue !== "true" && query.overdue !== "false") {
    return { error: "overdue debe ser true o false" };
  }
  for (const field of ["due_from", "due_to"]) {
    if (query[field] !== undefined && !parseDate(query[field])) {
      return { error: `${field} debe usar una fecha válida YYYY-MM-DD` };
    }
  }
  if (query.due_from && query.due_to && query.due_from > query.due_to) {
    return { error: "due_from no puede ser posterior a due_to" };
  }
  if (query.sort_by !== undefined && !SORT_FIELDS.has(query.sort_by)) {
    return { error: "sort_by debe ser due_date, balance o customer" };
  }
  if (query.sort_order !== undefined && query.sort_order !== "asc" && query.sort_order !== "desc") {
    return { error: "sort_order debe ser asc o desc" };
  }
  return {
    criteria: {
      referenceDate,
      ...(query.customer_id ? { customerId: parseId(query.customer_id) } : {}),
      status: query.status,
      ...(query.overdue !== undefined ? { overdue: query.overdue === "true" } : {}),
      dueFrom: query.due_from,
      dueTo: query.due_to,
      sortBy: query.sort_by || "due_date",
      sortOrder: query.sort_order || "asc",
    },
  };
}

function badRequest(res, error) {
  return res.status(400).json({ success: false, message: error });
}

function serverError(res, error) {
  console.error("Error consultando cartera:", error);
  return res.status(500).json({ success: false, message: "No se pudo consultar la cartera" });
}

export async function getPortfolio(req, res) {
  const parsed = parseCriteria(req.query);
  if (parsed.error) return badRequest(res, parsed.error);
  try {
    const invoices = await listPortfolio(parsed.criteria);
    return res.status(200).json({ success: true, reference_date: parsed.criteria.referenceDate, data: invoices });
  } catch (error) { return serverError(res, error); }
}

export async function getPortfolioSummary(req, res) {
  const parsed = parseCriteria(req.query);
  if (parsed.error) return badRequest(res, parsed.error);
  try {
    const totals = await fetchPortfolioSummary(parsed.criteria.referenceDate);
    return res.status(200).json({ success: true, reference_date: parsed.criteria.referenceDate, data: totals });
  } catch (error) { return serverError(res, error); }
}

export async function getPortfolioByCustomer(req, res) {
  const parsed = parseCriteria(req.query);
  if (parsed.error) return badRequest(res, parsed.error);
  try {
    const data = await listPortfolioCustomers(parsed.criteria.referenceDate);
    return res.status(200).json({ success: true, reference_date: parsed.criteria.referenceDate, data });
  } catch (error) { return serverError(res, error); }
}

export async function getCustomerPortfolioById(req, res) {
  const customerId = parseId(req.params.customerId);
  if (customerId === null) return badRequest(res, "ID de cliente inválido");
  const parsed = parseCriteria(req.query);
  if (parsed.error) return badRequest(res, parsed.error);
  try {
    const data = await getCustomerPortfolio(customerId, parsed.criteria);
    if (!data) return res.status(404).json({ success: false, message: "Cliente no encontrado" });
    return res.status(200).json({ success: true, reference_date: parsed.criteria.referenceDate, data });
  } catch (error) { return serverError(res, error); }
}

export async function getPortfolioReconciliation(req, res) {
  try {
    const data = await listPortfolioInconsistencies();
    return res.status(200).json({ success: true, data });
  } catch (error) { return serverError(res, error); }
}
