import pool from "../config/database.js";
import { readCompanyCollection } from "./collection.service.js";
import { getDashboardActionCount, getDashboardPromiseSummary } from "../models/collectionOperations.model.js";
import { validCompanyId } from "../utils/companyScope.js";

function nextDay(value) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day + 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function colombiaUtcBoundary(date) {
  // collection_actions.action_date is stored by the server in UTC. Colombia is UTC-5.
  return `${date} 05:00:00`;
}

function moneySum(left, right) {
  const cents = value => {
    const [whole, fraction = ""] = String(value).split(".");
    return BigInt(whole || 0) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
  };
  const total = cents(left) + cents(right);
  return `${total / 100n}.${String(total % 100n).padStart(2, "0")}`;
}

export function buildCollectionDashboard({ collection, promises, actionsPeriod, activityFrom, activityTo }) {
  const stageMap = new Map((collection.stage_catalog || []).map(stage => [stage.key, {
    key: stage.key, label: stage.label, customers: 0, balance: "0.00",
  }]));
  for (const customer of collection.customers) {
    if (!stageMap.has(customer.stage)) stageMap.set(customer.stage, { key: customer.stage, label: customer.stage_label, customers: 0, balance: "0.00" });
    const stage = stageMap.get(customer.stage);
    stage.customers += 1;
    stage.balance = moneySum(stage.balance, customer.total_balance);
  }
  return {
    reference_date: collection.reference_date,
    portfolio: {
      total_balance: collection.summary.total_balance,
      customers_in_collection: collection.summary.total_customers,
    },
    stages: [...stageMap.values()],
    promises,
    activity: { activity_from: activityFrom, activity_to: activityTo, actions_period: actionsPeriod },
    warnings: collection.configuration_warnings,
    collection_status: collection.status,
    message: collection.message,
  };
}

export async function getCollectionDashboard({ referenceDate, activityFrom, activityTo, scope }) {
  if (!validCompanyId(scope?.companyId)) throw Object.assign(new Error("El contexto MERTEL no está disponible"), { status: 403 });
  const connection = await pool.getConnection();
  try {
    await connection.query("START TRANSACTION READ ONLY");
    const collection = await readCompanyCollection({ referenceDate, scope }, connection);
    const promises = await getDashboardPromiseSummary(scope, connection);
    const actionsPeriod = await getDashboardActionCount(scope, colombiaUtcBoundary(activityFrom), colombiaUtcBoundary(nextDay(activityTo)), connection);
    await connection.commit();
    return buildCollectionDashboard({ collection, promises, actionsPeriod, activityFrom, activityTo });
  } catch (error) {
    try { await connection.rollback(); } catch { /* preserve original error */ }
    throw error;
  } finally { connection.release(); }
}
