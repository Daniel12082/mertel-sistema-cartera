import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { AuthContext } from "../src/auth/auth.context";
import CollectionMessages from "../src/pages/Cobranza/CollectionMessages";
import Cobranza from "../src/pages/Cobranza/Cobranza";
import { getCollection } from "../src/services/collection.service";
import { getCollectionMessageTemplates, previewCollectionMessage, prepareCollectionMessage } from "../src/services/collectionMessages.service";
import { createCollectionAction, createPaymentPromise } from "../src/services/collectionOperations.service";
import { collectionFixture } from "./collection.fixture";
vi.mock("../src/services/collection.service", () => ({ getCollection: vi.fn() }));
vi.mock("../src/services/collectionMessages.service", () => ({ getCollectionMessageTemplates: vi.fn(), previewCollectionMessage: vi.fn(), prepareCollectionMessage: vi.fn() }));
vi.mock("../src/services/collectionOperations.service", () => ({ getCollectionActions: vi.fn().mockResolvedValue([]), getPaymentPromises: vi.fn().mockResolvedValue([]), createCollectionAction: vi.fn(), createPaymentPromise: vi.fn() }));
const customer = { id: "1", name: "Cliente fixture", phone: "300 000 0000" };
const template = { id: "7", name: "Plantilla fixture", variables: ["cliente"] };
const preview = extra => ({ customer, template, content: "Texto fixture de Cliente fixture", variables: [{ name: "cliente", value: customer.name }],
  missing_variables: [], unsupported_variables: [], malformed_variables: false, can_prepare: true, prepared: false, notice: "Vista previa. No se ha enviado ningún mensaje.", ...extra });
function context(child, manage = true) { return render(<AuthContext.Provider value={{ user: { id: "1" }, permissions: ["collection.view", ...(manage ? ["collection.manage"] : [])] }}>{child}</AuthContext.Provider>); }
function view(manage = true, client = customer) { return context(<CollectionMessages customer={client} referenceDate="2026-10-05" />, manage); }
async function select() {
  fireEvent.click(screen.getByRole("button", { name: "Enviar mensaje a WhatsApp" }));
  const selector = await screen.findByLabelText("Seleccionar plantilla"); fireEvent.change(selector, { target: { value: "7" } });
  return selector;
}
beforeEach(() => {
  vi.clearAllMocks(); getCollection.mockResolvedValue(collectionFixture());
  getCollectionMessageTemplates.mockResolvedValue([template]); previewCollectionMessage.mockResolvedValue(preview());
  prepareCollectionMessage.mockResolvedValue(preview({ prepared: true, notice: "Mensaje preparado temporalmente. No se ha enviado ni guardado como envío." }));
});
describe("5.1 WhatsApp preparation", () => {
  it("opens the associated client selector and moves focus without asking for another client", async () => {
    view(); const selector = await select(); expect(selector).toHaveFocus();
    expect(getCollectionMessageTemplates).toHaveBeenCalledWith("1", "2026-10-05", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.queryByLabelText("Seleccionar cliente")).not.toBeInTheDocument();
  });
  it("renders an empty state without inventing templates", async () => {
    getCollectionMessageTemplates.mockResolvedValue([]); view(); fireEvent.click(screen.getByRole("button", { name: "Enviar mensaje a WhatsApp" }));
    expect(await screen.findByText("No hay mensajes configurados")).toBeVisible(); expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "WhatsApp" })).toHaveFocus();
  });
  it("reloads an already open selector instead of leaving it stuck loading", async () => {
    view(); await select(); fireEvent.click(screen.getByRole("button", { name: "Ver vista previa" })); await screen.findByLabelText("Vista previa del mensaje");
    fireEvent.click(screen.getByRole("button", { name: "Enviar mensaje a WhatsApp" }));
    const selector = await screen.findByLabelText("Seleccionar plantilla"); expect(selector.value).toBe("");
    expect(getCollectionMessageTemplates).toHaveBeenCalledTimes(2); expect(screen.queryByLabelText("Vista previa del mensaje")).not.toBeInTheDocument();
  });
  it("handles template errors and retries safely", async () => {
    getCollectionMessageTemplates.mockRejectedValueOnce(new Error("Error seguro")); view(); fireEvent.click(screen.getByRole("button", { name: "Enviar mensaje a WhatsApp" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Error seguro"); fireEvent.click(screen.getByRole("button", { name: "Reintentar mensajes" }));
    await screen.findByLabelText("Seleccionar plantilla"); expect(getCollectionMessageTemplates).toHaveBeenCalledTimes(2);
  });
  it("renders the authoritative client, exact phone, final content and variables, then prepares without operations", async () => {
    view(); await select(); fireEvent.click(screen.getByRole("button", { name: "Ver vista previa" }));
    const panel = await screen.findByLabelText("Vista previa del mensaje"); expect(panel).toHaveTextContent(customer.name); expect(panel).toHaveTextContent(customer.phone);
    expect(panel).toHaveTextContent("Texto fixture de Cliente fixture"); expect(panel).toHaveTextContent("{{cliente}}");
    fireEvent.click(within(panel).getByRole("button", { name: "Preparar mensaje" })); await screen.findByRole("heading", { name: "Mensaje preparado" });
    expect(prepareCollectionMessage).toHaveBeenCalledWith("1", "2026-10-05", "7", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(createCollectionAction).not.toHaveBeenCalled(); expect(createPaymentPromise).not.toHaveBeenCalled(); expect(screen.queryByText("Mensaje enviado")).not.toBeInTheDocument();
  });
  it.each([
    { missing_variables: ["factura"], variables: [{ name: "factura", value: null }] },
    { unsupported_variables: ["otra"] },
    { malformed_variables: true },
    { empty_content: true },
  ])("blocks preparation when the server reports missing or invalid variables: %j", async extra => {
    previewCollectionMessage.mockResolvedValue(preview({ ...extra, can_prepare: false })); view(); await select();
    fireEvent.click(screen.getByRole("button", { name: "Ver vista previa" })); await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Preparar mensaje" })).toBeDisabled(); expect(prepareCollectionMessage).not.toHaveBeenCalled();
  });
  it("shows missing phone and never permits a number-dependent preparation", async () => {
    const client = { ...customer, phone: null }; previewCollectionMessage.mockResolvedValue(preview({ customer: client, phone_available: false, can_prepare: false }));
    view(true, client); expect(screen.getByText("Este cliente no tiene un número de WhatsApp registrado.")).toBeVisible(); await select();
    fireEvent.click(screen.getByRole("button", { name: "Ver vista previa" })); await screen.findByLabelText("Vista previa del mensaje");
    expect(screen.getByRole("button", { name: "Preparar mensaje" })).toBeDisabled(); expect(prepareCollectionMessage).not.toHaveBeenCalled();
  });
  it("makes no message request without the existing manage permission", () => {
    view(false); expect(screen.getByRole("button", { name: "Enviar mensaje a WhatsApp" })).toBeDisabled(); expect(getCollectionMessageTemplates).not.toHaveBeenCalled();
  });
  it("clears the old preview after selecting another template and shows preview errors", async () => {
    let finish; getCollectionMessageTemplates.mockResolvedValue([template, { id: "8", name: "Otra fixture" }]);
    previewCollectionMessage.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); view(); const selector = await select();
    fireEvent.click(screen.getByRole("button", { name: "Ver vista previa" }));
    const revision = previewCollectionMessage.mock.calls[0][3].signal; expect(revision).toBeInstanceOf(AbortSignal);
    await act(async () => finish(preview())); await screen.findByLabelText("Vista previa del mensaje");
    fireEvent.change(selector, { target: { value: "8" } }); expect(screen.queryByLabelText("Vista previa del mensaje")).not.toBeInTheDocument();
    previewCollectionMessage.mockRejectedValueOnce(new Error("Error seguro de vista previa")); fireEvent.click(screen.getByRole("button", { name: "Ver vista previa" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Error seguro de vista previa"); expect(prepareCollectionMessage).not.toHaveBeenCalled();
  });
  it("discards a response after its client panel unmounts", async () => {
    let finish; previewCollectionMessage.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const rendered = view(); await select(); fireEvent.click(screen.getByRole("button", { name: "Ver vista previa" }));
    const signal = previewCollectionMessage.mock.calls[0][3].signal; rendered.unmount(); expect(signal.aborted).toBe(true);
    await act(async () => finish(preview())); expect(screen.queryByText("Mensaje preparado")).not.toBeInTheDocument();
  });
  it("shows the WhatsApp action on every pipeline card and opens its exact client", async () => {
    context(<Cobranza />); const buttons = await screen.findAllByRole("button", { name: "Enviar mensaje a WhatsApp" }); expect(buttons).toHaveLength(2);
    buttons[0].focus(); fireEvent.click(buttons[0]); const dialog = await screen.findByRole("dialog"); expect(dialog).toHaveTextContent("Cobranza de Cliente Águila");
    await within(dialog).findByLabelText("Seleccionar plantilla"); expect(getCollectionMessageTemplates).toHaveBeenCalledWith(1, "2026-10-03", expect.any(Object));
    fireEvent.keyDown(within(dialog).getByRole("button", { name: "Cerrar detalle" }), { key: "Escape" }); expect(buttons[0]).toHaveFocus();
  });
  it("disables card preparation for read-only users and preserves backend dates/main invoice", async () => {
    const fixture = collectionFixture(); fixture.customers[0].invoices[0].days_since_issue = 34; fixture.customers[0].invoices[0].days_until_due = -2;
    getCollection.mockResolvedValue(fixture); context(<Cobranza />, false);
    const buttons = await screen.findAllByRole("button", { name: "Enviar mensaje a WhatsApp" }); expect(buttons.every(button => button.disabled)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Ver detalle de Cliente Águila" }));
    const row = within(screen.getByRole("dialog")).getAllByText("FV-001").find(node => node.closest("tr")).closest("tr");
    expect(within(row).getByText("34")).toBeVisible(); expect(within(row).getByText("-2")).toBeVisible(); expect(getCollectionMessageTemplates).not.toHaveBeenCalled();
  });
});
