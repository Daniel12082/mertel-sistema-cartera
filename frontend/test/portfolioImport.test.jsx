import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthContext } from "../src/auth/auth.context";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import PortfolioImport from "../src/pages/Administracion/PortfolioImport";
import { analyzePortfolioFile, generatePortfolioPipeline, getPortfolioImports, reconcilePortfolioFile } from "../src/services/portfolioImport.service";

vi.mock("../src/services/portfolioImport.service", () => ({ analyzePortfolioFile: vi.fn(), generatePortfolioPipeline: vi.fn(), getPortfolioImports: vi.fn(), reconcilePortfolioFile: vi.fn() }));
const result = { batch_id: "9", status: "analyzed_unconfigured", duplicate: false, format_configured: false,
  file: { name: "fixture.csv", size_bytes: 18, sha256: "f".repeat(64) }, headers: ["Campo A", "Campo B"], total_rows: 1, empty_rows: 0,
  successful_rows: 1, failed_rows: 0, preview: [["valor 1", "valor 2"]], issues: [] };
function Destination() { const location = useLocation(); return <div data-testid="destination">{location.state?.portfolioPipeline?.source?.file_name}</div>; }
function view({ permissions = ["portfolio.import"], user = { id: "1", is_global_admin: false } } = {}) {
  return render(<AuthContext.Provider value={{ user, permissions }}><MemoryRouter initialEntries={["/importar"]}><Routes><Route path="/importar" element={<PortfolioImport />} /><Route path="/cobranza" element={<Destination />} /></Routes></MemoryRouter></AuthContext.Provider>);
}
const reconciliationFixture = { summary: { total: 4, new: 1, updated: 1, unchanged: 0, disappeared: 1, returns: 0, debitNotes: 0, duplicates: 0, errors: 1 }, results: [
  { category: "UPDATED", categoryLabel: "Actualizado", customer: { nit: "8000012690", name: "ABC" }, document: { number: "ME-1", movement: "012 Factura de venta credito" }, sourceRow: 8, differences: [{ field: "dueDate", label: "Fecha de vencimiento", databaseValue: "2026-10-01", fileValue: "2026-10-02" }] },
  { category: "NEW", categoryLabel: "Nuevo", customer: { nit: "8000012690", name: "ABC" }, document: { number: "ME-2", movement: "012 Factura de venta credito", issueDate: "2026-09-01", value: 100, iva: 19, seller: "Vendedor", collector: "Cobrador", zone: "Norte" }, sourceRow: 9, differences: [] },
  { category: "DISAPPEARED", categoryLabel: "No aparece en archivo", customer: { nit: "8000012690", name: "ABC" }, document: { number: "ME-3", issueDate: "2026-09-01", dueDate: "2026-10-01", balance: 70, status: "pending" }, database: { document: { balance: 70, status: "pending" } }, differences: [], reason: "No aparece en el archivo actual" },
  { category: "ERROR", categoryLabel: "Error", customer: { nit: "" }, document: { number: "ME-4" }, sourceRow: 10, differences: [], reason: "NIT vacío" },
], metadata: { readOnly: true } };
beforeEach(() => { vi.clearAllMocks(); getPortfolioImports.mockResolvedValue([]); analyzePortfolioFile.mockResolvedValue(result); reconcilePortfolioFile.mockResolvedValue(reconciliationFixture); generatePortfolioPipeline.mockResolvedValue({ source: { file_name: "cartera.xlsx" }, summary: { customers: 1 } }); });

describe("Fase 5.3 portfolio import screen", () => {
  it("selects a CSV, previews detected headers and clearly states that the business format is unconfigured", async () => {
    const user = userEvent.setup(); view();
    const file = new File(["Campo A,Campo B\nvalor 1,valor 2\n"], "fixture.csv", { type: "text/csv" });
    await user.upload(screen.getByLabelText("Archivo CSV o Excel"), file);
    await user.click(screen.getByRole("button", { name: "Analizar archivo" }));
    expect(await screen.findByRole("heading", { name: "Resultado del análisis" })).toBeVisible();
    expect(screen.getByText(/Análisis y previsualización solamente/)).toBeVisible();
    expect(screen.getByRole("table")).toHaveTextContent("Campo A"); expect(screen.getByRole("table")).toHaveTextContent("valor 2");
    expect(screen.queryByRole("button", { name: /importar/i })).not.toBeInTheDocument();
    expect(analyzePortfolioFile).toHaveBeenCalledWith(file);
  });
  it("shows the role denial and does not request history for an unauthorized user", () => {
    view({ permissions: ["collection.view"] });
    expect(screen.getByRole("alert")).toHaveTextContent("No tienes permiso"); expect(getPortfolioImports).not.toHaveBeenCalled();
  });
  it("accepts the MERTEL workbook and presents classified data without an apply action", async () => {
    const user = userEvent.setup();
    analyzePortfolioFile.mockResolvedValue({ ...result, format: "mertel_xlsx", format_configured: true,
      file: { ...result.file, name: "cartera al 06-10.xlsx" }, selected_sheet: "cartera de clientes NIIF0",
      report: { company_name: "MERTEL IMPORTACIONES S.A.S.", company_nit: "900.499.744-8", report_date: "2026-10-06" },
      summary: { clients_detected: 961, unique_documents: 2177, invoices: 1827, returns: 347, debit_notes: 3, unknown_movements: 0 },
      classifications: { document_rows: 2177, customer_summary_rows: 968, report_summary_rows: 6 },
      preview: [{ row_number: 8, type: "DOCUMENT", customer_nit_original: "800.001.269-0", document_number: "ME-74743",
        movement: "012 Factura de venta credito", issue_date: "2026-09-23", due_date: "2026-11-08", document_value: 3482310, iva: 567932, cupo_amount: 10000000, cupo_condition: "compartido" }],
    });
    view();
    const file = new File([new Uint8Array([80, 75, 3, 4])], "cartera al 06-10.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    await user.upload(screen.getByLabelText("Archivo CSV o Excel"), file);
    await user.click(screen.getByRole("button", { name: "Analizar archivo" }));
    expect(await screen.findByText("MERTEL IMPORTACIONES S.A.S.")).toBeVisible();
    expect(screen.getByText("cartera de clientes NIIF0")).toBeVisible();
    expect(screen.getByText("2177")).toBeVisible(); expect(screen.getByText("Devoluciones")).toBeVisible();
    expect(screen.getByRole("table")).toHaveTextContent("ME-74743");
    expect(screen.getByText(/Formato de análisis MERTEL reconocido/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /aplicar|importar/i })).not.toBeInTheDocument();
  });
  it("shows an in-memory preview and warns when incomplete import tables prevent history persistence", async () => {
    const user = userEvent.setup();
    analyzePortfolioFile.mockResolvedValue({ ...result, format: "mertel_xlsx", format_configured: true,
      file: { ...result.file, name: "cartera al 06-10.xlsx" }, persistence: { saved: false, message: "El esquema del historial de importaciones requiere revisión." },
      report: { company_name: "MERTEL IMPORTACIONES S.A.S.", company_nit: "900.499.744-8", report_date: "2026-10-06" },
      summary: { clients_detected: 1, unique_documents: 1, invoices: 1, returns: 0, debit_notes: 0, unknown_movements: 0 },
      classifications: { customer_summary_rows: 0, report_summary_rows: 0 },
      preview: [{ row_number: 8, type: "DOCUMENT", customer_nit_original: "800.001.269-0", document_number: "ME-12345", movement: "012 Factura de venta credito", issue_date: "2026-10-06", due_date: "2026-11-21", document_value: 100, iva: 19, cupo_amount: 10, cupo_condition: "compartido" }],
    });
    view();
    await user.upload(screen.getByLabelText("Archivo CSV o Excel"), new File(["x"], "cartera.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    await user.click(screen.getByRole("button", { name: "Analizar archivo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("previsualización");
    expect(screen.getByRole("table")).toHaveTextContent("ME-12345");
  });
  it("resolves MERTEL automatically for global admins", async () => {
    view({ user: { id: "2", is_global_admin: true }, permissions: ["portfolio.import"] });
    await waitFor(() => expect(getPortfolioImports).toHaveBeenCalledWith(expect.objectContaining({ signal: expect.any(AbortSignal) })));
    expect(screen.queryByRole("combobox", { name: "Empresa" })).not.toBeInTheDocument();
  });
  it("blocks oversize files in the browser without calling the backend", async () => {
    const user = userEvent.setup(); view();
    const file = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "large.csv", { type: "text/csv" });
    await user.upload(screen.getByLabelText("Archivo CSV o Excel"), file); await user.click(screen.getByRole("button", { name: "Analizar archivo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("supera el límite de 2 MiB"); expect(analyzePortfolioFile).not.toHaveBeenCalled();
  });
  it("reconciles an XLSX and shows summary, category filters, UPDATED/NEW/DISAPPEARED details and errors", async () => {
    const user = userEvent.setup();
    analyzePortfolioFile.mockResolvedValue({ ...result, format: "mertel_xlsx", format_configured: true, file: { ...result.file, name: "cartera.xlsx" }, report: {}, summary: { clients_detected: 1, unique_documents: 1, invoices: 1, returns: 0, debit_notes: 0, unknown_movements: 0 }, classifications: { customer_summary_rows: 0, report_summary_rows: 0 }, preview: [{ row_number: 8, type: "DOCUMENT", customer_nit_original: "8000012690", document_number: "ME-1", movement: "012 Factura de venta credito" }] });
    view(); await user.upload(screen.getByLabelText("Archivo CSV o Excel"), new File([new Uint8Array([80, 75, 3, 4])], "cartera.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    await user.click(screen.getByRole("button", { name: "Analizar archivo" }));
    await user.click(await screen.findByRole("button", { name: "Conciliar contra la base de datos" }));
    expect(await screen.findByRole("heading", { name: "Conciliación de cartera" })).toBeVisible();
    expect(document.querySelector(".portfolio-reconcile-summary span")).toHaveTextContent("Total4");
    expect([...document.querySelectorAll(".portfolio-reconcile-summary span")].find(card => card.textContent.includes("Actualizados"))).toHaveTextContent("1");
    await user.click(screen.getByRole("button", { name: /Actualizado/ }));
    expect(screen.getByRole("region", { name: "Detalle de conciliación" })).toHaveTextContent("2026-10-02");
    await user.selectOptions(screen.getByLabelText("Filtrar por categoría"), "NEW");
    await user.click(screen.getByRole("button", { name: /Nuevo/ }));
    expect(screen.getByRole("region", { name: "Detalle de conciliación" })).toHaveTextContent("Cobrador");
    await user.selectOptions(screen.getByLabelText("Filtrar por categoría"), "DISAPPEARED");
    await user.click(screen.getByRole("button", { name: /No aparece en archivo/ }));
    expect(screen.getByRole("region", { name: "Detalle de conciliación" })).toHaveTextContent("No aparece en el archivo actual");
    await user.selectOptions(screen.getByLabelText("Filtrar por categoría"), "ERROR");
    await user.click(screen.getByRole("button", { name: /Error/ }));
    expect(screen.getByRole("region", { name: "Detalle de conciliación" })).toHaveTextContent("Motivo: NIT vacío");
    expect(reconcilePortfolioFile).toHaveBeenCalledWith(expect.any(File));
    expect(screen.queryByRole("button", { name: /aplicar cambios/i })).not.toBeInTheDocument();
  });
  it("generates an XLSX pipeline with explicit date and navigates with temporary file results", async () => {
    const user = userEvent.setup();
    analyzePortfolioFile.mockResolvedValue({ ...result, format: "mertel_xlsx", format_configured: true, file: { ...result.file, name: "cartera.xlsx" }, report: {}, summary: { clients_detected: 1, unique_documents: 1, invoices: 1, returns: 0, debit_notes: 0, unknown_movements: 0 }, classifications: { customer_summary_rows: 0, report_summary_rows: 0 }, preview: [] });
    view(); const file = new File([new Uint8Array([80, 75, 3, 4])], "cartera.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    await user.upload(screen.getByLabelText("Archivo CSV o Excel"), file); await user.click(screen.getByRole("button", { name: "Analizar archivo" }));
    const date = screen.getByLabelText("Fecha de referencia del pipeline"); await user.clear(date); await user.type(date, "2026-10-06");
    await user.click(await screen.findByRole("button", { name: "Generar Pipeline" }));
    expect(await screen.findByTestId("destination")).toHaveTextContent("cartera.xlsx");
    expect(generatePortfolioPipeline).toHaveBeenCalledWith(file, "2026-10-06");
  });
});
