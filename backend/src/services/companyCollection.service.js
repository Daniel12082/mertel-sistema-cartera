import { getCompanySettings } from "../models/companyConfiguration.model.js";
import { sameCompany, validCompanyId } from "../utils/companyScope.js";
import { evaluateCollectionCase } from "./collectionEngine.service.js";

export async function loadCompanyCollectionRules(companyId, db) {
  const settings = await getCompanySettings(companyId, db);
  const stored = settings.filter(setting => setting.setting_key === "collection_rules");
  if (!stored.length) return []; // No configured rule means no rule, never historical platform defaults.
  if (stored.length !== 1 || stored[0].value_type !== "json") throw new TypeError("Configuración de cobranza incompatible");
  let rules;
  try { rules = JSON.parse(stored[0].setting_value); } catch { throw new TypeError("Reglas de cobranza inválidas"); }
  if (!Array.isArray(rules)) throw new TypeError("Reglas de cobranza deben ser un arreglo");
  return rules;
}
// Company adapter around the unchanged pure engine. No HTTP route, scheduling or message sending.
export function evaluateCompanyCollection({ company, referenceDate, customers, invoices, rules }) {
  if (!validCompanyId(company?.id) || !Array.isArray(customers) || !Array.isArray(invoices)) throw new TypeError("Contexto empresarial de cobranza inválido");
  if ([...customers, ...invoices].some(record => !sameCompany(record?.company_id, company.id))) {
    throw new TypeError("Los datos de cobranza deben pertenecer a la misma empresa");
  }
  return customers.map(customer => evaluateCollectionCase({ referenceDate, customer,
    invoices: invoices.filter(invoice => String(invoice.customer_id) === String(customer.id ?? customer.customer_id)), rules }));
}
