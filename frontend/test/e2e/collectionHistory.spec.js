import { expect, test } from "@playwright/test";

const action = { id: "action:9", type: "action", occurred_at: "2026-10-06T15:30:00.000Z", actor: "Ana Cobradora", customer: { name: "Cliente fixture", identification: "NIT-1" }, invoice: "FV-1", title: "Llamada", description: "Realizará el pago mañana.", status: "completed", metadata: { action_type: "Llamada" } };
const promise = { id: "promise:8", type: "promise", occurred_at: "2026-10-06T15:20:00.000Z", actor: "Ana Cobradora", customer: { name: "Cliente fixture", identification: "NIT-1" }, invoice: "FV-1", title: "Promesa de pago", description: "Confirmada por teléfono.", status: "pending", metadata: { promised_date: "2026-10-07", amount: "2450000.00" } };
const pageResult = events => ({ success: true, data: { events, pagination: { page: 1, limit: 20, total: events.length, pages: 1, has_next: false, has_previous: false } } });

async function setup(page, { globalAdmin = false, history = true } = {}) {
  const user = { id: "1", company_id: globalAdmin ? null : "1", is_global_admin: globalAdmin, roles: [globalAdmin ? "admin" : "collector"],
    permissions: history ? ["collection.view", "collection.manage", "history.view", ...(globalAdmin ? ["settings.manage"] : [])] : ["collection.view"] };
  const calls = [];
  await page.route("**/api/**", async route => {
    const request = route.request(); const url = new URL(request.url()); calls.push({ path: url.pathname, params: Object.fromEntries(url.searchParams) });
    if (url.pathname === "/api/auth/refresh") return route.fulfill({ json: { success: true, data: { access_token: "memory-history", user } } });
    if (url.pathname === "/api/collection") return route.fulfill({ json: { success: true, data: { reference_date: "2026-10-06", status: "ready", rules_configured: true,
      stage_catalog: [{ key: "overdue", label: "En mora", category: "overdue" }], summary: { total_customers: 1, total_balance: "2450000.00", stages: { overdue: { customers: 1 } } },
      customers: [{ customer: { id: "7", name: "Cliente fixture", nit: "NIT-1", phone: null }, stage: "overdue", stage_label: "En mora", priority: 1, reason: "Vencida", total_balance: "2450000.00", eligible_balance: "2450000.00", main_invoice: { invoice: { invoice_id: "12", invoice_number: "FV-1", due_date: "2026-10-01" }, stage: "overdue" }, invoices: [{ invoice: { invoice_id: "12", invoice_number: "FV-1", balance: "2450000.00", due_date: "2026-10-01" }, stage: "overdue", eligible: true }] }], non_overdue_pending: { customers: [], total_invoices: 0, total_customers: 0, total_balance: "0.00" } } } });
    if (/\/actions$|\/promises$/.test(url.pathname) && request.method() === "GET") return route.fulfill({ json: { success: true, data: [] } });
    if (url.pathname.endsWith("/history/actors")) return route.fulfill({ json: { success: true, data: [{ id: "1", name: "Ana Cobradora" }] } });
    if (url.pathname.endsWith("/history")) return route.fulfill({ json: pageResult([action, promise]) });
    if (url.pathname === "/api/admin/companies") return route.fulfill({ json: { success: true, data: [{ id: "1", name: "Empresa fixture", status: "active" }] } });
    return route.fulfill({ status: 404, json: { success: false, data: [] } });
  });
  return calls;
}

for (const width of [1440, 1024, 768, 390, 320]) test(`customer history timeline is readable without overflow at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); const calls = await setup(page); await page.goto("/cobranza");
  await page.getByRole("button", { name: "Ver detalle de Cliente fixture" }).click();
  await page.getByRole("link", { name: "Historial" }).click();
  await expect(page.getByRole("heading", { name: "Historial del cliente" })).toBeVisible();
  await expect(page.getByText("Realizará el pago mañana.")).toBeVisible(); await expect(page.getByText("Fecha prometida: 2026-10-07")).toBeVisible();
  await page.getByRole("combobox", { name: "Tipo de evento" }).selectOption("promise");
  await expect.poll(() => calls.some(call => call.path.endsWith("/history") && call.params.type === "promise")).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("global administrative history resolves MERTEL and filters by actor and event type", async ({ page }) => {
  const calls = await setup(page, { globalAdmin: true }); await page.goto("/administracion/historial-cobranza");
  await expect(page.getByRole("heading", { name: "Historial de cobranza" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Empresa" })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Usuario" }).selectOption("1");
  await page.getByRole("combobox", { name: "Tipo de evento" }).selectOption("promise");
  await expect.poll(() => calls.some(call => call.path.endsWith("/collection/history") && !Object.hasOwn(call.params, "company_id") && call.params.actor_id === "1" && call.params.type === "promise")).toBe(true);
});

test("history page denies users without history permission", async ({ page }) => {
  await setup(page, { history: false }); await page.goto("/administracion/historial-cobranza");
  await expect(page.getByRole("alert")).toContainText("No tienes permiso");
});
