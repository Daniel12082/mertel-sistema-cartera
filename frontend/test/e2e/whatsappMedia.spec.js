import { test, expect } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { permissionsForRoles } from '../../../backend/src/config/permissions.js';
import { DEFAULT_APPEARANCE } from '../../../backend/src/config/appearance.js';

// Small valid image fixture; application attachments never use base64 storage.
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
for (const width of [390, 1366, 1920]) test(`multimedia template → slash command → local chat at ${width}px`, async ({ page }) => {
  test.setTimeout(90000); await page.setViewportSize({ width, height: 1000 });
  const requests = [], errors = [];
  const user = { id: '1', name: 'Admin local', roles: [{ name: 'admin' }], permissions: permissionsForRoles([{ name: 'admin' }]) };
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname; requests.push(path);
    if (path === '/api/auth/refresh') return route.fulfill({ json: { data: { access_token: 'local-fixture', user } } });
    if (path === '/api/auth/me') return route.fulfill({ json: { data: user } });
    if (path === '/api/appearance') return route.fulfill({ json: { success: true, data: { appearance: DEFAULT_APPEARANCE, company_name: 'MERTEL' } } });
    if (path === '/api/admin/whatsapp') return route.fulfill({ json: { success: true, data: { settings: { provider: 'MOCK', connection_status: 'NOT_CONFIGURED', rules: [] }, stage_catalog: [] } } });
    if (path === '/api/collection/message-templates') return route.fulfill({ json: { success: true, data: { templates: [], variables: [], stage_catalog: [] } } });
    return route.fulfill({ status: 503, json: { success: false, message: 'Recurso REAL no configurado en el fixture multimedia.' } });
  });
  await page.goto('/administracion/whatsapp'); await page.getByRole('button', { name: 'Activar simulación' }).click();
  await expect(page.getByText('MODO SIMULACIÓN', { exact: true })).toBeVisible();
  await page.locator('a[href="/administracion/whatsapp"]').first().click(); const before = requests.length;
  const financial = () => page.evaluate(async () => {
    const { simulationData } = await import('/src/simulation/store.js'); const data = simulationData();
    return JSON.stringify({ invoices: data.invoices, customers: data.customers, payments: data.payments, allocations: data.allocations, rules: data.configuration });
  });
  const ledger = await financial();
  await page.getByRole('button', { name: 'Plantillas', exact: true }).click();
  await page.getByRole('button', { name: 'Nueva plantilla' }).click();
  await page.getByLabel('Nombre de plantilla').fill('Multimedia E2E'); await page.getByLabel('Tipo de contenido').selectOption('image');
  await page.getByLabel('Estado inicial').selectOption('active'); await page.getByLabel('Contenido de plantilla').fill('Hola {{cliente_nombre}}');
  await page.getByLabel('Archivo adjunto').setInputFiles({ name: 'imagen-local.png', mimeType: 'image/png', buffer: image });
  await expect(page.getByAltText('Vista previa de imagen-local.png')).toBeVisible();
  expect(await page.getByAltText('Vista previa de imagen-local.png').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await page.getByLabel('Archivo adjunto').setInputFiles({ name: 'imagen-reemplazada.png', mimeType: 'image/png', buffer: image });
  await expect(page.getByLabel('Adjunto imagen-reemplazada.png')).toBeVisible();
  await page.getByRole('button', { name: 'Crear plantilla', exact: true }).click();
  await expect(page.getByRole('row', { name: /Multimedia E2E/ })).toContainText('Con adjunto temporal');
  await page.getByRole('button', { name: 'Conversaciones', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir conversación Distribuciones Andinas DEMO S.A.S.' }).click();
  await page.getByLabel('Redactar mensaje').fill('/multimedia'); await page.getByRole('option', { name: /Multimedia E2E/ }).click();
  await expect(page.getByLabel('Adjunto imagen-reemplazada.png')).toBeVisible();
  await expect(page.getByLabel('Redactar mensaje')).toHaveValue('Hola Distribuciones Andinas DEMO S.A.S.');
  await expect(page.getByRole('log').getByLabel('Adjunto imagen-reemplazada.png')).toHaveCount(0);
  if (width <= 620) await page.getByRole('button', { name: 'Volver a conversaciones' }).click();
  await page.getByRole('button', { name: 'Abrir conversación Repuestos Horizonte DEMO' }).click();
  await expect(page.getByLabel('Adjunto imagen-reemplazada.png')).toHaveCount(0);
  if (width <= 620) await page.getByRole('button', { name: 'Volver a conversaciones' }).click();
  await page.getByRole('button', { name: 'Abrir conversación Distribuciones Andinas DEMO S.A.S.' }).click();
  await expect(page.getByLabel('Adjunto imagen-reemplazada.png')).toBeVisible();
  await page.getByLabel('Redactar mensaje').fill('Texto revisado junto al adjunto');
  await page.screenshot({ path: `../tmp/whatsapp-media-${width}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Simular envío del mensaje' }).click();
  await expect(page.getByText('Mensaje multimedia simulado preparado correctamente. Ningún archivo fue enviado ni entregado realmente.')).toBeVisible();
  await expect(page.getByRole('log').getByLabel('Adjunto imagen-reemplazada.png')).toBeVisible();
  expect(await financial()).toBe(ledger); expect(requests.slice(before)).toEqual([]); expect(errors).toEqual([]);
  const reference = await page.evaluate(async () => {
    const { simulationData } = await import('/src/simulation/store.js'); return simulationData().messages.at(-1).attachment;
  });
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Salir de simulación' }).click();
  await expect(page.getByText('MODO SIMULACIÓN', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(async ref => {
    const { temporaryWhatsAppMedia } = await import('/src/services/whatsappMedia.service.js'); return temporaryWhatsAppMedia.get(ref) === null;
  }, reference)).toBe(true);
  await expect(page.getByRole('button', { name: 'Activar simulación' })).toBeVisible();
  expect(errors).toEqual([]);
});
