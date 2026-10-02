const copFormatter = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatCurrency(value) {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return "—";
  return copFormatter.format(Number(value));
}

export function formatDate(value) {
  if (!value) return "—";
  const text = String(value).slice(0, 10);
  const parsed = new Date(`${text}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? text : new Intl.DateTimeFormat("es-CO").format(parsed);
}
