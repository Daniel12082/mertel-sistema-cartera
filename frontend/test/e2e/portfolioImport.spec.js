import { expect, test } from "@playwright/test";
import { Buffer } from "node:buffer";

async function setup(page, { admin = true, globalAdmin = false } = {}) {
  const user = { id: "1", name: "Fixture", company_id: globalAdmin ? null : "1", is_global_admin: globalAdmin,
    roles: [admin ? "admin" : "collector"], permissions: admin ? ["portfolio.import"] : ["collection.view"] };
  const calls = [];
  await page.route("**/api/**", async route => {
    const request = route.request(); const url = new URL(request.url()); calls.push({ method: request.method(), path: url.pathname, params: Object.fromEntries(url.searchParams), contentType: request.headers()["content-type"] });
    if (url.pathname === "/api/auth/refresh") return route.fulfill({ json: { data: { access_token: "fixture-memory", user } } });
    if (url.pathname === "/api/admin/companies") return route.fulfill({ json: { success: true, data: [{ id: "1", name: "Empresa fixture", status: "active" }] } });
    if (url.pathname === "/api/admin/portfolio/imports" && request.method() === "GET") return route.fulfill({ json: { success: true, data: [] } });
    if (url.pathname === "/api/admin/portfolio/imports/analyze") return route.fulfill({ json: { success: true, data: {
      batch_id: "1", status: "analyzed_unconfigured", duplicate: false, format_configured: false,
      file: { name: "fixture.csv", size_bytes: 20, sha256: "a".repeat(64) }, headers: ["Columna uno", "Columna dos"], total_rows: 1, empty_rows: 0,
      successful_rows: 1, failed_rows: 0, preview: [["A", "B"]], issues: [],
    } } });
    return route.fulfill({ status: 404, json: { success: false } });
  });
  return calls;
}

for (const width of [1440, 390, 320]) test(`admin analyzes CSV without application or horizontal overflow at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); const calls = await setup(page);
  await page.goto("/administracion/importar-cartera");
  await expect(page.getByRole("heading", { name: "Importar cartera" })).toBeVisible();
  await page.getByLabel("Archivo CSV").setInputFiles({ name: "fixture.csv", mimeType: "text/csv", buffer: Buffer.from("A,B\nA,B\n") });
  await page.getByRole("button", { name: "Analizar archivo" }).click();
  await expect(page.getByText(/formato de cartera de MERTEL aún no está configurado/)).toBeVisible();
  await expect(page.getByRole("table")).toContainText("Columna uno");
  await expect(page.getByRole("button", { name: /importar/i })).toHaveCount(0);
  expect(calls.some(call => call.method === "POST" && call.path.endsWith("/analyze") && call.contentType.includes("text/csv"))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("collector cannot access portfolio import", async ({ page }) => {
  const calls = await setup(page, { admin: false }); await page.goto("/administracion/importar-cartera");
  await expect(page.getByRole("alert")).toContainText("No tienes permiso");
  await expect(page.getByRole("link", { name: "Importar cartera" })).toHaveCount(0);
  expect(calls.some(call => call.path === "/api/admin/portfolio/imports")).toBe(false);
});

test("global admin must select company before requesting import history", async ({ page }) => {
  const calls = await setup(page, { globalAdmin: true }); await page.goto("/administracion/importar-cartera");
  const company = page.getByRole("combobox", { name: "Empresa" }); await expect(company).toHaveValue("");
  expect(calls.some(call => call.path === "/api/admin/portfolio/imports")).toBe(false);
  await company.selectOption("1");
  await expect(page.getByLabel("Archivo CSV")).toBeVisible();
  expect(calls.filter(call => call.path === "/api/admin/portfolio/imports").every(call => call.params.company_id === "1")).toBe(true);
});
