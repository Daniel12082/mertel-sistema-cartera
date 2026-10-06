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
    if (url.pathname === "/api/admin/portfolio/imports/analyze") {
      const isXlsx = url.searchParams.get("file_name")?.endsWith(".xlsx");
      return route.fulfill({ json: { success: true, data: isXlsx ? {
        batch_id: "2", status: "analyzed_unconfigured", duplicate: false, format_configured: true,
        file: { name: "cartera al 06-10.xlsx", size_bytes: 955390, sha256: "b".repeat(64) }, format: "mertel_xlsx",
        report: { company_name: "MERTEL IMPORTACIONES S.A.S.", company_nit: "900.499.744-8", report_date: "2026-10-06" },
        selected_sheet: "cartera de clientes NIIF0", sheet_names: ["cartera de clientes NIIF0", "Hoja1"],
        headers: ["Nit Cliente", "Numero", "Movimiento"], total_rows: 4121, empty_rows: 970, successful_rows: 3151, failed_rows: 0,
        classifications: { document_rows: 2177, customer_summary_rows: 968, report_summary_rows: 6, summary_rows: 974, empty_rows: 970, invalid_rows: 0 },
        summary: { clients_detected: 961, unique_documents: 2177, invoices: 1827, returns: 347, debit_notes: 3, unknown_movements: 0 },
        preview: [{ row_number: 8, type: "DOCUMENT", customer_nit_original: "800.001.269-0", document_number: "ME-74743",
          movement: "012 Factura de venta credito", issue_date: "2026-09-23", due_date: "2026-11-08", document_value: 3482310, iva: 567932, cupo_amount: 10000000, cupo_condition: "compartido" }], issues: [],
      } : {
        batch_id: "1", status: "analyzed_unconfigured", duplicate: false, format_configured: false,
        file: { name: "fixture.csv", size_bytes: 20, sha256: "a".repeat(64) }, headers: ["Columna uno", "Columna dos"], total_rows: 1, empty_rows: 0,
        successful_rows: 1, failed_rows: 0, preview: [["A", "B"]], issues: [],
      } } });
    }
    if (url.pathname === "/api/admin/portfolio/imports/reconcile" && request.method() === "POST") return route.fulfill({ json: { success: true, data: {
      summary: { total: 2, new: 1, updated: 1, unchanged: 0, disappeared: 0, returns: 0, debitNotes: 0, duplicates: 0, errors: 0 },
      results: [
        { category: "UPDATED", categoryLabel: "Actualizado", customer: { nit: "8000012690", name: "Cliente MERTEL" }, document: { number: "ME-74743", movement: "012 Factura de venta credito" }, sourceRow: 8, differences: [{ field: "dueDate", label: "Fecha de vencimiento", databaseValue: "2026-11-08", fileValue: "2026-11-10" }] },
        { category: "NEW", categoryLabel: "Nuevo", customer: { nit: "8000012690", name: "Cliente MERTEL" }, document: { number: "ME-NUEVA", movement: "012 Factura de venta credito", issueDate: "2026-10-01", value: 100, iva: 19 }, sourceRow: 9, differences: [] },
      ], metadata: { readOnly: true },
    } } });
    if (url.pathname === "/api/admin/portfolio/imports/pipeline" && request.method() === "POST") return route.fulfill({ json: { success: true, data: {
      source: { file_name: "cartera al 06-10.xlsx", reference_date: url.searchParams.get("reference_date"), processed_at: "2026-10-06T12:00:00Z" },
      summary: { customers: 1, documents: 1, overdue: 1, due_today: 0, due_in_five_days: 0, prompt_payment: 0, unclassified: 0, errors: 0 },
      stage_catalog: [{ key: "overdue", label: "En mora", category: "overdue" }], configuration_warnings: [], errors: [],
      pipeline: [{ customer: { id: "xlsx:8000012690", nit: "800.001.269-0", name: "CLIENTE MERTEL", phone: "6011234567" }, source_details: { nit: "800.001.269-0", name: "CLIENTE MERTEL", collector: "COBRADOR", seller: "VENDEDOR", city: "BOGOTÁ", zone: "NORTE", mobile: "3000000000" }, stage: "overdue", stage_label: "En mora", priority: 4, reason: "Factura vencida con saldo pendiente.", total_balance: "250.00", main_invoice: { invoice: { invoice_number: "ME-74743", issue_date: "2026-09-01", due_date: "2026-10-01", source_row: 8 }, days_until_due: -5 }, invoices: [], documents: [{ source_row: 8, document_number: "ME-74743", movement: "012 Factura de venta credito", movement_type: "invoice", issue_date: "2026-09-01", due_date: "2026-10-01", document_value: 300, iva: 50, balance: "250.00", stage_label: "En mora", eligible: true, observations: "Nota de prueba" }] }],
      metadata: { read_only: true, persisted: false, balance_source: "Suma de buckets de antigüedad por factura" },
    } } });
    return route.fulfill({ status: 404, json: { success: false } });
  });
  return calls;
}

for (const width of [1440, 390, 320]) test(`admin analyzes CSV without application or horizontal overflow at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); const calls = await setup(page);
  await page.goto("/administracion/importar-cartera");
  await expect(page.getByRole("heading", { name: "Importar cartera" })).toBeVisible();
  await page.getByLabel("Archivo CSV o Excel").setInputFiles({ name: "fixture.csv", mimeType: "text/csv", buffer: Buffer.from("A,B\nA,B\n") });
  await page.getByRole("button", { name: "Analizar archivo" }).click();
  await expect(page.getByText(/Análisis y previsualización solamente/)).toBeVisible();
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

test("global admin resolves MERTEL before requesting import history", async ({ page }) => {
  const calls = await setup(page, { globalAdmin: true }); await page.goto("/administracion/importar-cartera");
  await expect(page.getByLabel("Archivo CSV o Excel")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Empresa" })).toHaveCount(0);
  expect(calls.some(call => call.path === "/api/admin/portfolio/imports" && !Object.hasOwn(call.params, "company_id"))).toBe(true);
});

test("admin previews the real MERTEL XLSX structure without applying data", async ({ page }) => {
  const calls = await setup(page); await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/administracion/importar-cartera");
  await page.getByLabel("Archivo CSV o Excel").setInputFiles({ name: "cartera al 06-10.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from([0x50, 0x4b, 3, 4]) });
  await page.getByRole("button", { name: "Analizar archivo" }).click();
  await expect(page.getByText("MERTEL IMPORTACIONES S.A.S.")).toBeVisible();
  await expect(page.getByText("cartera de clientes NIIF0")).toBeVisible();
  await expect(page.getByRole("table")).toContainText("ME-74743");
  await expect(page.getByText(/Formato de análisis MERTEL reconocido/)).toBeVisible();
  expect(calls.some(call => call.method === "POST" && call.path.endsWith("/analyze") && call.contentType.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))).toBe(true);
  await expect(page.getByRole("button", { name: /aplicar|importar/i })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("E2E XLSX analyze to read-only reconciliation, summary, filtering and detail", async ({ page }) => {
  const calls = await setup(page); await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/administracion/importar-cartera");
  await page.getByLabel("Archivo CSV o Excel").setInputFiles({ name: "cartera al 06-10.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from([0x50, 0x4b, 3, 4]) });
  await page.getByRole("button", { name: "Analizar archivo" }).click();
  await page.getByRole("button", { name: "Conciliar contra la base de datos" }).click();
  await expect(page.getByRole("heading", { name: "Conciliación de cartera" })).toBeVisible();
  await expect(page.locator(".portfolio-reconcile-summary span").filter({ hasText: "Actualizados" })).toContainText("1");
  await page.getByLabel("Filtrar por categoría").selectOption("UPDATED");
  await page.getByRole("button", { name: /Actualizado/ }).click();
  await expect(page.getByRole("region", { name: "Detalle de conciliación" })).toContainText("2026-11-10");
  expect(calls.some(call => call.method === "POST" && call.path.endsWith("/reconcile") && call.contentType.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))).toBe(true);
  await expect(page.getByRole("button", { name: /aplicar cambios/i })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("E2E XLSX to temporary collection pipeline, filters and customer documents", async ({ page }) => {
  const calls = await setup(page); await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/administracion/importar-cartera");
  await page.getByLabel("Archivo CSV o Excel").setInputFiles({ name: "cartera al 06-10.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from([0x50, 0x4b, 3, 4]) });
  await page.getByRole("button", { name: "Analizar archivo" }).click();
  await page.getByLabel("Fecha de referencia del pipeline").fill("2026-10-06");
  await page.getByRole("button", { name: "Generar Pipeline" }).click();
  await expect(page.getByRole("heading", { name: "Pipeline de cartera importada" })).toBeVisible();
  await expect(page.getByText("Fuente: archivo de cartera MERTEL", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Resumen del pipeline importado")).toContainText("En mora");
  await page.getByLabel("Filtrar etapa").selectOption("overdue");
  await page.getByRole("button", { name: /Ver cliente y documentos/ }).click();
  await expect(page.getByRole("dialog")).toContainText("ME-74743");
  await expect(page.getByRole("dialog")).toContainText("CLIENTE MERTEL");
  expect(calls.some(call => call.method === "POST" && call.path.endsWith("/pipeline") && call.params.reference_date === "2026-10-06")).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
