// Política inicial de FASE 4.6B. Los permisos previstos no autorizan rutas hasta implementarlas.
const entries = [
  ["dashboard", "Dashboard", [["view", "Ver el resumen principal", true]]],
  ["admin_dashboard", "Centro Administrativo", [["view", "Ver los indicadores administrativos", true]]],
  ["collection_dashboard", "Dashboard de cobranza", [["view", "Ver los indicadores de cobranza", true]]],
  ["companies", "Empresas", [["view", "Consultar empresas como administrador global", true]]],
  ["customers", "Clientes", [["view", "Ver clientes", true], ["create", "Crear clientes", true], ["update", "Editar clientes", true], ["delete", "Eliminar clientes", true]]],
  ["invoices", "Facturas", [["view", "Ver facturas", true], ["create", "Crear facturas", true], ["update", "Editar facturas", true], ["delete", "Eliminar facturas", true]]],
  ["payments", "Pagos", [["view", "Ver pagos", true], ["create", "Crear pagos", true], ["update", "Editar pagos", true], ["delete", "Eliminar pagos", true]]],
  ["payment_allocations", "Asignaciones", [["view", "Ver asignaciones", true], ["create", "Crear asignaciones", true], ["reverse", "Reversar asignaciones", true]]],
  ["portfolio", "Cartera", [["view", "Ver cartera, resumen y conciliación", true], ["export", "Exportar cartera", false], ["import", "Analizar archivos de cartera sin aplicarlos", true]]],
  ["collection", "Cobranza", [["view", "Ver cobranza", true], ["manage", "Registrar gestiones y promesas manuales de cobranza", true]]],
  ["reports", "Reportes", [["view", "Ver reportes", true], ["export", "Exportar reportes", false]]],
  ["history", "Historial", [["view", "Consultar historial operativo y administrativo autorizado", true]]],
  ["messages", "Mensajes", [["view", "Ver mensajes", false], ["manage", "Gestionar mensajes", false]]],
  ["message_templates", "Plantillas WhatsApp", [["view", "Consultar plantillas", true], ["manage", "Crear, editar y activar plantillas", true]]],
  ["whatsapp", "WhatsApp", [["view", "Consultar chats e historial de mensajes", true], ["send", "Enviar mensajes y vincular conversaciones", true], ["manage", "Configurar conexión y automatizaciones", true]]],
  ["reported_payments", "Pagos reportados", [["view", "Consultar pagos reportados", true], ["review", "Confirmar o rechazar pagos reportados", true]]],
  ["audit", "Auditoría", [["view", "Consultar la auditoría administrativa", true]]],
  ["settings", "Configuración", [["view", "Abrir el centro de configuración", true], ["manage", "Administrar reglas, sistema y personalización", true]]],
  ["users", "Usuarios", [["view", "Consultar usuarios", true], ["create", "Crear usuarios internos", true], ["update", "Editar usuarios y asignar roles", true], ["deactivate", "Activar o desactivar usuarios", true], ["reset_password", "Cambiar contraseñas de usuarios", true]]],
  ["roles", "Roles y permisos", [["view", "Consultar roles y permisos", true], ["manage", "Crear y editar roles personalizados", true]]],
];
export const PERMISSIONS = Object.freeze(entries.flatMap(([module, moduleLabel, operations]) =>
  operations.map(([action, description, implemented]) => Object.freeze({ name: `${module}.${action}`, module, moduleLabel, description, implemented }))));
const supervisor = ["dashboard.view", "customers.view", "customers.update", "invoices.view", "invoices.update",
  "payments.view", "payments.create", "payments.update", "payment_allocations.view", "payment_allocations.create", "payment_allocations.reverse",
  "portfolio.view", "portfolio.export", "collection.view", "collection.manage", "reports.view", "reports.export", "history.view", "messages.view", "messages.manage"];
const collector = ["dashboard.view", "customers.view", "invoices.view", "payments.view", "payments.create", "payment_allocations.view", "payment_allocations.create",
  "portfolio.view", "collection.view", "collection.manage", "reports.view", "history.view", "messages.manage"];
export const ROLE_PERMISSIONS = Object.freeze({
  admin: Object.freeze(PERMISSIONS.map(permission => permission.name)),
  supervisor: Object.freeze(supervisor), collector: Object.freeze(collector),
});
export const ROLE_LABELS = Object.freeze({ admin: "Admin", supervisor: "Supervisor", collector: "Collector" });
export function permissionsForRoles(roles = []) {
  const allowed = new Set(roles.flatMap(role => Object.hasOwn(ROLE_PERMISSIONS, role.name) ? ROLE_PERMISSIONS[role.name] :
    role.custom === true && /^custom_[a-f0-9]{24}$/.test(role.name) && Array.isArray(role.permissions) ? role.permissions : []));
  return PERMISSIONS.filter(permission => permission.implemented && allowed.has(permission.name)).map(permission => permission.name);
}
export function permissionDependencies(name) {
  const module = name.split('.')[0];
  const dependencies = [];
  if (!name.endsWith('.view') && PERMISSIONS.some(p => p.name === `${module}.view` && p.implemented)) dependencies.push(`${module}.view`);
  if (name.startsWith('payment_allocations.')) dependencies.push('payments.view');
  if (name === 'reported_payments.review') dependencies.push('payments.create','payment_allocations.create','collection.view','collection.manage');
  if (name === 'message_templates.view' || name === 'message_templates.manage' || name === 'portfolio.import') dependencies.push('collection.view');
  return [...new Set(dependencies)];
}
export function expandPermissions(names) {
  const expanded = new Set(names);
  for (const name of expanded) for (const dependency of permissionDependencies(name)) expanded.add(dependency);
  return [...expanded].sort();
}
export function roleCatalog() {
  return Object.entries(ROLE_LABELS).map(([name, label]) => ({ name, label,
    permissions: PERMISSIONS.map(permission => ({ ...permission, enabled: ROLE_PERMISSIONS[name].includes(permission.name),
      scope: permission.name === "companies.view" ? "global_admin" : name === "collector" && permission.name === "history.view" ? "own_user" : "all" })),
  }));
}
