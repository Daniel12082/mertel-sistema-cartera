import { PROMPT_PAYMENT_POLICY } from "./collectionPolicy.js";
import { moneyCents, percentagePreviewInPesos } from "./collectionMoney.js";

export function dateDay(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) value = `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TypeError("Fecha de beneficio inválida");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0); date.setUTCFullYear(year, month - 1, day); date.setUTCHours(0, 0, 0, 0);
  if (year < 1000 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new TypeError("Fecha de beneficio inválida");
  return date.getTime() / 86400000;
}

export function dateFromDay(day) { return new Date(day * 86400000).toISOString().slice(0, 10); }

// The commercial amount is whole COP pesos, half-up; preview only, never an application.
export function calculatePromptPaymentDiscount(baseValue) {
  return { percentage: PROMPT_PAYMENT_POLICY.percentage, base_calculation: PROMPT_PAYMENT_POLICY.base_calculation,
    ...percentagePreviewInPesos(baseValue, PROMPT_PAYMENT_POLICY.percentage), status: "rounded_preview" };
}

const normalize = value => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[-–]/g, " ").replace(/\s+/g, " ").trim();

function excludedProduct(item) {
  const name = normalize(item.description);
  if (name === "promo 18") return "PROMO 18";
  if (item.vehicle_type === "car") {
    if (["alternador", "alternadores"].includes(name)) return "Alternadores para carros";
    if (["arranque", "arranques"].includes(name)) return "Arranques para carros";
    if (["motoventilador", "motoventiladores"].includes(name)) return "Motoventiladores para carros";
  }
  if (item.vehicle_type === "motorcycle") {
    if (name === "set pinon") return "Set piñón para motos";
    if (name === "kit pinon cadenas") return "Kit piñón-cadenas para motos";
  }
  return null;
}

// Evidence is an internal adapter input, not a product table, public override or SKU catalog.
// A nonmatching description without a complete trusted positive assessment never grants eligibility.
export function evaluatePromptPaymentProducts(invoice, products = "unknown") {
  const result = (status, reason, exclusions = []) => ({ status, reason, exclusions });
  if (invoice.promo_18 != null && moneyCents(invoice.promo_18) > 0n) return result("not_eligible", "La factura está identificada como PROMO 18.", ["PROMO 18"]);
  if (products === "mixed") return result("manual_review", "Factura mixta: requiere revisión manual; no hay fórmula parcial confirmada.");
  if (products === "eligible" || products === "not_eligible") return result(products, "Evaluación de productos recibida explícitamente del adaptador interno.");
  if (products === "unknown" || products == null) return result("manual_review", "Productos y exclusiones no informados: pendiente de datos de productos; requiere revisión manual.");
  if (typeof products !== "object" || !Array.isArray(products.items)) throw new TypeError("Evidencia de productos inválida");
  if (!products.items.length || products.complete !== true) return result("manual_review", "Información de productos incompleta: requiere revisión manual.");
  if (products.items.some(item => !item || typeof item.description !== "string")) throw new TypeError("Descripción de producto inválida");
  const exclusions = products.items.map(excludedProduct).filter(Boolean);
  if (exclusions.length === products.items.length) return result("not_eligible", "Productos excluidos de Pronto Pago confirmados por MERTEL.", exclusions);
  if (exclusions.length) return result("manual_review", "Factura con productos mixtos: requiere revisión manual; no se calcula descuento parcial.", exclusions);
  if (products.items.every(item => item.assessment === "eligible")) return result("eligible", "Todos los productos tienen evaluación positiva explícita en la evidencia completa.");
  return result("manual_review", "Producto desconocido o sin evaluación positiva: requiere revisión manual.");
}

export function evaluatePromptPayment({ referenceDate, invoice, policy, products = "unknown" }) {
  const reference = dateDay(referenceDate); const window = policy.window;
  let status = "pending_configuration"; let elapsed = null; let startDate = null; let endDate = null;
  let reason = "Pendiente configurar calendario y límites de los diez días desde fecha de factura.";
  if (!invoice.issue_date) { status = "missing_issue_date"; reason = "No se informó fecha de factura."; }
  else {
    const issue = dateDay(invoice.issue_date); const calendar = window.calendar;
    const ready = window.day_type === "calendar" || (window.day_type === "business" && Array.isArray(calendar?.working_weekdays) && calendar.working_weekdays.length && Array.isArray(calendar?.holidays));
    if (ready && typeof window.include_issue_date === "boolean" && typeof window.include_day_ten === "boolean") {
      elapsed = reference - issue;
      if (window.day_type === "calendar") { startDate = dateFromDay(issue); endDate = dateFromDay(issue + policy.days); }
      if (window.day_type === "business" && elapsed >= 0) {
        if (calendar.working_weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw new TypeError("Calendario laboral inválido");
        const holidays = new Set(calendar.holidays.map(dateDay)); elapsed = 0;
        for (let day = issue + 1; day <= reference && elapsed <= policy.days; day++) if (calendar.working_weekdays.includes(new Date(day * 86400000).getUTCDay()) && !holidays.has(day)) elapsed++;
      }
      const starts = reference >= issue && (window.include_issue_date || reference > issue);
      const ends = window.include_day_ten ? elapsed <= policy.days : elapsed < policy.days;
      status = starts && ends ? "within_window" : "outside_window";
      reason = status === "within_window" ? "Dentro de la ventana de diez días desde fecha de factura." : "Fuera de la ventana de diez días desde fecha de factura.";
    }
  }
  const productEligibility = evaluatePromptPaymentProducts(invoice, products);
  let eligibility = status === "pending_configuration" ? "pending_configuration" : status === "missing_issue_date" ? "unknown" : status === "outside_window" ? "not_eligible" : productEligibility.status;
  let eligibilityReason = status === "within_window" ? productEligibility.reason : reason;
  if (productEligibility.status === "not_eligible") { eligibility = "not_eligible"; eligibilityReason = productEligibility.reason; }
  if (invoice.deleted_at != null || invoice.active === false || (invoice.balance != null && moneyCents(invoice.balance) === 0n)) {
    eligibility = "not_eligible"; eligibilityReason = "Factura sin saldo pendiente o inactiva.";
  }
  let preview = null;
  if (eligibility === "eligible" && invoice.base_value != null) preview = calculatePromptPaymentDiscount(invoice.base_value);
  return {
    reference_date: dateFromDay(reference), percentage: policy.percentage, base_calculation: policy.base_calculation, base_value: invoice.base_value ?? null,
    window: { ...window, days: policy.days, reference_basis: "issue_date", status, reason, elapsed_days: elapsed, start_date: startDate, end_date: endDate },
    eligibility: { status: eligibility, reason: eligibilityReason }, product_eligibility: productEligibility,
    discount: { amount: null, preview_amount: preview?.amount ?? null, preview, status: "not_applied", reason: "La clasificación no aplica descuentos ni modifica el saldo." },
  };
}
