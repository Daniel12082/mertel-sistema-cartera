const VARIABLE_DEFINITIONS = Object.freeze([
  { name: "cliente_nombre", label: "Nombre del cliente", source: "customers.name", example: "Cliente DEMO", legacy: true },
  { name: "nit", label: "NIT", source: "customers.nit", example: "900123456-1", legacy: true },
  { name: "fecha_emision", label: "Emisión", source: "main_invoice.issue_date", example: "2026-09-01", legacy: true },
  { name: "dias_restantes", label: "Días restantes", source: "main_invoice.days_until_due", example: "5", legacy: true },
  { name: "etapa", label: "Etapa", source: "collection_customer.stage_label", example: "En mora", legacy: true },
  { name: "vendedor", label: "Vendedor (requiere dato disponible)", source: "customer.seller", example: "Vendedor DEMO", legacy: true },
  { name: "cobrador", label: "Cobrador (requiere dato disponible)", source: "customer.collector", example: "Cobrador DEMO", legacy: true },
  { name: "empresa", label: "Empresa", source: "company.name", example: "MERTEL IMPORTACIONES S.A.S.", legacy: true },
  { name: "nombre_cliente", label: "Nombre del cliente", source: "customers.name", example: "Juan Pérez" },
  { name: "identificacion_cliente", label: "Identificación del cliente", source: "customers.nit", example: "900123456-1" },
  { name: "telefono_cliente", label: "Teléfono del cliente", source: "customers.phone", example: "3001234567" },
  { name: "numero_factura", label: "Número de factura principal", source: "main_invoice.invoice_number", example: "FV-0231" },
  { name: "fecha_factura", label: "Fecha de factura principal", source: "main_invoice.issue_date", example: "2026-09-01" },
  { name: "fecha_vencimiento", label: "Vencimiento de factura principal", source: "main_invoice.due_date", example: "2026-09-30" },
  { name: "valor_factura", label: "Valor de factura principal", source: "main_invoice.document_value", example: "$2.450.000,00" },
  { name: "saldo_pendiente", label: "Saldo pendiente total del cliente", source: "collection_customer.total_balance", example: "$2.450.000,00" },
  { name: "dias_mora", label: "Días de mora de factura principal", source: "main_invoice.days_until_due", example: "5" },
  { name: "dias_para_vencimiento", label: "Días para vencer la factura principal", source: "main_invoice.days_until_due", example: "0" },
  { name: "etapa_cobranza", label: "Etapa de cobranza", source: "collection_customer.stage_label", example: "En mora" },
  { name: "motivo_cobranza", label: "Motivo de cobranza", source: "collection_customer.reason", example: "Saldo pendiente" },
  // Legacy names remain valid so templates created in Fase 5.1 keep working.
  { name: "cliente", label: "Cliente (compatibilidad anterior)", source: "customers.name", example: "Juan Pérez", legacy: true },
  { name: "factura", label: "Factura (compatibilidad anterior)", source: "main_invoice.invoice_number", example: "FV-0231", legacy: true },
  { name: "saldo", label: "Saldo (compatibilidad anterior)", source: "collection_customer.total_balance", example: "$2.450.000,00", legacy: true },
  { name: "dias_mora", label: "Días de mora (compatibilidad anterior)", source: "main_invoice.days_until_due", example: "5", legacy: true },
].filter((item, index, items) => items.findIndex(candidate => candidate.name === item.name) === index));
const VARIABLE_NAMES = new Set(VARIABLE_DEFINITIONS.map(variable => variable.name));
const available = value => value != null && value !== "" && !(typeof value === "string" && !value.trim());
export function messageTemplateVariableCatalog() {
  return VARIABLE_DEFINITIONS.map(variable => ({ ...variable }));
}
export function templateVariables(content) {
  return [...new Set([...content.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map(match => match[1].trim()))];
}
export function renderMessageTemplate(content, values) {
  const variables = templateVariables(content);
  const unsupported = variables.filter(name => !VARIABLE_NAMES.has(name));
  const missing = variables.filter(name => VARIABLE_NAMES.has(name) && !available(values[name]));
  const malformed = /[{}]/.test(content.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, ""));
  // Literal replacement only: no evaluation, HTML interpretation or recursive expansion.
  const rendered = content.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (token, name) =>
    VARIABLE_NAMES.has(name.trim()) && available(values[name.trim()]) ? String(values[name.trim()]) : token);
  return { content: rendered, variables: variables.filter(name => VARIABLE_NAMES.has(name)).map(name => ({ name, value: available(values[name]) ? values[name] : null })),
    missing_variables: missing, unsupported_variables: unsupported, malformed_variables: malformed };
}
