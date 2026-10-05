import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AuthContext } from "../src/auth/auth.context";
import CollectionOperations from "../src/pages/Cobranza/CollectionOperations";
import { createCollectionAction, createPaymentPromise, getCollectionActions, getPaymentPromises } from "../src/services/collectionOperations.service";
vi.mock("../src/services/collectionOperations.service", () => ({ getCollectionActions: vi.fn(), getPaymentPromises: vi.fn(), createCollectionAction: vi.fn(), createPaymentPromise: vi.fn() }));
const invoices = [{ invoice: { invoice_id: 11, invoice_number: "FV-001" } }];
function view(permissions = ["collection.view", "collection.manage"]) {
  return render(<AuthContext.Provider value={{ user: { id: 1 }, permissions }}><CollectionOperations customerId="1" invoices={invoices} /></AuthContext.Provider>);
}
beforeEach(() => { vi.clearAllMocks(); getCollectionActions.mockResolvedValue([]); getPaymentPromises.mockResolvedValue([]); createCollectionAction.mockResolvedValue({ id: "1" }); createPaymentPromise.mockResolvedValue({ id: "1" }); });
describe("Manual collection operations", () => {
  it("loads and shows empty histories", async () => {
    view(); expect(screen.getByRole("status")).toHaveTextContent("Cargando historial");
    expect(await screen.findByText("No hay gestiones registradas.")).toBeVisible();
    expect(screen.getByText("No hay promesas registradas.")).toBeVisible();
  });
  it("shows action and promise author, dates, notes, amounts and pending state", async () => {
    getCollectionActions.mockResolvedValue([{ id: "1", user_name: "Cobrador", action_type: "Nota libre", description: "Observación recibida", action_date: "2026-10-05T15:00:00Z", invoice_number: "FV-001" }]);
    getPaymentPromises.mockResolvedValue([{ id: "1", user_name: "Cobrador", promised_date: "2026-10-15", promised_amount: "50000", status: "pending", notes: "Nota de promesa", created_at: "2026-10-05T15:00:00Z" }]);
    view(); expect(await screen.findByText("Observación recibida")).toBeVisible(); expect(screen.getByText("Nota de promesa")).toBeVisible();
    expect(screen.getByText(/Estado: Pendiente/)).toBeVisible(); expect(screen.getByText(/15\/10\/2026/)).toBeVisible();
  });
  it("registers a free-text action without supplying actor, status or balances", async () => {
    view(); await screen.findByText("No hay gestiones registradas."); fireEvent.click(screen.getByRole("button", { name: "Registrar gestión" }));
    expect(screen.getByLabelText("Factura de la operación")).toHaveFocus();
    fireEvent.change(screen.getByLabelText("Factura de la operación"), { target: { value: "11" } });
    fireEvent.change(screen.getByLabelText("Tipo de gestión (texto libre)"), { target: { value: "Nota libre" } });
    fireEvent.change(screen.getByLabelText("Observación de gestión"), { target: { value: "Texto manual" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));
    expect(await screen.findByText("Gestión registrada.")).toBeVisible();
    expect(createCollectionAction).toHaveBeenCalledWith("1", { invoice_id: "11", action_type: "Nota libre", description: "Texto manual" });
    await waitFor(() => expect(getCollectionActions).toHaveBeenCalledTimes(2));
  });
  it("registers a promise with exact calendar date and decimal string", async () => {
    view(); await screen.findByText("No hay gestiones registradas."); fireEvent.click(screen.getByRole("button", { name: "Registrar promesa" }));
    fireEvent.change(screen.getByLabelText("Fecha prometida"), { target: { value: "2026-10-15" } });
    fireEvent.change(screen.getByLabelText("Valor prometido"), { target: { value: "12.34" } });
    fireEvent.change(screen.getByLabelText("Observación de promesa"), { target: { value: "Nota" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));
    expect(await screen.findByText("Promesa registrada como pendiente.")).toBeVisible();
    expect(createPaymentPromise).toHaveBeenCalledWith("1", { invoice_id: null, promised_date: "2026-10-15", promised_amount: "12.34", notes: "Nota" });
  });
  it("prevents double submit and keeps input while an API error is displayed", async () => {
    let reject; createCollectionAction.mockReturnValue(new Promise((resolve, fail) => { reject = fail; }));
    view(); await screen.findByText("No hay gestiones registradas."); fireEvent.click(screen.getByRole("button", { name: "Registrar gestión" }));
    fireEvent.change(screen.getByLabelText("Tipo de gestión (texto libre)"), { target: { value: "Nota" } });
    fireEvent.change(screen.getByLabelText("Observación de gestión"), { target: { value: "Conservar" } });
    const form = screen.getByRole("form", { name: "Registro de gestión" }); fireEvent.submit(form); fireEvent.submit(form);
    expect(createCollectionAction).toHaveBeenCalledTimes(1); expect(screen.getByRole("button", { name: "Guardando…" })).toBeDisabled();
    await act(async () => reject(new Error("No tienes permiso para esta operación de cobranza.")));
    expect(screen.getByRole("alert")).toHaveTextContent("No tienes permiso"); expect(screen.getByLabelText("Observación de gestión")).toHaveValue("Conservar");
  });
  it("retries history errors and supports filtering by invoice", async () => {
    getCollectionActions.mockRejectedValueOnce(new Error("Error seguro")); view();
    expect(await screen.findByRole("alert")).toHaveTextContent("Error seguro");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar historial" })); await screen.findByText("No hay gestiones registradas.");
    fireEvent.change(screen.getByLabelText("Filtrar historial por factura"), { target: { value: "11" } });
    await waitFor(() => expect(getPaymentPromises).toHaveBeenLastCalledWith("1", expect.objectContaining({ invoiceId: "11" })));
  });
  it("read-only permission exposes history but no action, promise or draft forms", async () => {
    view(["collection.view"]); await screen.findByText("No hay gestiones registradas.");
    for (const name of ["Registrar gestión", "Registrar promesa", "Preparar mensaje"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    expect(createPaymentPromise).not.toHaveBeenCalled();
  });
  it("prepares a local preview without any POST or successful sending state", async () => {
    view(); await screen.findByText("No hay gestiones registradas."); fireEvent.click(screen.getByRole("button", { name: "Preparar mensaje" }));
    fireEvent.change(screen.getByLabelText("Contenido del borrador"), { target: { value: "Texto manual sin envío" } }); fireEvent.click(screen.getByRole("button", { name: "Ver vista previa" }));
    expect(screen.getByLabelText("Vista previa del mensaje")).toHaveTextContent("Texto manual sin envío");
    expect(createCollectionAction).not.toHaveBeenCalled(); expect(createPaymentPromise).not.toHaveBeenCalled(); expect(screen.queryByText("Mensaje enviado")).not.toBeInTheDocument();
  });
});
