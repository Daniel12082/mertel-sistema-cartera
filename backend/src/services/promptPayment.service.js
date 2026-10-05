import { PROMPT_PAYMENT_POLICY } from "./collectionPolicy.js";

function dateDay(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) value = `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TypeError("Fecha de Pronto Pago inválida");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0); date.setUTCFullYear(year, month - 1, day); date.setUTCHours(0, 0, 0, 0);
  if (year < 1000 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new TypeError("Fecha de Pronto Pago inválida");
  return date.getTime() / 86400000;
}

// Mathematical preview only. No rounding rule or financial application inferred.
export function calculatePromptPaymentDiscount(baseValue) {
  const value = String(baseValue ?? "");
  if (!/^\d{1,13}(?:\.\d{1,2})?$/.test(value)) throw new TypeError("Pronto Pago requiere base antes de IVA válida");
  const [whole, fraction = ""] = value.split(".");
  const hundredthsOfCent = (BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2))) * BigInt(PROMPT_PAYMENT_POLICY.percentage);
  const exactAmount = `${hundredthsOfCent / 10000n}.${String(hundredthsOfCent % 10000n).padStart(4, "0")}`;
  const cents = hundredthsOfCent / 100n;
  return { percentage: PROMPT_PAYMENT_POLICY.percentage, base_calculation: PROMPT_PAYMENT_POLICY.base_calculation, exact_amount: exactAmount,
    amount: hundredthsOfCent % 100n === 0n ? `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}` : null,
    status: hundredthsOfCent % 100n === 0n ? "exact_preview" : "pending_rounding" };
}

export function evaluatePromptPayment({ referenceDate, invoice, policy, products = "unknown" }) {
  if (!["unknown", "eligible", "not_eligible", "mixed"].includes(products)) throw new TypeError("Estado de productos inválido");
  const reference = dateDay(referenceDate);
  const window = policy.window;
  let status = "pending_configuration";
  let reason = "Pendiente definir tipo de día, calendario si corresponde y límites de los diez días desde emisión.";
  if (!invoice.issue_date) { status = "missing_issue_date"; reason = "No se informó fecha de emisión."; }
  else {
    const issue = dateDay(invoice.issue_date);
    const businessCalendar = window.calendar;
    const calendarReady = window.day_type === "calendar" || (window.day_type === "business" && Array.isArray(businessCalendar?.working_weekdays) && businessCalendar.working_weekdays.length && Array.isArray(businessCalendar?.holidays));
    if (calendarReady && typeof window.include_issue_date === "boolean" && typeof window.include_day_ten === "boolean") {
      let elapsed = reference - issue;
      if (window.day_type === "business" && elapsed >= 0) {
        const weekdays = businessCalendar.working_weekdays;
        if (weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw new TypeError("Calendario laboral inválido");
        const holidays = new Set(businessCalendar.holidays.map(dateDay));
        elapsed = 0;
        for (let day = issue + 1; day <= reference && elapsed <= policy.days; day += 1) if (weekdays.includes(new Date(day * 86400000).getUTCDay()) && !holidays.has(day)) elapsed += 1;
      }
      const starts = reference >= issue && (window.include_issue_date || reference > issue);
      const ends = window.include_day_ten ? elapsed <= policy.days : elapsed < policy.days;
      status = starts && ends ? "within_window" : "outside_window";
      reason = status === "within_window" ? "Dentro de la ventana configurada desde emisión." : "Fuera de la ventana configurada desde emisión.";
    }
  }
  const eligibility = products === "unknown" || products === "mixed" ? "manual_review" : products;
  return { percentage: policy.percentage, base_calculation: policy.base_calculation,
    window: { ...window, days: policy.days, reference_basis: "issue_date", status, reason },
    eligibility: { status: eligibility, reason: products === "mixed" ? "Factura mixta: requiere revisión manual." : products === "unknown" ? "Productos y exclusiones no informados: requiere revisión manual." : "Evaluación de productos recibida." },
    discount: { amount: null, status: "not_applied", reason: "La clasificación no aplica descuentos ni modifica el saldo." } };
}
