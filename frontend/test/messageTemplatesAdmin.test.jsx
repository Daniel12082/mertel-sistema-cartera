import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthContext } from "../src/auth/auth.context";
import MessageTemplates from "../src/pages/Administracion/MessageTemplates";
import { createMessageTemplate, getAdminCompanies, getMessageTemplateAdminData, setMessageTemplateActive, updateMessageTemplate } from "../src/services/messageTemplatesAdmin.service";

vi.mock("../src/services/messageTemplatesAdmin.service", () => ({
  createMessageTemplate: vi.fn(), getAdminCompanies: vi.fn(), getMessageTemplateAdminData: vi.fn(),
  setMessageTemplateActive: vi.fn(), updateMessageTemplate: vi.fn(),
}));

const variables = [
  { name: "nombre_cliente", label: "Nombre del cliente", source: "customers.name", example: "Juan Pérez" },
  { name: "saldo_pendiente", label: "Saldo pendiente total del cliente", source: "collection_customer.total_balance", example: "$2.450.000,00" },
  { name: "cliente", label: "Cliente (compatibilidad anterior)", source: "customers.name", example: "Juan Pérez", legacy: true },
];
const template = { id: "10", name: "Recordatorio fixture", channel: "whatsapp", content: "Hola {{nombre_cliente}}", stage: "overdue", status: "inactive", created_at: "2026-10-01T10:00:00Z", updated_at: "2026-10-02T11:00:00Z" };
const adminData = templates => ({ templates, stage_catalog: [{ key: "overdue", label: "En mora" }], variables });
function view({ permissions = ["message_templates.manage"], user = { id: "1", is_global_admin: false } } = {}) {
  return render(<AuthContext.Provider value={{ user, permissions }}><MessageTemplates /></AuthContext.Provider>);
}

beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("confirm", vi.fn(() => true));
  getMessageTemplateAdminData.mockResolvedValue(adminData([template])); getAdminCompanies.mockResolvedValue([{ id: "1", name: "MERTEL Importaciones", status: "active" }]);
  createMessageTemplate.mockResolvedValue({ id: "11" }); updateMessageTemplate.mockResolvedValue(template);
  setMessageTemplateActive.mockResolvedValue({ ...template, status: "active" });
});

describe("5.1A WhatsApp template admin UI", () => {
  it("shows the company template list with channel, stage, status and modified date", async () => {
    view();
    expect(await screen.findByRole("heading", { name: "Plantillas WhatsApp" })).toBeVisible();
    const row = await screen.findByRole("row", { name: /Recordatorio fixture/ });
    expect(row).toHaveTextContent("WhatsApp"); expect(row).toHaveTextContent("En mora"); expect(row).toHaveTextContent("Inactiva");
    expect(row).toHaveTextContent("2/10/2026");
  });

  it("creates a template, inserts the backend catalog variable and previews only identified examples", async () => {
    const user = userEvent.setup(); view();
    await user.click(await screen.findByRole("button", { name: "Nueva plantilla" }));
    await user.type(screen.getByLabelText("Nombre de plantilla"), "Primer aviso");
    const content = screen.getByLabelText("Contenido de plantilla"); await user.type(content, "Hola ");
    await user.click(screen.getByRole("button", { name: "Insertar {{nombre_cliente}}" }));
    expect(content).toHaveValue("Hola {{nombre_cliente}}"); expect(screen.getByLabelText("Vista previa con ejemplos")).toHaveTextContent("Hola Juan Pérez");
    expect(screen.getByLabelText("Vista previa con ejemplos")).toHaveTextContent("Datos de ejemplo ficticios");
    await user.click(screen.getByRole("button", { name: "Crear plantilla" }));
    await waitFor(() => expect(createMessageTemplate).toHaveBeenCalledWith({ name: "Primer aviso", channel: "whatsapp", content: "Hola {{nombre_cliente}}", stage: null, status: "inactive" }, {}));
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it("validates unknown and malformed variables in the editor before sending a request", async () => {
    const user = userEvent.setup(); view(); await user.click(await screen.findByRole("button", { name: "Nueva plantilla" }));
    await user.type(screen.getByLabelText("Nombre de plantilla"), "Prueba");
    fireEvent.change(screen.getByLabelText("Contenido de plantilla"), { target: { value: "Hola {{campo_inventado}}" } });
    await user.click(screen.getByRole("button", { name: "Crear plantilla" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no está en el catálogo"); expect(createMessageTemplate).not.toHaveBeenCalled();
  });

  it("edits an existing template and separately confirms activation or deactivation", async () => {
    const user = userEvent.setup(); view();
    await user.click(await screen.findByRole("button", { name: "Editar Recordatorio fixture" }));
    const name = screen.getByLabelText("Nombre de plantilla"); await user.clear(name); await user.type(name, "Aviso editado");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(updateMessageTemplate).toHaveBeenCalledWith("10", { name: "Aviso editado", channel: "whatsapp", content: "Hola {{nombre_cliente}}", stage: "overdue" }, {}));
    expect(screen.queryByLabelText("Estado inicial")).not.toBeInTheDocument();
    getMessageTemplateAdminData.mockResolvedValueOnce(adminData([{ ...template, status: "active" }]));
    const activate = await screen.findByRole("button", { name: "Activar Recordatorio fixture" }); await user.click(activate);
    expect(window.confirm).toHaveBeenCalledWith("¿Deseas activar la plantilla «Recordatorio fixture»?");
    await waitFor(() => expect(setMessageTemplateActive).toHaveBeenCalledWith("10", true, {}));
    const deactivate = await screen.findByRole("button", { name: "Desactivar Recordatorio fixture" }); await user.click(deactivate);
    expect(window.confirm).toHaveBeenLastCalledWith("¿Deseas desactivar la plantilla «Recordatorio fixture»?");
    await waitFor(() => expect(setMessageTemplateActive).toHaveBeenCalledWith("10", false, {}));
  });

  it("provides loading, error and empty states", async () => {
    let finish; getMessageTemplateAdminData.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    view(); expect(screen.getByRole("status")).toHaveTextContent("Cargando plantillas");
    finish(adminData([])); expect(await screen.findByText("No hay plantillas WhatsApp configuradas")).toBeVisible();
    getMessageTemplateAdminData.mockRejectedValueOnce(new Error("Error seguro de carga"));
    fireEvent.click(screen.getByRole("button", { name: "Actualizar" })); expect(await screen.findByText("No se pudieron cargar las plantillas")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("Error seguro de carga");
  });

  it("uses the explicit backend company list for global admins and hides administration from other roles", async () => {
    const { unmount } = view({ user: { id: "2", company_id: null, is_global_admin: true } });
    await screen.findByRole("combobox", { name: "Empresa" });
    expect(await screen.findByRole("row", { name: /Recordatorio fixture/ })).toBeVisible();
    await waitFor(() => expect(getMessageTemplateAdminData).toHaveBeenCalledWith(expect.objectContaining({ companyId: "1", signal: expect.any(AbortSignal) })));
    expect(getAdminCompanies).toHaveBeenCalledOnce();
    unmount();
    getMessageTemplateAdminData.mockClear();
    view({ permissions: ["collection.manage"], user: { id: "3" } });
    expect(screen.getByRole("alert")).toHaveTextContent("No tienes permiso para administrar");
    expect(getMessageTemplateAdminData).not.toHaveBeenCalled();
  });
});
