import { formatCurrency, formatDate } from "../../utils/format";

const labels = { eligible: "Elegible", not_eligible: "No elegible", manual_review: "Revisión manual", unknown: "Desconocido", pending_configuration: "Configuración pendiente", pending_product_data: "Datos de productos pendientes" };

export default function CollectionBenefits({ row }) {
  const prompt = row.prompt_payment;
  const conditional = row.conditional_discount;
  if (!prompt && !conditional) return "—";
  return <div className="cobranza-benefits">
    {prompt && <details><summary>Ver evaluación</summary>
      <strong>Pronto Pago · {prompt.percentage}%</strong>
      <p>Estado: {labels[prompt.eligibility?.status] || prompt.eligibility?.status || "Desconocido"}</p>
      <p>{prompt.window?.reason}</p>
      {prompt.window?.end_date && <p>Último día: {formatDate(prompt.window.end_date)} (incluido).</p>}
      <p>{prompt.eligibility?.reason}</p>
      <p>{prompt.percentage}% sobre base antes de IVA.</p>
      <p>Base: {prompt.base_value == null ? "No informada" : formatCurrency(prompt.base_value)}</p>
      {prompt.product_eligibility?.exclusions?.length > 0 && <p>Exclusiones: {prompt.product_eligibility.exclusions.join(", ")}</p>}
      {prompt.discount?.preview_amount != null && <p>Descuento estimado en pesos enteros: {formatCurrency(prompt.discount.preview_amount)}. Elegible; pendiente de aplicación.</p>}
      <p>{prompt.discount?.reason}</p>
    </details>}
    {conditional && <details><summary>Ver beneficio condicionado</summary>
      <strong>Beneficio condicionado · {conditional.percentage}%</strong>
      <p>Estado: {labels[conditional.eligibility?.status] || "Desconocido"}</p>
      <p>Ventana: {conditional.window?.min_days}–{conditional.window?.max_days} días calendario desde fecha de factura.</p>
      {conditional.window?.start_date && <p>{formatDate(conditional.window.start_date)} – {formatDate(conditional.window.end_date)} (incluido).</p>}
      <p>{conditional.eligibility?.reason}</p><p>{conditional.discount?.reason}</p>
    </details>}
    {row.benefits?.combination?.reason && <p className="cobranza-note">{row.benefits.combination.reason}</p>}
  </div>;
}
