import { getCollectionDashboard } from "../services/collectionDashboard.service.js";

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0); date.setUTCFullYear(year, month - 1, day);
  return year >= 1000 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export async function getCollectionDashboardController(req, res, next) {
  const { reference_date: referenceDate, activity_from: activityFrom, activity_to: activityTo } = req.query;
  if (!validDate(referenceDate)) return res.status(400).json({ success: false, message: "reference_date es obligatoria y debe ser una fecha válida YYYY-MM-DD" });
  if (!validDate(activityFrom) || !validDate(activityTo)) return res.status(400).json({ success: false, message: "activity_from y activity_to deben ser fechas válidas YYYY-MM-DD" });
  if (activityFrom > activityTo) return res.status(400).json({ success: false, message: "activity_from no puede ser posterior a activity_to" });
  const from = new Date(`${activityFrom}T00:00:00Z`); const to = new Date(`${activityTo}T00:00:00Z`);
  if ((to - from) / 86400000 > 29) return res.status(400).json({ success: false, message: "El período de actividad no puede superar 30 días" });
  if (req.companyScope?.globalAdmin && req.companyScope.companyId === null) return res.status(400).json({ success: false, message: "El administrador global debe indicar company_id para consultar una empresa." });
  try {
    res.set("Cache-Control", "no-store");
    return res.status(200).json({ success: true, data: await getCollectionDashboard({ referenceDate, activityFrom, activityTo, scope: req.companyScope }) });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ success: false, message: error.message });
    return next(error);
  }
}
