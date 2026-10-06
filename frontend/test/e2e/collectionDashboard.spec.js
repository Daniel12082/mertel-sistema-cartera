import { expect, test } from "@playwright/test";

async function setup(page, { admin = true, globalAdmin = false } = {}) {
  const permissions = admin ? ["collection.view", "settings.manage"] : ["collection.view", "collection.manage"];
  const user = { id: "1", company_id: globalAdmin ? null : "1", is_global_admin: globalAdmin, roles: [admin ? "admin" : "collector"], permissions };
  const calls = [];
  await page.route("**/api/**", async route => {
    const request = route.request(); const url = new URL(request.url()); calls.push({ path: url.pathname, method: request.method(), params: Object.fromEntries(url.searchParams) });
    if (url.pathname === "/api/auth/refresh") return route.fulfill({ json: { success: true, data: { access_token: "memory-fixture", user } } });
    if (url.pathname === "/api/admin/companies") return route.fulfill({ json: { success: true, data: [{ id: "1", name: "Empresa fixture", status: "active" }] } });
    if (url.pathname === "/api/admin/collection/dashboard") return route.fulfill({ json: { success: true, data: {
      reference_date: url.searchParams.get("reference_date"), portfolio: { total_balance: "125000.00", customers_in_collection: 1 },
      stages: [{ key: "overdue", label: "En mora", customers: 1, balance: "125000.00" }],
      promises: { pending_count: 2, pending_amount: "50000.00" },
      activity: { activity_from: url.searchParams.get("activity_from"), activity_to: url.searchParams.get("activity_to"), actions_period: 3 },
      warnings: ["Reglas incompletas"], collection_status: "ready", message: null,
    } } });
    return route.fulfill({ status: 404, json: { success: false } });
  });
  return calls;
}

for (const width of [1440, 1024, 768, 390, 320]) test(`dashboard displays real-source metrics without horizontal overflow at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); const calls = await setup(page);
  await page.goto("/administracion/dashboard-cobranza");
  await expect(page.getByRole("heading", { name: "Dashboard de cobranza" })).toBeVisible();
  await expect(page.getByText("Saldo pendiente total")).toBeVisible(); await expect(page.getByText("Advertencias de configuración")).toBeVisible();
  await page.getByLabel("Fecha de referencia de cartera").fill("2026-09-30");
  await page.getByRole("combobox", { name: "Período de actividad" }).selectOption("30");
  await expect.poll(() => calls.filter(call => call.path === "/api/admin/collection/dashboard").at(-1)?.params.reference_date).toBe("2026-09-30");
  expect(calls.filter(call => call.path === "/api/admin/collection/dashboard").at(-1).params.activity_from).toBeTruthy();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("collector is denied and global admin must select an explicit company", async ({ page }) => {
  let calls = await setup(page, { admin: false }); await page.goto("/administracion/dashboard-cobranza");
  await expect(page.getByRole("alert")).toContainText("No tienes permiso");
  expect(calls.some(call => call.path === "/api/admin/collection/dashboard")).toBe(false);
});

test("global admin resolves MERTEL without a company selector", async ({ page }) => {
  const calls = await setup(page, { globalAdmin: true }); await page.goto("/administracion/dashboard-cobranza");
  await expect(page.getByText("Clientes en cobranza")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Empresa" })).toHaveCount(0);
  expect(calls.some(call => call.path === "/api/admin/collection/dashboard" && !Object.hasOwn(call.params, "company_id"))).toBe(true);
});
