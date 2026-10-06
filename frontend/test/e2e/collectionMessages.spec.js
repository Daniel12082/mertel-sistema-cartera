import { expect, test } from "@playwright/test";
import { collectionFixture } from "../collection.fixture";

async function fixtureApi(page, { phone = "300 000 0000", empty = false, manage = true, missing = false, error = false } = {}) {
  const fixture = collectionFixture(); fixture.customers[0].customer.phone = phone;
  const user = { id: "1", name: "Cobrador fixture", roles: ["collector"], permissions: ["collection.view", ...(manage ? ["collection.manage"] : [])] };
  const calls = []; const external = [];
  page.on("request", request => {
    const url = new URL(request.url());
    const existingFont = ["fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname) && ["stylesheet", "font"].includes(request.resourceType());
    if (!["127.0.0.1", "localhost"].includes(url.hostname) && !existingFont) external.push(url.origin);
  });
  await page.route("**/api/**", route => {
    const url = new URL(route.request().url()); const path = url.pathname; const method = route.request().method();
    calls.push({ method, path });
    if (path === "/api/auth/refresh") return route.fulfill({ json: { data: { access_token: "fixture-in-memory", user } } });
    if (path === "/api/collection") return route.fulfill({ json: { success: true, data: { ...fixture, reference_date: url.searchParams.get("reference_date") } } });
    if (path.endsWith("message-templates")) return route.fulfill(error ? { status: 500, json: {} } : { json: { success: true, data: empty ? [] : [{ id: "7", name: "Plantilla de prueba", content: "Solo fixture {{cliente}}", variables: ["cliente"] }] } });
    if (path.endsWith("messages/preview") || path.endsWith("messages/prepare")) {
      const prepared = path.endsWith("prepare");
      const data = { customer: { ...fixture.customers[0].customer, id: "1" }, template: { id: "7", name: "Plantilla de prueba" },
        content: missing ? "Solo fixture {{factura}}" : "Solo fixture Cliente Águila · FV-001 · $ 150.000,00", reference_date: route.request().postDataJSON().reference_date,
        variables: [{ name: missing ? "factura" : "cliente", value: missing ? null : "Cliente Águila" }], missing_variables: missing ? ["factura"] : [], unsupported_variables: [],
        malformed_variables: false, can_prepare: Boolean(phone) && !missing, phone_available: Boolean(phone), prepared,
        notice: prepared ? "Mensaje preparado temporalmente. No se ha enviado ni guardado como envío." : "Vista previa. No se ha enviado ningún mensaje." };
      return route.fulfill({ json: { success: true, data } });
    }
    return route.fulfill({ json: { success: true, data: [] } });
  });
  return { calls, external };
}

for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [390, 844], [320, 720]]) {
  test(`5.1 client card to prepared WhatsApp preview, keyboard/focus and responsive ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height }); const { calls, external } = await fixtureApi(page); await page.goto("/cobranza");
    const card = page.getByRole("article", { name: "Cliente Cliente Águila" }); const trigger = card.getByRole("button", { name: "Enviar mensaje a WhatsApp" });
    await expect(trigger).toBeVisible(); await expect(page.getByRole("article", { name: "Cliente Cliente Águila" })).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `../tmp/collection51-pipeline-${width}.png`, fullPage: true });
    await trigger.click(); const dialog = page.getByRole("dialog"); const selector = dialog.getByLabel("Seleccionar plantilla");
    await expect(selector).toBeFocused(); await selector.selectOption("7"); await dialog.getByRole("button", { name: "Ver vista previa" }).click();
    const preview = dialog.getByLabel("Vista previa del mensaje"); await expect(preview).toContainText("300 000 0000"); await expect(preview).toContainText("FV-001");
    await preview.getByRole("button", { name: "Preparar mensaje" }).click(); await expect(preview.getByRole("heading", { name: "Mensaje preparado" })).toBeVisible();
    await expect(preview).toContainText("No se ha enviado ni guardado como envío."); await expect(page.getByText("Mensaje enviado", { exact: true })).toHaveCount(0);
    expect(calls.filter(call => call.method === "POST" && !call.path.startsWith("/api/auth/")).map(call => call.path)).toEqual(["/api/collection/customers/1/messages/preview", "/api/collection/customers/1/messages/prepare"]);
    expect(external).toEqual([]);
    const bounds = await dialog.boundingBox(); expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x+bounds.width).toBeLessThanOrEqual(width); expect(bounds.height).toBeLessThanOrEqual(height);
    expect(await dialog.locator(".cartera-modal-body").evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `../tmp/collection51-message-${width}.png`, fullPage: true });
    await dialog.getByRole("button", { name: "Cerrar", exact: true }).focus(); await page.keyboard.press("Tab"); await expect(dialog.getByRole("button", { name: "Cerrar detalle" })).toBeFocused();
    await page.keyboard.press("Shift+Tab"); await expect(dialog.getByRole("button", { name: "Cerrar", exact: true })).toBeFocused();
    await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible(); await expect(trigger).toBeFocused();
  });
}
test("5.1 read-only cards, empty templates, missing phone/variables and API errors never prepare", async ({ page }) => {
  for (const options of [{ manage: false }, { empty: true }, { phone: null }, { missing: true }, { error: true }]) {
    const { calls } = await fixtureApi(page, options); await page.goto("/cobranza");
    const trigger = page.getByRole("article", { name: "Cliente Cliente Águila" }).getByRole("button", { name: "Enviar mensaje a WhatsApp" });
    if (options.manage === false) { await expect(trigger).toBeDisabled(); expect(calls.some(call => call.path.includes("message"))).toBe(false); continue; }
    await trigger.click(); const dialog = page.getByRole("dialog");
    if (options.empty) { await expect(dialog.getByText("No hay mensajes configurados")).toBeVisible(); await expect(dialog.getByRole("heading", { name: "WhatsApp", exact: true })).toBeFocused(); }
    else if (options.error) await expect(dialog.getByRole("alert")).toContainText("No fue posible consultar");
    else {
      await dialog.getByLabel("Seleccionar plantilla").selectOption("7"); await dialog.getByRole("button", { name: "Ver vista previa" }).click();
      await expect(dialog.getByRole("button", { name: "Preparar mensaje", exact: true })).toBeDisabled();
      if (options.phone === null) await expect(dialog.getByText("Este cliente no tiene un número de WhatsApp registrado.")).toBeVisible();
      if (options.missing) await expect(dialog.getByRole("alert")).toContainText("Falta información: factura");
    }
    expect(calls.some(call => call.path.endsWith("messages/prepare") || call.path.endsWith("/actions") && call.method === "POST")).toBe(false);
    await page.unroute("**/api/**");
  }
});
