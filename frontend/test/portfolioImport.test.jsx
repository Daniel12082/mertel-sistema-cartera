import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthContext } from "../src/auth/auth.context";
import PortfolioImport from "../src/pages/Administracion/PortfolioImport";
import { analyzePortfolioFile, getPortfolioImportCompanies, getPortfolioImports } from "../src/services/portfolioImport.service";

vi.mock("../src/services/portfolioImport.service", () => ({ analyzePortfolioFile: vi.fn(), getPortfolioImportCompanies: vi.fn(), getPortfolioImports: vi.fn() }));
const result = { batch_id: "9", status: "analyzed_unconfigured", duplicate: false, format_configured: false,
  file: { name: "fixture.csv", size_bytes: 18, sha256: "f".repeat(64) }, headers: ["Campo A", "Campo B"], total_rows: 1, empty_rows: 0,
  successful_rows: 1, failed_rows: 0, preview: [["valor 1", "valor 2"]], issues: [] };
function view({ permissions = ["portfolio.import"], user = { id: "1", is_global_admin: false } } = {}) {
  return render(<AuthContext.Provider value={{ user, permissions }}><PortfolioImport /></AuthContext.Provider>);
}
beforeEach(() => { vi.clearAllMocks(); getPortfolioImports.mockResolvedValue([]); getPortfolioImportCompanies.mockResolvedValue([{ id: "1", name: "Fixture", status: "active" }]); analyzePortfolioFile.mockResolvedValue(result); });

describe("Fase 5.3 portfolio import screen", () => {
  it("selects a CSV, previews detected headers and clearly states that the business format is unconfigured", async () => {
    const user = userEvent.setup(); view();
    const file = new File(["Campo A,Campo B\nvalor 1,valor 2\n"], "fixture.csv", { type: "text/csv" });
    await user.upload(screen.getByLabelText("Archivo CSV"), file);
    await user.click(screen.getByRole("button", { name: "Analizar archivo" }));
    expect(await screen.findByRole("heading", { name: "Resultado del análisis" })).toBeVisible();
    expect(screen.getByText(/El archivo fue analizado correctamente, pero el formato de cartera de MERTEL aún no está configurado/)).toBeVisible();
    expect(screen.getByRole("table")).toHaveTextContent("Campo A"); expect(screen.getByRole("table")).toHaveTextContent("valor 2");
    expect(screen.queryByRole("button", { name: /importar/i })).not.toBeInTheDocument();
    expect(analyzePortfolioFile).toHaveBeenCalledWith(file, { companyId: undefined });
  });
  it("shows the role denial and does not request history for an unauthorized user", () => {
    view({ permissions: ["collection.view"] });
    expect(screen.getByRole("alert")).toHaveTextContent("No tienes permiso"); expect(getPortfolioImports).not.toHaveBeenCalled();
  });
  it("requires an explicit company for global admins before making requests", async () => {
    const user = userEvent.setup(); view({ user: { id: "2", is_global_admin: true }, permissions: ["portfolio.import"] });
    const select = await screen.findByRole("combobox", { name: "Empresa" });
    expect(select).toHaveValue(""); expect(getPortfolioImports).not.toHaveBeenCalled();
    await user.selectOptions(select, "1");
    await waitFor(() => expect(getPortfolioImports).toHaveBeenCalledWith(expect.objectContaining({ companyId: "1", signal: expect.any(AbortSignal) })));
    expect(getPortfolioImportCompanies).toHaveBeenCalledOnce();
  });
  it("blocks oversize files in the browser without calling the backend", async () => {
    const user = userEvent.setup(); view();
    const file = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "large.csv", { type: "text/csv" });
    await user.upload(screen.getByLabelText("Archivo CSV"), file); await user.click(screen.getByRole("button", { name: "Analizar archivo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("supera el límite de 2 MiB"); expect(analyzePortfolioFile).not.toHaveBeenCalled();
  });
});
