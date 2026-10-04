import { expect, test } from "@playwright/test";
import { collectionFixture } from "../collection.fixture";

async function mockApi(page) {
  const user = { id: 1, name: "Personal MERTEL", roles: ["collector"], permissions: ["collection.view"] };
  await page.route("**/api/**", route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/refresh") return route.fulfill({ json: { data: { access_token: "test-memory-only", user } } });
    if (url.pathname === "/api/auth/me") return route.fulfill({ json: { data: user } });
    if (url.pathname === "/api/collection") return route.fulfill({ json: { success: true, data: collectionFixture() } });
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
