// Política inicial de FASE 4.6B. Los permisos previstos no autorizan rutas hasta implementarlas.
const entries = [
  ["companies", "Empresas", [["view", "Consultar empresas como administrador global", true]]],
  ["customers", "Clientes", [["view", "Ver clientes", true], ["create", "Crear clientes", true], ["update", "Editar clientes", true], ["delete", "Eliminar clientes", true]]],
  ["invoices", "Facturas", [["view", "Ver facturas", true], ["create", "Crear facturas", true], ["update", "Editar facturas", true], ["delete", "Eliminar facturas", true]]],
  ["payments", "Pagos", [["view", "Ver pagos", true], ["create", "Crear pagos", true], ["update", "Editar pagos", true], ["delete", "Eliminar pagos", true]]],
  ["payment_allocations", "Asignaciones", [["view", "Ver asignaciones", true], ["create", "Crear asignaciones", true], ["reverse", "Reversar asignaciones", true]]],
  ["portfolio", "Cartera", [["view", "Ver cartera, resumen y conciliación", true], ["export", "Exportar cartera", false]]],
  ["collection", "Cobranza", [["view", "Ver cobranza", true], ["manage", "Registrar gestiones y promesas manuales de cobranza", true]]],
  ["reports", "Reportes", [["view", "Ver reportes", false], ["export", "Exportar reportes", false]]],
  ["history", "Historial", [["view", "Ver historial; collector limitado a su propia actividad", false]]],
  ["messages", "Mensajes", [["view", "Ver mensajes", false], ["manage", "Gestionar mensajes", false]]],
  ["settings", "Configuración", [["manage", "Administrar configuración", false]]],
  ["users", "Usuarios", [["view", "Ver usuarios", false], ["create", "Crear usuarios internos", false], ["update", "Editar usuarios", false], ["deactivate", "Desactivar usuarios", false]]],
  ["roles", "Roles", [["view", "Consultar matriz administrativa de roles y permisos", true]]],
];
export const PERMISSIONS = Object.freeze(entries.flatMap(([module, moduleLabel, operations]) =>
  operations.map(([action, description, implemented]) => Object.freeze({ name: `${module}.${action}`, module, moduleLabel, description, implemented }))));
const supervisor = ["customers.view", "customers.update", "invoices.view", "invoices.update",
  "payments.view", "payments.create", "payments.update", "payment_allocations.view", "payment_allocations.create", "payment_allocations.reverse",
  "portfolio.view", "portfolio.export", "collection.view", "collection.manage", "reports.view", "reports.export", "history.view", "messages.view", "messages.manage"];
const collector = ["customers.view", "invoices.view", "payments.view", "payments.create", "payment_allocations.view", "payment_allocations.create",
  "portfolio.view", "collection.view", "collection.manage", "reports.view", "history.view", "messages.manage"];
export const ROLE_PERMISSIONS = Object.freeze({
  admin: Object.freeze(PERMISSIONS.map(permission => permission.name)),
  supervisor: Object.freeze(supervisor), collector: Object.freeze(collector),
});
export const ROLE_LABELS = Object.freeze({ admin: "Admin", supervisor: "Supervisor", collector: "Collector" });
export function permissionsForRoles(roles = []) {
  const allowed = new Set(roles.flatMap(role => Object.hasOwn(ROLE_PERMISSIONS, role.name) ? ROLE_PERMISSIONS[role.name] : []));
  return PERMISSIONS.filter(permission => permission.implemented && allowed.has(permission.name)).map(permission => permission.name);
}
export function roleCatalog() {
  return Object.entries(ROLE_LABELS).map(([name, label]) => ({ name, label,
    permissions: PERMISSIONS.map(permission => ({ ...permission, enabled: ROLE_PERMISSIONS[name].includes(permission.name),
      scope: permission.name === "companies.view" ? "global_admin" : name === "collector" && permission.name === "history.view" ? "own_user" : "all" })),
  }));
}
