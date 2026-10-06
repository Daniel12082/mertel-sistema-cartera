import { beforeEach, expect, it, vi } from "vitest";
import api from "../src/services/api";
import { createMessageTemplate, getAdminCompanies, getMessageTemplateAdminData, setMessageTemplateActive, updateMessageTemplate } from "../src/services/messageTemplatesAdmin.service";
vi.mock("../src/services/api", () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());
const envelope = data => ({ data: { success: true, data } });

it("uses the collection scope and the existing global company list", async () => {
  api.get.mockResolvedValueOnce(envelope({ templates: [], stage_catalog: [], variables: [] }));
  await getMessageTemplateAdminData({ companyId: "7" });
  expect(api.get).toHaveBeenCalledWith("/collection/message-templates", { params: { company_id: "7" }, signal: undefined });
  api.get.mockResolvedValueOnce(envelope([{ id: "7", name: "MERTEL", status: "active" }]));
  await getAdminCompanies(); expect(api.get).toHaveBeenLastCalledWith("/admin/companies", { signal: undefined });
});

it("creates, updates and changes status through admin-only routes without company_id in mutation bodies", async () => {
  api.post.mockResolvedValue(envelope({ id: "10", status: "inactive" }));
  const payload = { name: "Recordatorio", channel: "whatsapp", content: "{{nombre_cliente}}", stage: null, status: "inactive" };
  await createMessageTemplate(payload, { companyId: "7" });
  expect(api.post).toHaveBeenCalledWith("/collection/message-templates", payload, { params: { company_id: "7" }, signal: undefined });
  const update = { ...payload }; delete update.status;
  api.put.mockResolvedValue(envelope({ id: "10", status: "inactive" }));
  await updateMessageTemplate("10", update, { companyId: "7" });
  expect(api.put).toHaveBeenCalledWith("/collection/message-templates/10", update, { params: { company_id: "7" }, signal: undefined });
  await setMessageTemplateActive("10", true, { companyId: "7" });
  expect(api.post).toHaveBeenLastCalledWith("/collection/message-templates/10/activate", {}, { params: { company_id: "7" }, signal: undefined });
  await setMessageTemplateActive("10", false);
  expect(api.post).toHaveBeenLastCalledWith("/collection/message-templates/10/deactivate", {}, { params: undefined, signal: undefined });
});

it("converts permission and validation responses into safe user errors", async () => {
  api.get.mockRejectedValueOnce({ response: { status: 403, data: { message: "private fixture" } } });
  await expect(getMessageTemplateAdminData()).rejects.toThrow("No tienes permiso");
  api.post.mockRejectedValueOnce({ response: { status: 400, data: { message: "La etapa debe pertenecer al catálogo activo." } } });
  await expect(createMessageTemplate({})).rejects.toThrow("La etapa debe pertenecer al catálogo activo.");
});
