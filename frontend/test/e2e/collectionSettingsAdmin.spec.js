import { expect, test } from "@playwright/test";

const original = [
  { key: "overdue", label: "En mora", description: "Factura vencida", type: "boolean", value: true, editable: true },
  { key: "due_today", label: "Vence hoy", description: "Vence en la fecha actual", type: "boolean", value: true, editable: true },
  { key: "five_days_before_due", label: "Faltan 5 días", description: "Cinco días calendario", type: "boolean", value: true, editable: true },
  { key: "prompt_payment", label: "Pronto pago", description: "Clasificación de pronto pago", type: "boolean", value: true, editable: true },
];
const fixed = { key: "prompt_payment.percentage", label: "Descuento por pronto pago", description: "3% sobre valor antes de IVA", type: "number", value: 3, unit: "%", editable: false };
async function setup(page, { canManage = true, globalAdmin = false } = {}) {
  const user = { id: "1", name: "Admin fixture", company_id: globalAdmin ? null : "1", is_global_admin: globalAdmin,
    roles: [canManage ? "admin" : "collector"], permissions: canManage ? ["settings.manage"] : ["collection.view"] };
  const calls = []; let stages = structuredClone(original);
  await page.route("**/api/**", async route => {
    const request = route.request(); const url = new URL(request.url()); const method = request.method();
    calls.push({ method, path: url.pathname, params: Object.fromEntries(url.searchParams), body: request.postDataJSON() });
    if (url.pathname === "/api/auth/refresh") return route.fulfill({ json: { data: { access_token: "fixture-memory", user } } });
    if (url.pathname === "/api/admin/companies" && method === "GET") return route.fulfill({ json: { success: true, data: [{ id: "1", name: "Empresa fixture", status: "active" }] } });
    if (url.pathname === "/api/admin/settings" && method === "GET") return route.fulfill({ json: { success: true, data: { configured: true, settings: [...stages, fixed], stages } } });
    if (url.pathname === "/api/admin/settings/collection-rules" && method === "PUT") {
      const submitted = request.postDataJSON().stages;
      stages = stages.map(item => ({ ...item, value: submitted.find(candidate => candidate.key === item.key).active }));
      return route.fulfill({ json: { success: true, data: { configured: true, settings: [...stages, fixed], stages } } });
    }
    return route.fulfill({ status: 404, json: { success: false } });
  });
  return { calls };
}

for (const width of [1440, 390, 320]) {
  test(`admin changes a supported collection stage with no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); const { calls } = await setup(page);
    await page.goto("/administracion/configuracion-cobranza");
    await expect(page.getByRole("heading", { name: "Configuración de cobranza" })).toBeVisible();
    await expect(page.getByText("3 %")).toBeVisible();
    await page.getByRole("checkbox", { name: "Activar Vence hoy" }).uncheck();
    await page.getByRole("button", { name: "Guardar configuración" }).click();
    await expect(page.getByRole("status")).toContainText("guardada correctamente");
    await page.reload(); await expect(page.getByRole("checkbox", { name: "Activar Vence hoy" })).not.toBeChecked();
    expect(calls.filter(call => call.method === "PUT").map(call => call.path)).toEqual(["/api/admin/settings/collection-rules"]);
    expect(calls.filter(call => call.method === "PUT").every(call => !Object.hasOwn(call.body, "company_id"))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("collector cannot access collection settings", async ({ page }) => {
  const { calls } = await setup(page, { canManage: false }); await page.goto("/administracion/configuracion-cobranza");
  await expect(page.getByRole("alert")).toContainText("No tienes permiso");
  await expect(page.getByRole("link", { name: "Configuración de cobranza" })).toHaveCount(0);
  expect(calls.some(call => call.path === "/api/admin/settings")).toBe(false);
});

test("global administrator resolves MERTEL without a company selector", async ({ page }) => {
  const { calls } = await setup(page, { globalAdmin: true }); await page.goto("/administracion/configuracion-cobranza");
  await expect(page.getByRole("checkbox", { name: "Activar En mora" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Empresa" })).toHaveCount(0);
  expect(calls.some(call => call.path === "/api/admin/settings" && !Object.hasOwn(call.params, "company_id"))).toBe(true);
});
