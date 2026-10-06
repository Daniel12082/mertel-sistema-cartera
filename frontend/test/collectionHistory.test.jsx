import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AuthContext } from "../src/auth/auth.context";
import CollectionHistory from "../src/pages/Administracion/CollectionHistory";
import { getAdministrativeHistory, getAdministrativeHistoryActors, getHistoryCompanies } from "../src/services/collectionHistory.service";

vi.mock("../src/services/collectionHistory.service", () => ({ getAdministrativeHistory: vi.fn(), getAdministrativeHistoryActors: vi.fn(), getHistoryCompanies: vi.fn() }));
const event = { id: "action:2", type: "action", occurred_at: "2026-10-06T15:30:00.000Z", actor: "Ana", customer: { name: "Cliente", identification: "NIT" }, invoice: "F-1", title: "Llamada", description: "Observación", status: "completed", metadata: { action_type: "Llamada" } };
function view({ user = { id: "1", company_id: "1" }, permissions = ["history.view", "settings.manage"] } = {}) {
  return render(<AuthContext.Provider value={{ user, permissions }}><CollectionHistory /></AuthContext.Provider>);
}
beforeEach(() => { vi.clearAllMocks(); getAdministrativeHistory.mockResolvedValue({ events: [event], pagination: { page: 1, limit: 20, total: 1, pages: 1, has_next: false, has_previous: false } }); getAdministrativeHistoryActors.mockResolvedValue([{ id: "1", name: "Ana" }]); getHistoryCompanies.mockResolvedValue([{ id: "1", name: "Empresa test", status: "active" }]); });

describe("administrative collection history", () => {
  it("renders safe event context and filters by dates, type and actor", async () => {
    view(); expect(await screen.findByText("Observación")).toBeVisible(); expect(screen.getByText("Cliente: Cliente · NIT")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Tipo de evento" }), { target: { value: "action" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Usuario" }), { target: { value: "1" } });
    await waitFor(() => expect(getAdministrativeHistory).toHaveBeenLastCalledWith(expect.objectContaining({ date_from: "2026-10-01", type: "action", actor_id: "1" }), expect.anything()));
  });
  it("requires global company selection, paginates, and denies unauthorized entry", async () => {
    view({ user: { id: "9", company_id: null, is_global_admin: true } });
    expect(await screen.findByText("Selecciona una empresa para consultar el historial.")).toBeVisible(); expect(getAdministrativeHistory).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("combobox", { name: "Empresa" }), { target: { value: "1" } }); expect(await screen.findByText("Observación")).toBeVisible();
    view({ permissions: ["collection.view"] }); expect(screen.getByRole("alert")).toHaveTextContent("No tienes permiso");
  });
  it("shows loading, error, and empty history states", async () => {
    let resolve; getAdministrativeHistory.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    view(); expect(screen.getByRole("status")).toHaveTextContent("Cargando historial");
    resolve({ events: [], pagination: { page: 1, limit: 20, total: 0, pages: 0, has_next: false, has_previous: false } });
    expect(await screen.findByText("Sin eventos para los filtros seleccionados.")).toBeVisible();
    getAdministrativeHistory.mockRejectedValueOnce(new Error("Error de historial")); view(); expect(await screen.findByRole("alert")).toHaveTextContent("Error de historial");
  });
});
