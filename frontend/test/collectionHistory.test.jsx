import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AuthContext } from "../src/auth/auth.context";
import CollectionHistory from "../src/pages/Administracion/CollectionHistory";
import { getAdministrativeHistory, getAdministrativeHistoryActors } from "../src/services/collectionHistory.service";

vi.mock("../src/services/collectionHistory.service", () => ({ getAdministrativeHistory: vi.fn(), getAdministrativeHistoryActors: vi.fn() }));
const event = { id: "action:2", type: "action", occurred_at: "2026-10-06T15:30:00.000Z", actor: "Ana", customer: { name: "Cliente", identification: "NIT" }, invoice: "F-1", title: "Llamada", description: "Observación", status: "completed", metadata: { action_type: "Llamada" } };
function view({ user = { id: "1", company_id: "1" }, permissions = ["history.view", "settings.manage"] } = {}) {
  return render(<AuthContext.Provider value={{ user, permissions }}><CollectionHistory /></AuthContext.Provider>);
}
beforeEach(() => { vi.clearAllMocks(); getAdministrativeHistory.mockResolvedValue({ events: [event], pagination: { page: 1, limit: 20, total: 1, pages: 1, has_next: false, has_previous: false } }); getAdministrativeHistoryActors.mockResolvedValue([{ id: "1", name: "Ana" }]); });

describe("administrative collection history", () => {
  it("omits empty filters and preserves independent date bounds, ranges and other filters", async () => {
    view(); await screen.findByText("Observación");
    expect(getAdministrativeHistory).toHaveBeenLastCalledWith({ type: "all", page: 1, limit: 20 }, expect.anything());
    fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-10-07" } });
    await waitFor(() => expect(getAdministrativeHistory).toHaveBeenLastCalledWith({ type: "all", date_to: "2026-10-07", page: 1, limit: 20 }, expect.anything()));
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-10-01" } });
    await waitFor(() => expect(getAdministrativeHistory).toHaveBeenLastCalledWith(expect.objectContaining({ date_from: "2026-10-01", date_to: "2026-10-07" }), expect.anything()));
    fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Tipo de evento"), { target: { value: "promise" } });
    fireEvent.change(screen.getByLabelText("Usuario"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Cliente, identificación, factura o archivo"), { target: { value: "Cliente" } });
    await waitFor(() => expect(getAdministrativeHistory).toHaveBeenLastCalledWith({ type: "promise", actor_id: "1", q: "Cliente", date_from: "2026-10-01", page: 1, limit: 20 }, expect.anything()));
    fireEvent.change(screen.getByLabelText("Usuario"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "" } });
    await waitFor(() => expect(getAdministrativeHistory).toHaveBeenLastCalledWith({ type: "promise", q: "Cliente", page: 1, limit: 20 }, expect.anything()));
  });
  it("renders safe event context and filters by dates, type and actor", async () => {
    view(); expect(await screen.findByText("Observación")).toBeVisible(); expect(screen.getByText("Cliente: Cliente · NIT")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Tipo de evento" }), { target: { value: "action" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Usuario" }), { target: { value: "1" } });
    await waitFor(() => expect(getAdministrativeHistory).toHaveBeenLastCalledWith(expect.objectContaining({ date_from: "2026-10-01", type: "action", actor_id: "1" }), expect.anything()));
  });
  it("resolves MERTEL automatically for global administrators and denies unauthorized entry", async () => {
    view({ user: { id: "9", company_id: null, is_global_admin: true } });
    expect(await screen.findByText("Observación")).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "Empresa" })).not.toBeInTheDocument();
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
