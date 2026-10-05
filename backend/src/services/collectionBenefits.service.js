import { dateDay, dateFromDay } from "./promptPayment.service.js";

export function evaluateConditionalDiscount({ referenceDate, invoice, policy }) {
  const reference = dateDay(referenceDate);
  let status = "pending_configuration"; let reason = "El beneficio condicionado no está configurado.";
  let startDate = null; let endDate = null;
  if (policy?.active) {
    if (!invoice.issue_date) { status = "unknown"; reason = "Falta fecha de factura para evaluar el beneficio."; }
    else {
      const issue = dateDay(invoice.issue_date); const elapsed = reference - issue;
      startDate = dateFromDay(issue + policy.min_days); endDate = dateFromDay(issue + policy.max_days);
      status = elapsed >= policy.min_days && elapsed <= policy.max_days ? "eligible" : "not_eligible";
      reason = status === "eligible" ? "Dentro de la ventana de 60 a 70 días calendario desde fecha de factura, inclusive." : "Fuera de la ventana de 60 a 70 días calendario desde fecha de factura.";
    }
  }
  if (invoice.deleted_at != null || invoice.active === false || (invoice.balance != null && Number(invoice.balance) <= 0)) {
    status = "not_eligible"; reason = "Factura sin saldo pendiente o inactiva.";
  }
  return {
    reference_date: dateFromDay(reference), percentage: policy?.percentage ?? "10", eligibility: { status, reason },
    window: { reference_basis: "issue_date", day_type: "calendar", min_days: 60, max_days: 70, include_day_seventy: true, start_date: startDate, end_date: endDate },
    discount: { amount: null, status: "not_applied", reason: "Base y aplicación financiera del 10% pendientes de especificación; no modifica el saldo." },
  };
}

// Preserve independently approved benefits; never infer a shared date, 13% or a combined amount.
export function representCollectionBenefits(promptPayment, conditionalDiscount) {
  return { prompt_payment_discount: promptPayment, conditional_discount: conditionalDiscount,
    combination: { status: "pending_financial_specification", combined_percentage: null, combined_amount: null,
      reason: "Beneficios independientes. Falta precisar cómo coexistirían las ventanas 0–10 y 60–70 días en una operación de pago." } };
}
