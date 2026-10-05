export function getStageCatalog(data) {
  if (Array.isArray(data?.stage_catalog)) return data.stage_catalog;
  // Compatible with 4.7 responses: preserve server keys/order without guessing rules.
  return Object.keys(data?.summary?.stages || {}).map(key => ({ key, label: key }));
}

export function stageLabel(stage, catalog = [], suppliedLabel) {
  return suppliedLabel || catalog.find(item => item.key === stage)?.label ||
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
