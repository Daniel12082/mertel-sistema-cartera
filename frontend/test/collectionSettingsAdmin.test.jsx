import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AuthContext } from "../src/auth/auth.context";
import CollectionSettings from "../src/pages/Administracion/CollectionSettings";
import { getCollectionSettings, updateCollectionStages } from "../src/services/collectionSettingsAdmin.service";

vi.mock("../src/services/collectionSettingsAdmin.service", () => ({
  getCollectionSettings: vi.fn(), updateCollectionStages: vi.fn(),
}));
const stages = [
  { key: "overdue", label: "En mora", description: "Vencida", type: "boolean", value: true, editable: true },
  { key: "due_today", label: "Vence hoy", description: "Hoy", type: "boolean", value: true, editable: true },
  { key: "five_days_before_due", label: "Faltan 5 días", description: "Cinco días", type: "boolean", value: true, editable: true },
  { key: "prompt_payment", label: "Pronto pago", description: "Pronto pago", type: "boolean", value: true, editable: true },
];
const data = { configured: true, stages, settings: [...stages, { key: "prompt_payment.percentage", label: "Descuento por pronto pago", description: "Sobre base", value: 3, unit: "%", editable: false }] };
function view({ permissions = ["settings.manage"], user = { id: "1", company_id: "1" } } = {}) {
  return render(<AuthContext.Provider value={{ user, permissions }}><CollectionSettings /></AuthContext.Provider>);
}
beforeEach(() => {
  vi.clearAllMocks(); getCollectionSettings.mockResolvedValue(data);
  updateCollectionStages.mockResolvedValue(data);
});

describe("5.2 administrative collection settings", () => {
  it("renders the configured stages and fixed commercial values", async () => {
    view();
    expect(await screen.findByRole("heading", { name: "Configuración de cobranza" })).toBeVisible();
    expect(await screen.findByText("Descuento por pronto pago")).toBeVisible();
    expect(screen.getByText("3 %")).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Activar Vence hoy" })).toBeChecked();
  });
  it("saves explicit stage changes and shows confirmation", async () => {
    view(); await screen.findByRole("checkbox", { name: "Activar Vence hoy" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Activar Vence hoy" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar configuración" }));
    await waitFor(() => expect(updateCollectionStages).toHaveBeenCalledWith(stages.map(stage => ({ key: stage.key, active: stage.key === "due_today" ? false : true }))));
    expect(await screen.findByRole("status")).toHaveTextContent("guardada correctamente");
  });
  it("shows loading, errors and unavailable configuration", async () => {
    let resolve; getCollectionSettings.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const first = view(); expect(screen.getByRole("status")).toHaveTextContent("Cargando configuración");
    resolve({ configured: false, settings: [], stages: [] });
    expect(await screen.findByText(/MERTEL Importaciones todavía no tiene reglas/)).toBeVisible();
    first.unmount();
    getCollectionSettings.mockRejectedValueOnce(new Error("Error de consulta"));
    view(); expect(await screen.findByRole("alert")).toHaveTextContent("Error de consulta");
  });
  it("resolves MERTEL automatically for a global administrator and hides the page from collectors", async () => {
    view({ user: { id: "2", company_id: null, is_global_admin: true } });
    expect(await screen.findByRole("checkbox", { name: "Activar En mora" })).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "Empresa" })).not.toBeInTheDocument();
    expect(getCollectionSettings).toHaveBeenCalledWith(expect.objectContaining({ signal: expect.any(AbortSignal) }));
    view({ permissions: ["collection.view"], user: { id: "3" } });
    expect(screen.getByRole("alert")).toHaveTextContent("No tienes permiso");
  });
});
