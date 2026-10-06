import { beforeEach, expect, it, vi } from "vitest";
import api from "../src/services/api";
import { createCollectionAction, createPaymentPromise, getCollectionActions, getPaymentPromises } from "../src/services/collectionOperations.service";
vi.mock("../src/services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
beforeEach(() => { vi.clearAllMocks(); api.get.mockResolvedValue({ data: { success: true, data: [] } }); api.post.mockResolvedValue({ data: { success: true, data: { id: "1" } } }); });
it("uses protected dedicated routes and passes exact invoice/date/amount values", async () => {
  const body = { promised_date: "2026-10-15", promised_amount: "12.34", invoice_id: "11", notes: "Nota" };
  await createPaymentPromise("1", body); expect(api.post).toHaveBeenCalledWith("/collection/customers/1/promises", body);
  const signal = new AbortController().signal; await getCollectionActions("1", { invoiceId: "11", signal });
  expect(api.get).toHaveBeenCalledWith("/collection/customers/1/actions", { params: { invoice_id: "11" }, signal });
});
it("passes an explicitly selected company as query context for operations", async () => {
  await createCollectionAction("1", { action_type: "Nota", description: "Texto" }, { companyId: "42" });
  expect(api.post).toHaveBeenCalledWith("/collection/customers/1/actions", { action_type: "Nota", description: "Texto" }, { params: { company_id: "42" } });
  await getPaymentPromises("1", { companyId: "42", invoiceId: "11" });
  expect(api.get).toHaveBeenCalledWith("/collection/customers/1/promises", { params: { invoice_id: "11", company_id: "42" }, signal: undefined });
});
it.each([400, 403, 404, 409, 500])("sanitizes API errors without exposing backend internals: %s", async status => {
  api.post.mockRejectedValue({ response: { status, data: { message: "private SQL INSERT" } } });
  await expect(createCollectionAction("1", { action_type: "Nota", description: "Texto" })).rejects.not.toThrow("private SQL");
});
it("rejects incompatible history responses instead of showing a false empty state", async () => {
  api.get.mockResolvedValue({ data: { success: true, data: {} } }); await expect(getPaymentPromises("1")).rejects.toThrow("No fue posible");
});
