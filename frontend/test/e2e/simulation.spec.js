import { contactDates, MERTEL_CONTACTS } from '../../../backend/src/services/whatsappSequence.js';
import { expect, test } from '@playwright/test';
import { DEFAULT_APPEARANCE } from '../../../backend/src/config/appearance';
import { permissionsForRoles } from '../../../backend/src/config/permissions.js';
import { makeMertelWorkbook, mertelRow } from '../../../backend/test/fixtures/mertelPortfolioWorkbook.js';

async function setup(page) {
  const requests = [], errors = [];
  const user = { id: '1', name: 'IDENTIDAD PRIVADA DE PRUEBA', email: 'private-fixture@example.invalid', roles: [{ name: 'admin' }], permissions: permissionsForRoles([{ name: 'admin' }]) };
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname; requests.push({ path, method: route.request().method() });
    if (path === '/api/auth/refresh') return route.fulfill({ json: { data: { access_token: 'fixture-memory-only', user } } });
    if (path === '/api/auth/me') return route.fulfill({ json: { data: user } });
    if (path === '/api/appearance') return route.fulfill({json:{success:true,data:{appearance:DEFAULT_APPEARANCE,company_name:'MERTEL IMPORTACIONES'}}});
    if (path === '/api/admin/whatsapp') return route.fulfill({json:{success:true,data:{settings:{provider:null,connection_status:'NOT_CONFIGURED',rules:[],credentials_configured:false,automations_enabled:false},stage_catalog:[],customers:[],metrics:{}}}});
    if (path === '/api/collection/message-templates') return route.fulfill({json:{success:true,data:{templates:[],stage_catalog:[],variables:[]}}});
    if (path === '/api/admin/dashboard') return route.fulfill({ json: { success: true, data: { period: { reference_date: '2026-10-08', from: '2026-10-01', to: '2026-10-08' },
      overview: { status: 'ok', data: { total_customers: 0, pending_invoices: 0 } }, summary: { status: 'ok', data: { total_balance: '0.00', stages: [], warnings: [] } } } } });
    return route.fulfill({ json: { success: true, data: [] } });
  });
  await page.goto('/'); await expect(page.getByRole('button', { name: 'Activar simulación' })).toBeVisible();
  await expect(page.getByText('IDENTIDAD PRIVADA DE PRUEBA')).toHaveCount(1);
  await page.getByRole('button', { name: 'Activar simulación' }).click();
  await expect(page.getByText('MODO SIMULACIÓN', { exact: true })).toBeVisible();
  await expect(page.getByText('Distribuciones Andinas DEMO S.A.S.', { exact: true }).first()).toBeVisible();
  return { requests, errors, before: requests.length };
}
async function navigate(page, path) {
  // Normal links/history inside the mounted app; no reload of real authentication.
  await page.locator(`a[href="${path}"]`).first().click();
}

test('simulation uses existing management/payment forms, updates fictitious balances and never calls the API', async ({ page }) => {
  const state = await setup(page);
  await expect(page.getByText('IDENTIDAD PRIVADA DE PRUEBA')).toHaveCount(0);
  await navigate(page, '/cobranza');
  const card = page.getByRole('article', { name: 'Cliente Distribuciones Andinas DEMO S.A.S.' }); await card.getByRole('button', { name: 'Gestionar', exact: true }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: 'Pago parcial', exact: true }).click();
  await dialog.getByLabel('Seleccionar factura FV-DEMO-001').check();
  await dialog.getByLabel('Monto recibido').fill('500000'); await dialog.getByLabel('Fecha de pago', { exact: true }).fill('2026-10-08');
  await dialog.getByRole('button', { name: 'Revisar pago', exact: true }).click(); await expect(dialog.getByLabel('Resumen de confirmación del pago')).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirmar pago', exact: true }).click();
  await expect(dialog.getByText(/Pago registrado correctamente/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Cerrar detalle' }).click();
  await navigate(page, '/pagos'); await expect(page.getByText('PAGO-DEMO', { exact: true })).toBeVisible();
  await navigate(page, '/administracion'); await expect(page.getByRole('heading', { name: /CENTRO ADMINISTRATIVO/i })).toBeVisible();
  await expect(page.getByText(/Equipo DEMO ·/).first()).toBeVisible();
  expect(state.requests.slice(state.before)).toEqual([]); expect(state.errors).toEqual([]);
});

for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
  test(`simulation full data source, WhatsApp, resolution, reports, reset and exit ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height }); const state = await setup(page);
    await page.evaluate(() => document.fonts.ready);
    const header = await page.locator('.mertel-header').boundingBox(), main = await page.locator('.mertel-content').boundingBox();
    expect(header.y + header.height).toBeLessThanOrEqual(main.y + 1);
    const exit = await page.getByRole('button', { name: 'Salir de simulación' }).boundingBox();
    expect(exit.y + exit.height).toBeLessThanOrEqual(header.y + header.height);
    await navigate(page, '/administracion/whatsapp'); await expect(page.getByRole('heading', { name: 'Centro de WhatsApp', exact: true })).toBeVisible();
    await page.getByRole('button', {name:'Envío manual',exact:true}).click();
    await page.getByLabel('Cliente', { exact: true }).selectOption('91001');
    await page.getByLabel('Plantilla', { exact: true }).selectOption('96001');
    await expect(page.getByLabel('Vista previa del mensaje').locator('pre')).toContainText('FV-DEMO-001');
    await expect(page.getByLabel('Vista previa del mensaje').locator('pre')).not.toContainText('Mensaje simulado');
    await page.getByRole('button', { name: 'Vista previa', exact: true }).click();
    await page.getByRole('button', { name: 'Enviar mensaje por WhatsApp', exact: true }).click();
    await expect(page.getByText('Mensaje simulado enviado correctamente. No se realizó ningún envío real.', { exact: true })).toBeVisible();
    expect(state.requests.slice(state.before)).toEqual([]); expect(state.errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => { window.scrollTo(0, 0); });
    await page.screenshot({ path: `../tmp/whatsapp-manual-${name}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Mensajes', exact: true }).click();
    await page.getByRole('button', { name: 'Simular envío 97001', exact: true }).click(); await expect(page.locator('tbody tr[data-message-id="97001"]').getByText('Enviado (MOCK)', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Simular entrega 97001', exact: true }).click(); await expect(page.locator('tbody tr[data-message-id="97001"]').getByText('Entregado', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Simular lectura 97001', exact: true }).click(); await expect(page.locator('tbody tr[data-message-id="97001"]').getByText('Leído', { exact: true })).toBeVisible();
    await navigate(page, '/administracion/importar-cartera'); await expect(page.getByText(/Importación simulada · Procesamiento local/)).toBeVisible();
    await expect(page.locator('input[type="file"]')).toBeEnabled();
    await navigate(page, '/administracion/dashboard-cobranza'); await expect(page.getByText('Cartera-ficticia-DEMO.xlsx')).toBeVisible();
    await page.getByRole('link', { name: 'Revisar Cartera-ficticia-DEMO.xlsx' }).click(); await expect(page.getByRole('heading', { name: 'Resolución de clientes' })).toBeVisible();
    await expect(page.getByText('Almacén Ficticio DEMO').first()).toBeVisible();
    await navigate(page, '/reportes'); await expect(page.getByRole('heading', { name: 'Reportes de demostración' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pagos reportados' })).toBeVisible();
    expect(state.requests.slice(state.before)).toEqual([]); expect(state.errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `../tmp/simulation-${name}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Reiniciar simulación' }).click();
    await navigate(page, '/administracion/whatsapp'); await page.getByRole('button', { name: 'Mensajes', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Simular envío 97001', exact: true })).toBeVisible();
    expect(state.requests.slice(state.before)).toEqual([]);
    page.once('dialog', dialog => dialog.dismiss()); await page.getByRole('button', { name: 'Salir de simulación' }).click();
    await expect(page.getByText('MODO SIMULACIÓN', { exact: true })).toBeVisible();
    page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Salir de simulación' }).click();
    await expect(page.getByText('MODO SIMULACIÓN', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => sessionStorage.getItem('mertel_simulation_mode'))).toBeNull();
    await expect(page.getByText('IDENTIDAD PRIVADA DE PRUEBA')).toHaveCount(1);
    expect(state.requests.slice(state.before).some(row => row.path === '/api/auth/refresh')).toBe(true);
    expect(state.errors).toEqual([]);
  });
}
test('reload keeps simulation local without refreshing the real cookie or consulting real data', async ({ page }) => {
  const state = await setup(page); await page.reload(); await expect(page.getByText('MODO SIMULACIÓN', { exact: true })).toBeVisible();
  await expect(page.getByText('Distribuciones Andinas DEMO S.A.S.', { exact: true }).first()).toBeVisible(); expect(state.requests.slice(state.before)).toEqual([]);
});
test('a personal XLSX portfolio loads only in memory, supports simulated payments, and disappears on reload/reset/exit', async ({ page }) => {
  const state = await setup(page);
  const buffer = await makeMertelWorkbook({ rows: [mertelRow({ 'Nombre cliente': 'CLIENTE CARTERA TEMPORAL', Numero: 'FV-TEMP-777', Vence: '01/10/2026', Corriente: '1000000', 'Valor doc.': '1500000' })] });
  async function load() {
    await navigate(page, '/administracion/importar-cartera');
    await page.getByLabel('Archivo CSV o Excel').setInputFiles({ name: 'Mi-cartera.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer });
    await page.getByRole('button', { name: 'Analizar archivo localmente' }).click();
    await expect(page.getByRole('heading', { name: 'Vista previa temporal' })).toBeVisible();
    await page.getByRole('button', { name: 'Cargar cartera temporal' }).click();
    await expect(page.getByRole('heading', { name: 'Cartera temporal activa' })).toBeVisible();
  }
  await load();
  await navigate(page, '/clientes'); await expect(page.getByText('CLIENTE CARTERA TEMPORAL', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Distribuciones Andinas DEMO S.A.S.')).toHaveCount(0);
  await navigate(page, '/cobranza'); const card = page.getByRole('article', { name: 'Cliente CLIENTE CARTERA TEMPORAL' });
  await card.getByRole('button', { name: 'Gestionar', exact: true }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: 'Pago parcial', exact: true }).click();
  await dialog.getByLabel('Seleccionar factura FV-TEMP-777').check(); await dialog.getByLabel('Monto recibido').fill('100000');
  await dialog.getByLabel('Fecha de pago', { exact: true }).fill('2026-10-08');
  await dialog.getByRole('button', { name: 'Revisar pago', exact: true }).click(); await dialog.getByRole('button', { name: 'Confirmar pago', exact: true }).click();
  await expect(dialog.getByText(/Pago registrado correctamente/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Cerrar detalle' }).click();
  await navigate(page, '/facturas'); await expect(page.getByRole('row').filter({ hasText: 'FV-TEMP-777' })).toContainText('900.000');
  await navigate(page, '/'); await expect(page.getByText('CLIENTE CARTERA TEMPORAL', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: '../tmp/simulation-temporary-portfolio.png', fullPage: true });
  expect(await page.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }))).not.toContain('CLIENTE CARTERA TEMPORAL');
  await page.reload(); await expect(page.getByText('MODO SIMULACIÓN', { exact: true })).toBeVisible();
  await expect(page.getByText('CLIENTE CARTERA TEMPORAL')).toHaveCount(0);
  await load(); await page.getByRole('button', { name: 'Reiniciar simulación' }).click();
  await expect(page.getByText('Distribuciones Andinas DEMO S.A.S.', { exact: true }).first()).toBeVisible();
  await load(); expect(state.requests.slice(state.before)).toEqual([]); expect(state.errors).toEqual([]);
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Salir de simulación' }).click();
  await expect(page.getByText('MODO SIMULACIÓN', { exact: true })).toHaveCount(0);
  await expect(page.getByText('CLIENTE CARTERA TEMPORAL')).toHaveCount(0);
});

for (const [name,width,height] of [['desktop',1440,900],['mobile',390,844]]) test(`automatic WhatsApp complete simulated sequence and timeline ${name}`, async ({page}) => {
  test.setTimeout(60000); await page.setViewportSize({width,height}); const state = await setup(page);
  const snapshot = await page.evaluate(async () => {
    const {simulationData} = await import('/src/simulation/store.js'); const data=simulationData();
    const {createSimulationDataset}=await import('/src/simulation/dataset.js');Object.assign(data,createSimulationDataset('2026-10-08'));
    return { invoice: data.invoices.find(row=>row.customer_id==='91003'), rules:data.configuration, finances:JSON.stringify({customers:data.customers,invoices:data.invoices,payments:data.payments,allocations:data.allocations,configuration:data.configuration}) };
  });
  await navigate(page,'/administracion/whatsapp'); await page.getByRole('button',{name:'Automatizaciones',exact:true}).click();
  for(const step of MERTEL_CONTACTS){
    const form=page.locator('form').filter({has:page.getByRole('heading',{name:step.label,exact:true})});
    await form.getByLabel(`Plantilla de ${step.label}`,{exact:true}).selectOption({label:step.template_name});
    await form.getByLabel(`Hora inicial de ${step.label}`).fill('08:00'); await form.getByLabel(`Hora final de ${step.label}`).fill('18:00');
    await form.getByLabel(`Límite diario de ${step.label}`).fill('100'); await form.getByLabel(`Intervalo técnico existente (horas) de ${step.label}`).fill('1');
    for(const day of ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado']) await form.getByLabel(day,{exact:true}).check();
    await form.getByLabel(`Habilitar ${step.label}`).check(); await form.getByRole('button',{name:`Guardar regla de ${step.label}`}).click();
    await expect(page.getByText(`Regla de ${step.label} guardada.`,{exact:true})).toBeVisible();
  }
  await page.getByRole('button',{name:'Activar automatización MOCK'}).click();
  await expect(page.getByText('Automatización activada en MOCK.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Timeline',exact:true}).click(); await page.getByLabel('Cliente de la timeline').selectOption('91003');
  await expect(page.getByRole('heading',{name:'Moto Partes Aurora DEMO'})).toBeVisible();
  for(const step of contactDates(snapshot.invoice,snapshot.rules)){
    await page.getByLabel('Fecha de demostración').fill(step.date);
    await page.getByRole('button',{name:'Simular evaluación del día'}).click();
    const card=page.locator('.wa-timeline li').filter({has:page.getByRole('heading',{name:step.label,exact:true})});
    await expect(card.getByText('ENVIADO',{exact:true})).toBeVisible();
  }
  const after=await page.evaluate(async()=>{const {simulationData}=await import('/src/simulation/store.js');const data=simulationData();return {finances:JSON.stringify({customers:data.customers,invoices:data.invoices,payments:data.payments,allocations:data.allocations,configuration:data.configuration}),messages:data.messages.filter(row=>row.customer_id==='91003'&&row.message_mode==='AUTOMATICO')};});
  expect(after.finances).toBe(snapshot.finances);expect(after.messages).toHaveLength(4);expect(state.requests.slice(state.before)).toEqual([]);expect(state.errors).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`../tmp/whatsapp-automatic-${name}.png`,fullPage:true});
});
