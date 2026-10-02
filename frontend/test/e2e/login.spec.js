import { expect, test } from "@playwright/test";

const user = { id: 1, name: "Personal Mertel", email: "personal@example.com", roles: ["admin"], permissions: ["roles.view"] };
const session = { access_token: "test-access-in-memory", user };
async function mockApi(page, restored = false) {
  let active = restored;
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/refresh") return route.fulfill({ status: active ? 200 : 401, json: { data: active ? session : null } });
    if (path === "/api/auth/login") { active = true; return route.fulfill({ json: { data: session } }); }
    if (path === "/api/auth/me") return route.fulfill({ json: { data: user } });
    if (path === "/api/auth/logout") { active = false; return route.fulfill({ json: { success: true } }); }
    return route.fulfill({ json: { success: true, data: [] } });
  });
}
test("login, identity, navigation, session reload, logout and protected routes", async ({ page }) => {
  await mockApi(page);
  await page.goto("/clientes"); await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Correo electrónico").fill(user.email);
  await page.getByLabel("Contraseña", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
  await expect(page).toHaveURL("http://127.0.0.1:5173/");
  await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  await page.goto("/login"); await expect(page).toHaveURL("http://127.0.0.1:5173/");
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/facturas"); await expect(page).toHaveURL(/\/login$/);
});
test("required fields, keyboard, show password, incorrect login and network failure", async ({ page }) => {
  await mockApi(page); await page.goto("/login");
  await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
  await expect(page.getByLabel("Correo electrónico")).toBeFocused();
  await page.getByLabel("Correo electrónico").fill(user.email);
  await page.keyboard.press("Tab"); await expect(page.getByLabel("Contraseña", { exact: true })).toBeFocused();
  await page.getByLabel("Contraseña", { exact: true }).fill("incorrect");
  await page.getByRole("button", { name: "Mostrar contraseña" }).click();
  await expect(page.getByLabel("Contraseña", { exact: true })).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Ocultar contraseña" }).click();
  await page.route("**/api/auth/login", route => route.fulfill({ status: 401, json: { message: "private backend error" } }));
  await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Correo o contraseña incorrectos.");
  await page.route("**/api/auth/login", route => route.abort("failed"));
  await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("No fue posible conectar con el servidor. Intenta nuevamente.");
});
for (const [name, width, height] of [["desktop", 1672, 941], ["tablet", 900, 1024], ["mobile", 390, 844], ["small-mobile", 320, 720]]) {
  test(`responsive ${name}: visible form, no overflow and stable loading`, async ({ page }) => {
    await page.setViewportSize({ width, height }); await mockApi(page); await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Bienvenido" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Iniciar sesión", exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `../tmp/login-${name}.png`, fullPage: true });
    await page.getByLabel("Correo electrónico").fill(user.email);
    await page.getByLabel("Contraseña", { exact: true }).fill("test-password");
    let release;
    await page.route("**/api/auth/login", async route => {
      await new Promise(resolve => { release = resolve; }); await route.fulfill({ status: 401, json: {} });
    });
    const before = await page.getByRole("button", { name: "Iniciar sesión", exact: true }).boundingBox();
    await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
    await expect(page.getByRole("button", { name: "Iniciando sesión..." })).toBeDisabled();
    expect(await page.getByRole("button", { name: "Iniciando sesión..." }).boundingBox()).toEqual(before);
    await expect.poll(() => typeof release).toBe("function"); release();
    await expect(page.getByRole("alert")).toBeVisible();
  });
}
