import { expect, test } from "@playwright/test";
import { collectionFixture } from "../collection.fixture";
import { readFile } from "node:fs/promises";
import { buildCollectionResult } from "../../../backend/src/services/collection.service.js";

async function mockApi(page, fixture = collectionFixture(), permissions = ["collection.view"]) {
  const user = { id: 1, name: "Personal MERTEL", roles: ["collector"], permissions };
  const actions = []; const promises = [];
  await page.route("**/api/**", route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/refresh") return route.fulfill({ json: { data: { access_token: "test-memory-only", user } } });
    if (url.pathname === "/api/auth/me") return route.fulfill({ json: { data: user } });
    if (url.pathname === "/api/collection") return route.fulfill({ json: { success: true, data: { ...fixture, reference_date: url.searchParams.get("reference_date") } } });
    if (url.pathname === "/api/collection/customers/1/actions" || url.pathname === "/api/collection/customers/1/promises") {
      const isAction = url.pathname.endsWith("actions"); const rows = isAction ? actions : promises;
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON();
        const saved = { ...body, id: String(rows.length + 1), user_id: "1", user_name: "Cobrador", status: isAction ? "completed" : "pending", action_date: "2026-10-05T15:00:00Z", created_at: "2026-10-05T15:00:00Z" };
        rows.unshift(saved); return route.fulfill({ status: 201, json: { success: true, data: saved } });
      }
      return route.fulfill({ json: { success: true, data: rows } });
    }
    return route.fulfill({ json: { success: true, data: [] } });
  });
}

for (const [name, width, height] of [["desktop", 1440, 900], ["laptop", 1024, 768], ["tablet", 768, 1024], ["mobile", 390, 844], ["small-mobile", 320, 720]]) {
  test(`collection responsive ${name}: rows, detail and no document overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height }); await mockApi(page); await page.goto("/cobranza");
    await expect(page.getByRole("heading", { name: "Cobranza", exact: true })).toBeVisible();
    const detail = page.getByRole("button", { name: "Ver detalle de Cliente Águila" }); await expect(detail).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await detail.click(); const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox(); expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(bounds.height).toBeLessThanOrEqual(height);
    await expect(dialog.getByText("Saldo de facturas elegibles para cobranza")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `../tmp/collection-${name}.png`, fullPage: true });
    await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible(); await expect(detail).toBeFocused();
  });
}

test("collection sends exact calendar date and filters without extra requests", async ({ page }) => {
  await mockApi(page); await page.goto("/cobranza");
  await expect(page.getByText("Cliente Águila", { exact: true })).toBeVisible();
  const request = page.waitForRequest(req => new URL(req.url()).pathname === "/api/collection" && new URL(req.url()).searchParams.get("reference_date") === "2026-10-04");
  await page.getByLabel("Fecha de referencia").fill("2026-10-04"); await request;
  await page.getByLabel("Buscar cliente / NIT / factura").fill("FV-003");
  await expect(page.getByText("Cliente Beta", { exact: true })).not.toBeVisible();
  await expect(page.getByText("Cliente Águila", { exact: true })).toBeVisible();
});

for (const [name, width, height] of [["desktop", 1440, 900], ["mobile", 390, 844]]) {
  test(`4.9 manual action, pending promise and unsent draft ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height }); await mockApi(page, collectionFixture(), ["collection.view", "collection.manage"]);
    const posts = []; page.on("request", request => { if (request.method() === "POST" && !request.url().includes("/auth/")) posts.push(new URL(request.url()).pathname); });
    await page.goto("/cobranza"); const detail = page.getByRole("button", { name: "Ver detalle de Cliente Águila" }); await detail.click();
    const dialog = page.getByRole("dialog"); await expect(dialog.getByText("No hay gestiones registradas.")).toBeVisible();
    await dialog.getByRole("button", { name: "Registrar gestión", exact: true }).click();
    await expect(dialog.getByLabel("Factura de la operación")).toBeFocused();
    await dialog.getByLabel("Tipo de gestión (texto libre)").fill("Nota libre de fixture");
    await dialog.getByLabel("Observación de gestión").fill("Observación manual de fixture");
    await dialog.getByRole("button", { name: "Guardar registro" }).click();
    await expect(dialog.getByText("Gestión registrada.")).toBeVisible(); await expect(dialog.getByText("Observación manual de fixture")).toBeVisible();
    await dialog.getByRole("button", { name: "Registrar promesa", exact: true }).click();
    await dialog.getByLabel("Fecha prometida").fill("2026-10-15"); await dialog.getByLabel("Valor prometido").fill("12.34");
    await dialog.getByRole("button", { name: "Guardar registro" }).click();
    await expect(dialog.getByText("Promesa registrada como pendiente.")).toBeVisible(); await expect(dialog.getByText(/Estado: Pendiente/)).toBeVisible();
    await dialog.getByRole("button", { name: "Enviar mensaje a WhatsApp" }).click();
    await expect(dialog.getByText("No hay mensajes configurados")).toBeVisible();
    expect(posts).toEqual(["/api/collection/customers/1/actions", "/api/collection/customers/1/promises"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `../tmp/collection49-${name}.png`, fullPage: true });
    await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible(); await expect(detail).toBeFocused();
  });
}

test("4.8 renders backend hierarchy, warnings, invoice eligibility and prompt review on mobile", async ({ page }) => {
  const fixture = collectionFixture();
  fixture.configuration_warnings = ["Pronto Pago pendiente de calendario y límites." ];
  fixture.customers[0].invoices[0].prompt_payment = { percentage: "3", window: { reason: "Diez días desde emisión: calendario pendiente." }, eligibility: { reason: "Productos desconocidos: revisión manual." }, discount: { amount: null, reason: "No se aplicó descuento ni se modificó el saldo." } };
  await page.setViewportSize({ width: 390, height: 844 }); await mockApi(page, fixture); await page.goto("/cobranza");
  await expect(page.getByText("Pronto Pago pendiente de calendario y límites.")).toBeVisible();
  const cards = page.getByRole("region", { name: "Resumen de cobranza" }).locator("article");
  await expect(cards.nth(0)).toContainText("En mora"); await expect(cards.nth(2)).toContainText("Faltan 5 días");
  await page.getByRole("button", { name: "Ver detalle de Cliente Águila" }).click();
  const dialog = page.getByRole("dialog"); const summary = dialog.locator("summary", { hasText: "Ver evaluación" });
  await summary.scrollIntoViewIfNeeded(); await summary.click();
  await expect(dialog.getByText("Productos desconocidos: revisión manual.")).toBeVisible();
  await expect(dialog.getByText("No se aplicó descuento ni se modificó el saldo.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "../tmp/collection48-mobile.png", fullPage: true });
});

for (const [name, width, height] of [["desktop", 1440, 900], ["mobile", 390, 844]]) {
  test(`phase 5 real backend rules render benefits and pending-only invoices ${name}`, async ({ page }) => {
    const rules = JSON.parse(await readFile(new URL("../../../backend/config/mertel-collection-rules.json", import.meta.url), "utf8"));
    const customer = { id: 1, company_id: "7", name: "Cliente Águila", nit: "FIXTURE-A" };
    const pending = { id: 2, company_id: "7", name: "Cliente pendiente", nit: "FIXTURE-B" };
    const invoice = { id: 11, company_id: "7", customer_id: 1, invoice_number: "PP-FIXTURE", issue_date: "2026-10-05", due_date: "2026-11-05", base_value: "100.00", balance: "119.00" };
    const fixture = buildCollectionResult({ company: { id: "7" }, referenceDate: "2026-10-15", customers: [customer, pending], rules,
      invoices: [invoice, { ...invoice, id: 21, customer_id: 2, invoice_number: "NV-FIXTURE", issue_date: "2026-08-16" }] });
    await page.setViewportSize({ width, height }); await mockApi(page, fixture); await page.goto("/cobranza");
    await expect(page.getByRole("button", { name: "Ver detalle de Cliente Águila" })).toBeVisible();
    await page.getByLabel("Fecha de referencia").fill("2026-10-15");
    const region = page.getByRole("region", { name: "Facturas no vencidas" }); await expect(region.getByText("NV-FIXTURE")).toBeVisible();
    await region.getByRole("button", { name: "Ver factura no vencida NV-FIXTURE" }).click();
    let dialog = page.getByRole("dialog"); await dialog.getByText("Ver beneficio condicionado", { exact: true }).click();
    await expect(dialog.getByText("Estado: Elegible", { exact: true })).toBeVisible();
    await expect(dialog.getByText(/Ventana: 60–70 días calendario/)).toBeVisible();
    await expect(dialog.getByText(/Base y aplicación financiera del 10% pendientes/)).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Ver detalle de Cliente Águila" }).click();
    dialog = page.getByRole("dialog"); await dialog.getByText("Ver evaluación", { exact: true }).click();
    await expect(dialog.getByText("Estado: Revisión manual", { exact: true })).toBeVisible();
    await expect(dialog.getByText(/Último día:/)).toBeVisible();
    await expect(dialog.getByText(/Descuento estimado/)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `../tmp/collection5-${name}.png`, fullPage: true });
  });
}
