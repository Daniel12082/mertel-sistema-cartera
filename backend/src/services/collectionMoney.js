// DECIMAL(15,2) input; never silently round a monetary source value.
export function moneyCents(value) {
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
  if (typeof text !== "string" || !/^\d{1,13}(?:\.\d{1,2})?$/.test(text)) throw new TypeError("Importe monetario inválido");
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
}

export function percentagePreviewInPesos(baseValue, percentage) {
  const numerator = moneyCents(baseValue) * BigInt(percentage);
  return {
    exact_amount: `${numerator / 10000n}.${String(numerator % 10000n).padStart(4, "0")}`,
    amount: String((numerator + 5000n) / 10000n),
    currency: "COP", rounding: "half_up", decimal_places: 0,
  };
}
