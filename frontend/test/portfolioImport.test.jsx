import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthContext } from "../src/auth/auth.context";
import PortfolioImport from "../src/pages/Administracion/PortfolioImport";
import { analyzePortfolioFile, getPortfolioImports } from "../src/services/portfolioImport.service";

vi.mock("../src/services/portfolioImport.service", () => ({ analyzePortfolioFile: vi.fn(), getPortfolioImports: vi.fn() }));
const result = { batch_id: "9", status: "analyzed_unconfigured", duplicate: false, format_configured: false,
  file: { name: "fixture.csv", size_bytes: 18, sha256: "f".repeat(64) }, headers: ["Campo A", "Campo B"], total_rows: 1, empty_rows: 0,
  successful_rows: 1, failed_rows: 0, preview: [["valor 1", "valor 2"]], issues: [] };
function view({ permissions = ["portfolio.import"], user = { id: "1", is_global_admin: false } } = {}) {
  return render(<AuthContext.Provider value={{ user, permissions }}><PortfolioImport /></AuthContext.Provider>);
}
beforeEach(() => { vi.clearAllMocks(); getPortfolioImports.mockResolvedValue([]); analyzePortfolioFile.mockResolvedValue(result); });

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
});
