import { beforeEach, expect, it, vi } from "vitest";
import api from "../src/services/api";
import { createMessageTemplate, getMessageTemplateAdminData, setMessageTemplateActive, updateMessageTemplate } from "../src/services/messageTemplatesAdmin.service";
vi.mock("../src/services/api", () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());
const envelope = data => ({ data: { success: true, data } });

it("uses the fixed server-side MERTEL scope", async () => {
  api.get.mockResolvedValueOnce(envelope({ templates: [], stage_catalog: [], variables: [] }));
  await getMessageTemplateAdminData({ companyId: "7" });
  expect(api.get).toHaveBeenCalledWith("/collection/message-templates", { signal: undefined });
});

it("creates, updates and changes status through admin-only routes without company_id in mutation bodies", async () => {
  api.post.mockResolvedValue(envelope({ id: "10", status: "inactive" }));
  const payload = { name: "Recordatorio", channel: "whatsapp", content: "{{nombre_cliente}}", stage: null, status: "inactive" };
  await createMessageTemplate(payload, { companyId: "7" });
  expect(api.post).toHaveBeenCalledWith("/collection/message-templates", payload);
  const update = { ...payload }; delete update.status;
  api.put.mockResolvedValue(envelope({ id: "10", status: "inactive" }));
  await updateMessageTemplate("10", update, { companyId: "7" });
  expect(api.put).toHaveBeenCalledWith("/collection/message-templates/10", update);
  await setMessageTemplateActive("10", true, { companyId: "7" });
  expect(api.post).toHaveBeenLastCalledWith("/collection/message-templates/10/activate", {});
  await setMessageTemplateActive("10", false);
  expect(api.post).toHaveBeenLastCalledWith("/collection/message-templates/10/deactivate", {});
});

it("converts permission and validation responses into safe user errors", async () => {
  api.get.mockRejectedValueOnce({ response: { status: 403, data: { message: "private fixture" } } });
  await expect(getMessageTemplateAdminData()).rejects.toThrow("No tienes permiso");
  api.post.mockRejectedValueOnce({ response: { status: 400, data: { message: "La etapa debe pertenecer al catálogo activo." } } });
  await expect(createMessageTemplate({})).rejects.toThrow("La etapa debe pertenecer al catálogo activo.");
});
