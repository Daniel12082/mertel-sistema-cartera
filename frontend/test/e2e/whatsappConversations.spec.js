import { test, expect } from '@playwright/test';
import { permissionsForRoles } from '../../../backend/src/config/permissions.js';
import { DEFAULT_APPEARANCE } from '../../../backend/src/config/appearance.js';

async function demo(page, prepare) {
  const requests = [], errors = [];
  const user = { id: '1', name: 'Admin de prueba', roles: [{ name: 'admin' }], permissions: permissionsForRoles([{ name: 'admin' }]) };
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname; requests.push(path);
    if (path === '/api/auth/refresh') return route.fulfill({ json: { data: { access_token: 'local-fixture', user } } });
    if (path === '/api/auth/me') return route.fulfill({ json: { data: user } });
    if (path === '/api/appearance') return route.fulfill({ json: { success: true, data: { appearance: DEFAULT_APPEARANCE, company_name: 'MERTEL IMPORTACIONES' } } });
    if (path === '/api/admin/whatsapp') return route.fulfill({ json: { success: true, data: { settings: { provider: 'MOCK', connection_status: 'NOT_CONFIGURED', rules: [] }, stage_catalog: [] } } });
    if (path === '/api/collection/message-templates') return route.fulfill({ json: { success: true, data: { templates: [], variables: [], stage_catalog: [] } } });
    if (path === '/api/admin/whatsapp/messages') return route.fulfill({ json: { success: true, data: { messages: [], page: 1, has_next: false } } });
    return route.fulfill({ json: { success: true, data: [] } });
  });
  await page.goto('/administracion/whatsapp'); await expect(page.getByRole('button', { name: 'Activar simulación' })).toBeVisible();
  await page.getByRole('button', { name: 'Activar simulación' }).click();
  await expect(page.getByText('MODO SIMULACIÓN', { exact: true })).toBeVisible();
  if (prepare) await page.evaluate(prepare);
  await page.locator('a[href="/administracion/whatsapp"]').first().click();
  await expect(page.getByRole('heading', { name: 'Conversaciones', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Abrir conversación Distribuciones Andinas DEMO S.A.S.' })).toBeVisible();
  const before = requests.length;
  return { requests, errors, before };
}
async function finance(page) {
  return page.evaluate(async () => {
    const { simulationData } = await import('/src/simulation/store.js'); const data = simulationData();
    return JSON.stringify({ customers: data.customers, invoices: data.invoices, payments: data.payments, allocations: data.allocations, configuration: data.configuration, whatsapp: data.whatsapp });
  });
}
for (const width of [390, 768, 1024, 1366, 1920]) test(`conversation list, chat, profile and simulated manual send at ${width}px`, async ({ page }) => {
  test.setTimeout(60000); await page.setViewportSize({ width, height: 1000 });
  const state = await demo(page), before = await finance(page);
  await expect(page.getByRole('complementary', { name: 'Lista de conversaciones' })).toBeVisible();
  await page.getByRole('button', { name: 'Abrir conversación Distribuciones Andinas DEMO S.A.S.' }).click();
  await expect(page.getByLabel('Mensaje entrante 97005')).toBeVisible(); await expect(page.getByLabel('Mensaje saliente 97001')).toBeVisible();
  const composer = page.getByLabel('Redactar mensaje');
  await composer.fill('/rec');
  const option = page.getByRole('option', { name: /Recordatorio de demostración/ }); await expect(option).toBeVisible();
  const popup = await page.locator('.wa-quick-menu').boundingBox();
  expect(popup.x).toBeGreaterThanOrEqual(0); expect(popup.x + popup.width).toBeLessThanOrEqual(width);
  expect(popup.y).toBeGreaterThanOrEqual(0); expect(popup.y + popup.height).toBeLessThanOrEqual(1000);
  await page.screenshot({ path: `../tmp/whatsapp-quick-replies-${width}.png`, fullPage: true });
  await composer.press('Escape'); await expect(page.getByRole('listbox')).toHaveCount(0); await expect(composer).toHaveValue('/rec');
  await composer.fill('/record'); await expect(option).toBeVisible(); await composer.press('ArrowDown'); await composer.press('Enter');
  await expect(composer).toHaveValue(/Hola Distribuciones Andinas DEMO S.A.S./);
  await expect(composer).toHaveValue(/FV-DEMO-001/); await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(page.getByText('Mensaje simulado enviado correctamente. No se realizó ningún envío real.', { exact: true })).toHaveCount(0);
  const text = `Mensaje de demostración a ${width}px`;
  await page.getByLabel('Redactar mensaje').fill(text); await page.getByRole('button', { name: 'Simular envío del mensaje' }).click();
  await expect(page.getByText('Mensaje simulado enviado correctamente. No se realizó ningún envío real.', { exact: true })).toBeVisible();
  await expect(page.getByRole('log')).toContainText(text);
  await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: `../tmp/whatsapp-conversations-${width}.png`, fullPage: true });
  if (width <= 980) await page.getByRole('button', { name: 'Ficha del cliente', exact: true }).click();
  const profile = page.getByRole('complementary', { name: 'Ficha del cliente' });
  await expect(profile).toBeVisible(); await expect(profile).toContainText('1.800.000'); await expect(profile).toContainText('FV-DEMO-001');
  if (width >= 1024) {
    const list = await page.locator('.wa-conversation-list').boundingBox(), chat = await page.locator('.wa-chat').boundingBox(), details = await page.locator('.wa-inbox-profile').boundingBox();
    expect(list.x + list.width).toBeLessThanOrEqual(chat.x + 1); expect(chat.x + chat.width).toBeLessThanOrEqual(details.x + 1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator('.wa-inbox-layout').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  if (width <= 980) await page.getByRole('button', { name: 'Volver al chat', exact: true }).click();
  if (width <= 620) { await page.getByRole('button', { name: 'Volver a conversaciones' }).click(); await expect(page.getByRole('complementary', { name: 'Lista de conversaciones' })).toBeVisible(); }
  await page.getByRole('button', { name: 'Envío manual', exact: true }).click(); await page.getByRole('button', { name: 'Conversaciones', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir conversación Distribuciones Andinas DEMO S.A.S.' }).click(); await expect(page.getByRole('log')).toContainText(text);
  expect(await finance(page)).toBe(before); expect(state.requests.slice(state.before)).toEqual([]); expect(state.errors).toEqual([]);
});

test('ambiguous sender requires explicit local association; empty chat and missing phone remain controlled', async ({ page }) => {
  const state = await demo(page, async () => {
    const { simulationData } = await import('/src/simulation/store.js'); const data = simulationData();
    data.customers[1].phone = data.customers[0].phone; data.customers[4].phone = '';
    data.messages.push({ id: 'inbox-ambiguous', customer_id: null, phone: data.customers[0].phone, content: 'Conversación pendiente de asociación.', direction: 'inbound', status: 'DELIVERED', provider: 'MOCK' });
  });
  const before = await finance(page);
  await page.getByRole('button', { name: 'Abrir conversación Asociación ambigua' }).click();
  await expect(page.getByText(/Hay varios clientes con este teléfono/)).toBeVisible(); await expect(page.getByLabel('Redactar mensaje')).toBeDisabled();
  await page.getByLabel('Cliente para asociar').selectOption('91002'); await page.getByRole('button', { name: 'Asociar en esta demo' }).click();
  await expect(page.getByLabel('Mensaje entrante inbox-ambiguous')).toBeVisible();
  await page.getByRole('button', { name: 'Abrir conversación Suministros Boreal DEMO' }).click(); await expect(page.getByText('No hay mensajes registrados para este cliente.')).toBeVisible(); await expect(page.getByLabel('Redactar mensaje')).toBeDisabled();
  expect(await finance(page)).toBe(before); expect(state.requests.slice(state.before)).toEqual([]); expect(state.errors).toEqual([]);
});

test('simulation reset discards conversation messages without creating real requests', async ({ page }) => {
  const state = await demo(page);
  await page.getByRole('button', { name: 'Abrir conversación Distribuciones Andinas DEMO S.A.S.' }).click();
  await page.getByLabel('Redactar mensaje').fill('Mensaje descartable al reiniciar'); await page.getByRole('button', { name: 'Simular envío del mensaje' }).click();
  await expect(page.getByRole('log')).toContainText('Mensaje descartable al reiniciar');
  await page.getByRole('button', { name: 'Reiniciar simulación' }).click(); await page.locator('a[href="/administracion/whatsapp"]').first().click();
  await page.getByRole('button', { name: 'Abrir conversación Distribuciones Andinas DEMO S.A.S.' }).click();
  await expect(page.getByRole('log')).not.toContainText('Mensaje descartable al reiniciar');
  expect(state.requests.slice(state.before)).toEqual([]); expect(state.errors).toEqual([]);
});
