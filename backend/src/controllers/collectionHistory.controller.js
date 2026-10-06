import { getAdministrativeCollectionHistory, getAdministrativeHistoryActors, getCustomerCollectionHistory } from "../services/collectionHistory.service.js";

function validDate(value) {
  if (value === undefined) return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number); const date = new Date(0); date.setUTCFullYear(year, month - 1, day);
  return year >= 1000 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export async function customerCollectionHistory(req, res) {
  try {
    res.set("Cache-Control", "no-store");
    const data = await getCustomerCollectionHistory({ customerId: req.params.customerId, scope: req.companyScope,
      page: req.query.page, limit: req.query.limit, type: req.query.type,
      ownUserOnly: req.user.roles?.some(role => role.name === "collector") && !req.user.roles?.some(role => role.name === "admin") });
    return res.json({ success: true, data });
  } catch (error) {
    const status = [400, 403, 404].includes(error.status) ? error.status : 500;
    return res.status(status).json({ success: false, message: status === 500 ? "No fue posible consultar el historial del cliente." : error.message });
  }
}

export async function administrativeCollectionHistory(req, res) {
  if (!validDate(req.query.date_from) || !validDate(req.query.date_to)) return res.status(400).json({ success: false, message: "date_from y date_to deben ser fechas válidas YYYY-MM-DD." });
  try {
    res.set("Cache-Control", "no-store");
    const data = await getAdministrativeCollectionHistory({ scope: req.companyScope, page: req.query.page, limit: req.query.limit,
      type: req.query.type, dateFrom: req.query.date_from, dateTo: req.query.date_to,
      actorId: req.query.actor_id, query: req.query.q });
    return res.json({ success: true, data });
  } catch (error) {
    const status = [400, 403, 404].includes(error.status) ? error.status : 500;
    return res.status(status).json({ success: false, message: status === 500 ? "No fue posible consultar el historial administrativo." : error.message });
  }
}

export async function administrativeHistoryActors(req, res) {
  try {
    res.set("Cache-Control", "no-store");
    return res.json({ success: true, data: await getAdministrativeHistoryActors({ scope: req.companyScope }) });
  } catch (error) {
    const status = [400, 403, 404].includes(error.status) ? error.status : 500;
    return res.status(status).json({ success: false, message: status === 500 ? "No fue posible consultar los usuarios del historial." : error.message });
  }
}
