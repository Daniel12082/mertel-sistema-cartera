const VARIABLES = ["cliente", "factura", "saldo", "fecha_vencimiento", "dias_mora"];
const available = value => value != null && value !== "" && !(typeof value === "string" && !value.trim());
export function templateVariables(content) {
  return [...new Set([...content.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map(match => match[1].trim()))];
}
export function renderMessageTemplate(content, values) {
  const variables = templateVariables(content);
  const unsupported = variables.filter(name => !VARIABLES.includes(name));
  const missing = variables.filter(name => VARIABLES.includes(name) && !available(values[name]));
  const malformed = /[{}]/.test(content.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, ""));
  // Literal replacement only: no evaluation, HTML interpretation or recursive expansion.
  const rendered = content.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (token, name) =>
    VARIABLES.includes(name.trim()) && available(values[name.trim()]) ? String(values[name.trim()]) : token);
  return { content: rendered, variables: variables.filter(name => VARIABLES.includes(name)).map(name => ({ name, value: available(values[name]) ? values[name] : null })),
    missing_variables: missing, unsupported_variables: unsupported, malformed_variables: malformed };
}
