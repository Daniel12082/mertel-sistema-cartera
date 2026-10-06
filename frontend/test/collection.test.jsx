import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AuthContext } from "../src/auth/auth.context";
import Cobranza from "../src/pages/Cobranza/Cobranza";
import { getCollection, readCollectionResponse } from "../src/services/collection.service";
import { collectionFixture } from "./collection.fixture";

vi.mock("../src/services/collection.service", async importOriginal => ({ ...await importOriginal(), getCollection: vi.fn() }));
vi.mock("../src/services/collectionOperations.service", () => ({ getCollectionActions: vi.fn().mockResolvedValue([]), getPaymentPromises: vi.fn().mockResolvedValue([]) }));
function view(permissions = ["collection.view"]) {
  return render(<AuthContext.Provider value={{ user: { id: 1 }, permissions }}><Cobranza /></AuthContext.Provider>);
}
async function loaded() { view(); await screen.findByRole("button", { name: "Ver detalle de Cliente Águila" }); }
beforeEach(() => { vi.clearAllMocks(); getCollection.mockResolvedValue(readCollectionResponse({ data: collectionFixture() })); });

describe("Cobranza de MERTEL", () => {
  it("uses the backend stage catalog, labels and order without static stage cards", async () => {
    const data = collectionFixture();
    data.stage_catalog = [{ key: "server_stage", label: "Etiqueta recibida", category: "overdue", priority: 4 }, { key: "due_today", label: "Vence hoy", category: "due_today", priority: 3 }];
    data.customers[0].stage = "server_stage"; data.customers[0].stage_label = "Etiqueta recibida";
    data.summary.stages = { server_stage: { customers: 1 }, due_today: { customers: 1 } };
    data.configuration_warnings = ["Pronto Pago pendiente de calendario."];
    getCollection.mockResolvedValue(data); await loaded();
    expect(screen.getByRole("region", { name: "Resumen de cobranza" }).querySelector("article")).toHaveTextContent("Etiqueta recibida");
    expect(screen.getByLabelText("Etapa").options).toHaveLength(3);
    expect(screen.getByText("Pronto Pago pendiente de calendario.")).toBeVisible();
    expect(screen.queryByText("Faltan X días")).not.toBeInTheDocument();
  });
  it("presents backend prompt window and manual-review reasons without granting a discount", async () => {
    const data = collectionFixture();
    data.customers[0].invoices[0].prompt_payment = { percentage: "3", window: { reason: "Calendario pendiente desde emisión." }, eligibility: { reason: "Productos desconocidos: revisión manual." }, discount: { amount: null, reason: "No se aplicó descuento." } };
    getCollection.mockResolvedValue(data); await loaded(); fireEvent.click(screen.getByRole("button", { name: "Ver detalle de Cliente Águila" }));
    fireEvent.click(screen.getByText("Ver evaluación"));
    expect(screen.getByText("Calendario pendiente desde emisión.")).toBeVisible();
    expect(screen.getByText("Productos desconocidos: revisión manual.")).toBeVisible();
    expect(screen.getByText("No se aplicó descuento.")).toBeVisible();
  });
  it("renders title, explicit date and loading before the response", () => {
    getCollection.mockReturnValue(new Promise(() => {})); view();
    expect(screen.getByRole("heading", { name: "Cobranza" })).toBeVisible();
    expect(screen.getByLabelText("Fecha de referencia").value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(screen.getByRole("status")).toHaveTextContent("Cargando cobranza");
  });
  it("shows safe errors and retries", async () => {
    getCollection.mockRejectedValueOnce(new Error("No fue posible consultar cobranza. Intenta nuevamente.")); view();
    expect(await screen.findByRole("alert")).toHaveTextContent("No fue posible");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await screen.findByRole("button", { name: "Ver detalle de Cliente Águila" });
    expect(getCollection).toHaveBeenCalledTimes(2);
  });
  it("shows an empty state", async () => {
    getCollection.mockResolvedValue({ customers: [], rules_configured: true, summary: { stages: {} } }); view();
    expect(await screen.findByText("No hay clientes en cobranza para la fecha seleccionada.")).toBeVisible();
  });
  it("counts customers by their principal stage and renders each customer once", async () => {
    await loaded();
    const summary = screen.getByRole("region", { name: "Resumen de cobranza" });
    expect(within(summary).getAllByText("1 clientes")).toHaveLength(2);
    expect(screen.getByText("Cliente Águila")).toBeVisible();
    expect(screen.getAllByText("Cliente Águila")).toHaveLength(1);
    const row = screen.getByText("Cliente Águila").closest("article");
    expect(within(row).getByText("3")).toBeVisible();
    expect(within(row).getByText("FV-001")).toBeVisible();
  });
  it("shows detail, backend priority and all invoice stages without choosing another principal invoice", async () => {
    await loaded(); const button = screen.getByRole("button", { name: "Ver detalle de Cliente Águila" }); button.focus(); fireEvent.click(button);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Saldo total pendiente")).toBeVisible();
    expect(within(dialog).getByText("Saldo de facturas elegibles para cobranza")).toBeVisible();
    expect(within(dialog).getAllByText("4")).toHaveLength(2);
    expect(within(dialog).getByRole("cell", { name: "FV-003", exact: true })).toBeVisible();
    expect(within(dialog).getByText("No elegible")).toBeVisible();
    expect(within(dialog).getByText("3000000000")).toBeVisible();
    fireEvent.keyDown(screen.getByRole("button", { name: "Cerrar detalle" }), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(button).toHaveFocus();
  });
  it("presents invoice priority, eligibility and the exact supplied stage candidates without deriving them", async () => {
    const fixture = collectionFixture();
    fixture.customers[0].invoices[0].priority = 0;
    fixture.customers[0].invoices[0].stage_candidates = [
      { stage: "server_candidate_b", priority: 17, reason: "Motivo recibido B" },
      { stage: "server_candidate_a", priority: 23, reason: "Motivo recibido A" },
    ];
    getCollection.mockResolvedValue(readCollectionResponse({ data: fixture }));
    await loaded(); fireEvent.click(screen.getByRole("button", { name: "Ver detalle de Cliente Águila" }));
    const dialog = screen.getByRole("dialog");
    const row = within(dialog).getAllByText("FV-001").find(node => node.closest("tr")).closest("tr");
    expect(within(row).getByText("0")).toBeVisible(); expect(within(row).getByText("Sí")).toBeVisible();
    const candidates = within(row).getAllByRole("listitem");
    expect(candidates[0]).toHaveTextContent("server_candidate_bPrioridad: 17Motivo recibido B");
    expect(candidates[1]).toHaveTextContent("server_candidate_aPrioridad: 23Motivo recibido A");
    const ineligible = within(dialog).getByRole("cell", { name: "FV-003", exact: true }).closest("tr");
    expect(within(ineligible).getByText("No")).toBeVisible();
    expect(within(ineligible).getByText("Sin candidatos")).toBeVisible();
    expect(within(ineligible).getByText("—", { selector: 'td[data-label="Prioridad"]' })).toBeVisible();
  });
  it("refreshes date, summary, rows and open detail with unchanged calendar query", async () => {
    await loaded(); fireEvent.click(screen.getByRole("button", { name: "Ver detalle de Cliente Águila" }));
    const changed = collectionFixture(); changed.customers[0].stage = "due_today"; changed.customers[0].priority = 3;
    changed.reference_date = "2026-10-04";
    changed.summary.stages = { due_today: { customers: 2 } };
    getCollection.mockResolvedValue(readCollectionResponse({ data: changed }));
    fireEvent.change(screen.getByLabelText("Fecha de referencia"), { target: { value: "2026-10-04" } });
    await waitFor(() => expect(getCollection).toHaveBeenLastCalledWith("2026-10-04", expect.objectContaining({ signal: expect.any(AbortSignal) })));
    expect(await screen.findByRole("dialog")).toHaveTextContent("3");
    expect(screen.getByRole("dialog")).toHaveTextContent("Referencia 4/10/2026");
    expect(screen.getByRole("region", { name: "Resumen de cobranza" })).toHaveTextContent("2 clientes");
  });
  it("filters by principal stage without changing summary counts", async () => {
    await loaded(); fireEvent.change(screen.getByLabelText("Etapa"), { target: { value: "overdue" } });
    expect(screen.queryByText("Cliente Beta")).not.toBeInTheDocument();
    expect(screen.getByText("1 de 2 clientes")).toBeVisible();
    expect(screen.getByRole("region", { name: "Resumen de cobranza" })).toHaveTextContent("1 clientes");
  });
  it.each(["aguila", "900111", "FV-003"])("searches name, NIT and secondary invoices locally: %s", async query => {
    await loaded(); fireEvent.change(screen.getByLabelText("Buscar cliente / NIT / factura"), { target: { value: query } });
    expect(screen.getByText("Cliente Águila")).toBeVisible(); expect(screen.queryByText("Cliente Beta")).not.toBeInTheDocument();
    expect(getCollection).toHaveBeenCalledTimes(1);
  });
  it("distinguishes no search results and clears filters", async () => {
    await loaded(); fireEvent.change(screen.getByLabelText("Buscar cliente / NIT / factura"), { target: { value: "missing" } });
    expect(screen.getByText("No hay clientes que coincidan con la búsqueda o los filtros.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" })); expect(screen.getByText("Cliente Beta")).toBeVisible();
  });
  it("blocks without collection.view and makes no request", () => {
    view(["collection.manage"]); expect(screen.getByRole("alert")).toHaveTextContent("No tienes permiso"); expect(getCollection).not.toHaveBeenCalled();
  });
  it("handles API 403 and clears customer data", async () => {
    await loaded(); getCollection.mockRejectedValue(Object.assign(new Error("No tienes permiso para consultar cobranza."), { status: 403 }));
    fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No tienes permiso"); expect(screen.queryByText("Cliente Águila")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
  });
  it("distinguishes missing rules from empty receivables", async () => {
    getCollection.mockResolvedValue({ customers: [], rules_configured: false, summary: { stages: {} } }); view();
    expect(await screen.findByText("MERTEL no tiene reglas de cobranza configuradas.")).toBeVisible();
    expect(screen.queryByRole("region", { name: "Resumen de cobranza" })).not.toBeInTheDocument();
  });
  it("ignores stale responses when the date changes", async () => {
    let resolveOld; getCollection.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; })); view();
    fireEvent.change(screen.getByLabelText("Fecha de referencia"), { target: { value: "2026-10-04" } });
    await screen.findByText("Cliente Águila");
    await act(async () => resolveOld({ customers: [], rules_configured: false }));
    expect(screen.getByText("Cliente Águila")).toBeVisible();
  });
  it("does not request an empty date", async () => {
    await loaded(); fireEvent.change(screen.getByLabelText("Fecha de referencia"), { target: { value: "" } });
    expect(screen.getByRole("status")).toHaveTextContent("Selecciona una fecha"); expect(getCollection).toHaveBeenCalledTimes(1);
  });
});
