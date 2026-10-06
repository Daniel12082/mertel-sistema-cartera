import { beforeEach, expect, it, vi } from "vitest";
import api from "../src/services/api";
import { getCollectionMessageTemplates, previewCollectionMessage, prepareCollectionMessage } from "../src/services/collectionMessages.service";
vi.mock("../src/services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const data = prepared => ({ customer: { id: "1", phone: "3000000000" }, template: { id: "7" }, content: "Fixture", variables: [], missing_variables: [], unsupported_variables: [], can_prepare: true, prepared });
beforeEach(() => vi.clearAllMocks());
it("uses only the protected template/preview/prepare routes and sends no content or company authority", async () => {
  api.get.mockResolvedValue({ data: { success: true, data: [] } });
  await getCollectionMessageTemplates("1", "2026-10-05");
  expect(api.get).toHaveBeenCalledWith("/collection/customers/1/message-templates", expect.objectContaining({ params: { reference_date: "2026-10-05" } }));
  for (const [call, prepared, suffix] of [[previewCollectionMessage, false, "preview"], [prepareCollectionMessage, true, "prepare"]]) {
    api.post.mockResolvedValue({ data: { success: true, data: data(prepared) } }); await call("1", "2026-10-05", "7");
    expect(api.post).toHaveBeenLastCalledWith(`/collection/customers/1/messages/${suffix}`, { template_id: "7", reference_date: "2026-10-05" }, expect.any(Object));
  }
});
it("passes selected company scope in query parameters for global-admin message flows", async () => {
  api.get.mockResolvedValue({ data: { success: true, data: [] } });
  await getCollectionMessageTemplates("1", "2026-10-05", { companyId: "42" });
  expect(api.get).toHaveBeenCalledWith("/collection/customers/1/message-templates", expect.objectContaining({ params: { reference_date: "2026-10-05", company_id: "42" } }));
  api.post.mockResolvedValue({ data: { success: true, data: data(false) } });
  await previewCollectionMessage("1", "2026-10-05", "7", { companyId: "42" });
  expect(api.post).toHaveBeenCalledWith("/collection/customers/1/messages/preview", { template_id: "7", reference_date: "2026-10-05" }, { params: { company_id: "42" }, signal: undefined });
});
it.each([400, 403, 404, 409, 500])("returns a safe API error without exposing server text: %s", async status => {
  api.get.mockRejectedValue({ response: { status, data: { message: "private SQL fixture" } } });
  await expect(getCollectionMessageTemplates("1", "2026-10-05")).rejects.toMatchObject({ status });
  await expect(getCollectionMessageTemplates("1", "2026-10-05")).rejects.not.toThrow(/private SQL/);
});
it("rejects a response for another client or template instead of displaying its content", async () => {
  api.post.mockResolvedValue({ data: { success: true, data: { ...data(false), customer: { id: "2" } } } });
  await expect(previewCollectionMessage("1", "2026-10-05", "7")).rejects.toThrow("No fue posible");
});
