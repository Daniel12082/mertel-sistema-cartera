import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AuthContext } from "../src/auth/auth.context";
import CollectionDashboard from "../src/pages/Administracion/CollectionDashboard";
import { getCollectionDashboard, getDashboardCompanies } from "../src/services/collectionDashboard.service";

vi.mock("../src/services/collectionDashboard.service", () => ({ getCollectionDashboard: vi.fn(), getDashboardCompanies: vi.fn() }));
const data = { reference_date: "2026-10-06", portfolio: { total_balance: "120.00", customers_in_collection: 1 },
  stages: [{ key: "overdue", label: "En mora", customers: 1, balance: "120.00" }],
  promises: { pending_count: 1, pending_amount: "30.00" }, activity: { activity_from: "2026-09-30", activity_to: "2026-10-06", actions_period: 4 },
  warnings: ["Reglas pendientes"], collection_status: "ready" };
function view({ permissions = ["collection.view", "settings.manage"], user = { id: "1", company_id: "1" } } = {}) {
  return render(<AuthContext.Provider value={{ user, permissions }}><CollectionDashboard /></AuthContext.Provider>);
}
beforeEach(() => { vi.clearAllMocks(); getCollectionDashboard.mockResolvedValue(data); getDashboardCompanies.mockResolvedValue([{ id: "1", name: "Empresa test", status: "active" }]); });

describe("5.5 dashboard operativo de cobranza", () => {
  it("renders portfolio, stage, promise, activity and configuration warning metrics", async () => {
    view();
    expect(await screen.findByRole("heading", { name: "Dashboard de cobranza" })).toBeVisible();
    expect(await screen.findByText("Clientes en cobranza")).toBeVisible();
    expect(screen.getByText("En mora")).toBeVisible(); expect(screen.getByText("Reglas pendientes")).toBeVisible();
    expect(screen.getByText("06/10/2026")).toBeVisible();
  });
  it("keeps reference date and activity period as independent request parameters", async () => {
    view(); await screen.findByText("Clientes en cobranza");
    fireEvent.change(screen.getByLabelText("Fecha de referencia de cartera"), { target: { value: "2026-09-01" } });
    await waitFor(() => expect(getCollectionDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ reference_date: "2026-09-01" }), expect.anything()));
    fireEvent.change(screen.getByRole("combobox", { name: "Período de actividad" }), { target: { value: "30" } });
    await waitFor(() => expect(getCollectionDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ activity_to: expect.any(String) }), expect.anything()));
  });
  it("requires a company for global administrators, shows empty company state and blocks unauthorized users", async () => {
    view({ user: { id: "2", company_id: null, is_global_admin: true } });
    expect(await screen.findByText("Selecciona una empresa para consultar sus datos.")).toBeVisible();
    expect(getCollectionDashboard).not.toHaveBeenCalled();
    view({ permissions: ["collection.view"] }); expect(screen.getByRole("alert")).toHaveTextContent("No tienes permiso");
  });
  it("shows loading, errors and empty-stage data without retaining old values", async () => {
    let resolve; getCollectionDashboard.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    view(); expect(screen.getByRole("status")).toHaveTextContent("Cargando dashboard");
    resolve({ ...data, portfolio: { total_balance: "0.00", customers_in_collection: 0 }, stages: [], promises: { pending_count: 0, pending_amount: "0.00" }, activity: { ...data.activity, actions_period: 0 }, warnings: [] });
    expect(await screen.findByText(/Sin datos de cartera/)).toBeVisible();
    getCollectionDashboard.mockRejectedValueOnce(new Error("Error de dashboard")); view(); expect(await screen.findByRole("alert")).toHaveTextContent("Error de dashboard");
  });
});
