import { test, expect } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { permissionsForRoles } from '../../../backend/src/config/permissions.js';
import { DEFAULT_APPEARANCE } from '../../../backend/src/config/appearance.js';

const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

for (const width of [390, 768, 1024, 1366, 1920]) test(`template editor layout and existing actions at ${width}px`, async ({ page }) => {
  test.setTimeout(60000); await page.setViewportSize({ width, height: 1000 });
  const requests = [], errors = [];
  const user = { id: '1', name: 'Admin fixture', roles: [{ name: 'admin' }], permissions: permissionsForRoles([{ name: 'admin' }]) };
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname; requests.push(path);
    if (path === '/api/auth/refresh') return route.fulfill({ json: { data: { access_token: 'local-fixture', user } } });
    if (path === '/api/auth/me') return route.fulfill({ json: { data: user } });
    if (path === '/api/appearance') return route.fulfill({ json: { success: true, data: { appearance: DEFAULT_APPEARANCE, company_name: 'MERTEL' } } });
    if (path === '/api/admin/whatsapp') return route.fulfill({ json: { success: true, data: { settings: { provider: 'MOCK', connection_status: 'NOT_CONFIGURED', rules: [] }, stage_catalog: [] } } });
    if (path === '/api/collection/message-templates') return route.fulfill({ json: { success: true, data: { templates: [], variables: [], stage_catalog: [] } } });
    return route.fulfill({ status: 503, json: { success: false, message: 'Recurso REAL no configurado en este fixture.' } });
  });
  await page.goto('/administracion/whatsapp'); await page.getByRole('button', { name: 'Activar simulación' }).click();
  await expect(page.getByText('MODO SIMULACIÓN', { exact: true })).toBeVisible();
  await page.locator('a[href="/administracion/whatsapp"]').first().click(); const before = requests.length;
  await page.getByRole('button', { name: 'Plantillas', exact: true }).click(); await page.getByRole('button', { name: 'Nueva plantilla' }).click();
  const editor = page.getByRole('form', { name: 'Editor de plantilla WhatsApp' });
  await expect(editor.getByRole('heading', { name: 'Información de la plantilla' })).toBeVisible();
  await expect(editor.getByRole('heading', { name: 'Editor del mensaje' })).toBeVisible();
  await expect(editor.getByRole('heading', { name: 'Vista previa', exact: true })).toBeVisible();
  const description = page.getByLabel('Descripción (opcional)'); await expect(description).toBeVisible();
  const labelBox = await page.locator('label[for="template-description"] > span').boundingBox(), descriptionBox = await description.boundingBox(), nameBox = await page.getByLabel('Nombre de plantilla').boundingBox();
  expect(descriptionBox.y - labelBox.y - labelBox.height).toBeGreaterThanOrEqual(7);
  expect(descriptionBox.height).toBeGreaterThanOrEqual(44); expect(descriptionBox.x).toBe(nameBox.x); expect(descriptionBox.width).toBe(nameBox.width);
  expect(descriptionBox.width).toBeGreaterThan(200);
  await expect(editor.getByRole('button', { name: 'Adjuntar archivo' })).toBeDisabled();
  await page.getByLabel('Nombre de plantilla').fill(`Editor ${width}`); await description.fill('Descripción separada y alineada');
  await page.getByLabel('Contenido de plantilla').fill('Hola '); await page.getByRole('button', { name: 'Insertar {{cliente_nombre}}', exact: true }).click();
  await expect(page.getByLabel('Contenido de plantilla')).toHaveValue('Hola {{cliente_nombre}}');
  await expect(page.locator('.template-chat-bubble')).not.toContainText('{{cliente_nombre}}');
  const messageBox = await page.getByLabel('Contenido de plantilla').boundingBox(); expect(messageBox.height).toBeGreaterThanOrEqual(190);
  for (const [type, mime] of [['video', 'video/mp4'], ['audio', 'audio/mpeg'], ['image', 'image/png']]) {
    await page.getByLabel('Tipo de contenido').selectOption(type); await expect(editor.getByRole('button', { name: 'Adjuntar archivo' })).toBeEnabled();
    expect((await page.getByLabel('Archivo adjunto').getAttribute('accept')).split(',')).toContain(mime);
  }
  expect(await editor.locator('button svg.lucide-paperclip').count()).toBe(1);
  expect(await editor.locator('svg.lucide-camera').count()).toBe(0);
  const chooser = page.waitForEvent('filechooser'); await editor.getByRole('button', { name: 'Adjuntar archivo' }).click();
  await (await chooser).setFiles({ name: 'imagen-editor.png', mimeType: 'image/png', buffer: image });
  const preview = editor.getByLabel('Vista previa con ejemplos'); await expect(preview.getByAltText('Vista previa de imagen-editor.png')).toBeVisible();
  await expect(preview.getByLabel('Adjunto imagen-editor.png')).toContainText('image/png');
  const replacement = page.waitForEvent('filechooser'); await editor.getByRole('button', { name: 'Reemplazar adjunto' }).click();
  await (await replacement).setFiles({ name: 'imagen-nueva.png', mimeType: 'image/png', buffer: image });
  await expect(preview.getByAltText('Vista previa de imagen-nueva.png')).toBeVisible();
  await editor.getByRole('button', { name: 'Retirar adjunto' }).click(); await expect(preview.locator('img')).toHaveCount(0);
  await page.getByLabel('Archivo adjunto').setInputFiles({ name: 'imagen-final.png', mimeType: 'image/png', buffer: image });
  await expect(preview.getByAltText('Vista previa de imagen-final.png')).toBeVisible();
  await page.screenshot({ path: `../tmp/whatsapp-template-editor-${width}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await editor.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await editor.getByRole('button', { name: 'Crear plantilla', exact: true }).click();
  await expect(page.getByRole('row', { name: new RegExp(`Editor ${width}`) })).toContainText('Con adjunto temporal');
  await page.getByRole('button', { name: `Editar Editor ${width}`, exact: true }).click(); await expect(description).toHaveValue('Descripción separada y alineada');
  await page.getByLabel('Contenido de plantilla').fill('Cambio que se cancela'); await editor.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('button', { name: `Editar Editor ${width}`, exact: true }).click(); await expect(page.getByLabel('Contenido de plantilla')).toHaveValue('Hola {{cliente_nombre}}');
  await editor.getByRole('button', { name: 'Retirar adjunto' }).click(); await page.getByLabel('Tipo de contenido').selectOption('text');
  await page.getByLabel('Contenido de plantilla').fill('Edición de texto conservada'); await editor.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByRole('row', { name: new RegExp(`Editor ${width}`) })).toContainText('Edición de texto conservada');
  expect(requests.slice(before)).toEqual([]); expect(errors).toEqual([]);
});
