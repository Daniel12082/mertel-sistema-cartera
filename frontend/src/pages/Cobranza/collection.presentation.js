export const collectionStages = [
  { key: "prompt_payment", label: "Pronto pago", tone: "current" },
  { key: "days_before_due", label: "Faltan X días", tone: "nodue" },
  { key: "due_today", label: "Vence hoy", tone: "nodue" },
  { key: "overdue", label: "En mora", tone: "overdue" },
];

export function stageLabel(stage) {
  return collectionStages.find(item => item.key === stage)?.label ||
    (stage === "no_eligible" ? "No elegible" : stage) || "—";
}

export function localDateValue(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function matchesSearch(item, query) {
  const normalize = value => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const fields = [item.customer.name, item.customer.nit, item.main_invoice?.invoice?.invoice_number,
    ...item.invoices.map(row => row.invoice?.invoice_number)];
  return fields.some(field => normalize(field).includes(normalize(query.trim())));
}
