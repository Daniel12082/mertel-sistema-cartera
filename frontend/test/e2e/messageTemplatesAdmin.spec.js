import { expect, test } from "@playwright/test";

const variableCatalog = [
  { name: "nombre_cliente", label: "Nombre del cliente", source: "customers.name", example: "Juan Pérez" },
  { name: "saldo_pendiente", label: "Saldo pendiente total del cliente", source: "collection_customer.total_balance", example: "$2.450.000,00" },
];
const stageCatalog = [{ key: "overdue", label: "En mora" }];
const savedTemplate = { id: "41", name: "Recordatorio fixture", channel: "whatsapp", content: "Hola {{nombre_cliente}}", stage: "overdue", status: "inactive", created_at: "2026-10-01T10:00:00.000Z", updated_at: "2026-10-02T11:00:00.000Z" };

async function setup(page, { canManage = true, empty = true, error = false } = {}) {
  const user = { id: "1", name: "Admin fixture", company_id: "1", is_global_admin: false,
    roles: [canManage ? "admin" : "collector"], permissions: canManage ? ["message_templates.manage"] : ["collection.view", "collection.manage"] };
  const calls = []; let templates = empty ? [] : [savedTemplate];
  const external = [];
  page.on("request", request => {
    const url = new URL(request.url());
    const currentFont = ["fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname) && ["stylesheet", "font"].includes(request.resourceType());
    if (!currentFont && !url.hostname.endsWith("127.0.0.1") && url.hostname !== "localhost") external.push(url.origin);
  });
  await page.route("**/api/**", async route => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname; const method = request.method();
    calls.push({ method, path, body: request.postDataJSON() });
    if (path === "/api/auth/refresh") return route.fulfill({ json: { data: { access_token: "fixture-memory", user } } });
    if (path === "/api/collection/message-templates" && method === "GET") return route.fulfill(error ? { status: 500, json: { success: false, message: "private SQL data" } } : { json: { success: true, data: { templates, stage_catalog: stageCatalog, variables: variableCatalog } } });
    if (path === "/api/collection/message-templates" && method === "POST") {
      templates = [{ ...savedTemplate, ...request.postDataJSON(), id: "42", created_at: "2026-10-05T10:00:00.000Z", updated_at: "2026-10-05T10:00:00.000Z" }, ...templates];
      return route.fulfill({ status: 201, json: { success: true, data: templates[0] } });
    }
    if (path === "/api/collection/message-templates/41" && method === "PUT") {
      templates = templates.map(item => item.id === "41" ? { ...item, ...request.postDataJSON(), updated_at: "2026-10-05T10:00:00.000Z" } : item);
      return route.fulfill({ json: { success: true, data: templates[0] } });
    }
    const toggle = path.match(/^\/api\/collection\/message-templates\/(\d+)\/(activate|deactivate)$/);
    if (toggle && method === "POST") {
      templates = templates.map(item => item.id === toggle[1] ? { ...item, status: toggle[2] === "activate" ? "active" : "inactive" } : item);
      return route.fulfill({ json: { success: true, data: templates.find(item => item.id === toggle[1]) } });
    }
    return route.fulfill({ status: 404, json: { success: false } });
  });
  return { calls, external };
}

for (const width of [1440, 390, 320]) {
  test(`5.1A admin creates, previews and activates only through scoped endpoints at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const { calls, external } = await setup(page);
    page.on("dialog", dialog => dialog.accept());
    await page.goto("/administracion/plantillas-whatsapp");
    await expect(page.getByRole("heading", { name: "Plantillas WhatsApp", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Plantillas WhatsApp" })).toBeVisible();
    await expect(page.getByText("No hay plantillas WhatsApp configuradas")).toBeVisible();
    await page.locator(".template-admin-header").getByRole("button", { name: "Nueva plantilla" }).click();
    await page.getByLabel("Nombre de plantilla").fill("Aviso de saldo");
    await page.getByLabel("Contenido de plantilla").fill("Hola ");
    await page.getByRole("button", { name: "Insertar {{nombre_cliente}}" }).click();
    await expect(page.getByLabel("Contenido de plantilla")).toHaveValue("Hola {{nombre_cliente}}");
    await expect(page.getByLabel("Vista previa con ejemplos")).toContainText("Hola Juan Pérez");
    await page.getByLabel("Etapa de cobranza").selectOption("overdue");
    await page.getByRole("button", { name: "Crear plantilla" }).click();
    const row = page.getByRole("row", { name: /Aviso de saldo/ }); await expect(row).toBeVisible();
    await row.getByRole("button", { name: /Activar/ }).click(); await expect(row.getByText("Activa")).toBeVisible();
    await expect.poll(() => calls.filter(call => call.method === "GET" && call.path === "/api/collection/message-templates").length).toBe(3);
    expect(calls.filter(call => !call.path.startsWith("/api/auth/")).map(call => `${call.method} ${call.path}`)).toEqual([
      "GET /api/collection/message-templates", "POST /api/collection/message-templates", "GET /api/collection/message-templates", "POST /api/collection/message-templates/42/activate", "GET /api/collection/message-templates",
    ]);
    expect(calls.some(call => JSON.stringify(call.body ?? {}).includes("company_id"))).toBe(false);
    expect(external).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("5.1A denies collector UI entry", async ({ page }) => {
  const { calls } = await setup(page, { canManage: false }); await page.goto("/administracion/plantillas-whatsapp");
  await expect(page.getByRole("alert")).toContainText("No tienes permiso");
  await expect(page.getByRole("link", { name: "Plantillas WhatsApp" })).toHaveCount(0);
  expect(calls.some(call => call.path === "/api/collection/message-templates")).toBe(false);
});

test("5.1A renders empty and safe API failure states", async ({ page }) => {
  await setup(page, { error: true }); await page.goto("/administracion/plantillas-whatsapp");
  await expect(page.getByText("No se pudieron cargar las plantillas")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("No fue posible administrar las plantillas");
  await expect(page.getByText("private SQL data")).toHaveCount(0);
});
