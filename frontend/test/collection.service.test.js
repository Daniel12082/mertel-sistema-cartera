import { beforeEach, describe, expect, it, vi } from "vitest";
import api from "../src/services/api";
import { collectionError, getCollection, readCollectionResponse } from "../src/services/collection.service";
import { localDateValue } from "../src/pages/Cobranza/collection.presentation";
import { collectionFixture } from "./collection.fixture";
vi.mock("../src/services/api", () => ({ default: { get: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());
describe("Collection service boundary", () => {
  it("uses the authenticated API with the exact date and cancellation", async () => {
    api.get.mockResolvedValue({ data: { success: true, data: collectionFixture() } });
    const signal = new AbortController().signal; const result = await getCollection("2026-10-03", { signal });
    expect(api.get).toHaveBeenCalledWith("/collection", { params: { reference_date: "2026-10-03" }, signal });
    expect(result.customers).toHaveLength(2);
  });
  it("passes the selected company only as a global-admin scope parameter", async () => {
    api.get.mockResolvedValue({ data: { success: true, data: collectionFixture() } });
    await getCollection("2026-10-03", { companyId: "42" });
    expect(api.get).toHaveBeenCalledWith("/collection", { params: { reference_date: "2026-10-03", company_id: "42" }, signal: undefined });
  });
  it("preserves engine decisions and does not manufacture balances", () => {
    const fixture = collectionFixture(); delete fixture.customers[0].total_balance;
    const result = readCollectionResponse({ data: fixture });
    expect(result.rules_configured).toBe(true); expect(result.customers[0].total_balance).toBeUndefined();
    expect(result.customers[0].main_invoice.invoice.invoice_number).toBe("FV-001");
  });
  it("keeps the real reference date, rule availability, summary and invoice classifications intact", () => {
    const fixture = collectionFixture();
    const result = readCollectionResponse({ success: true, data: fixture });
    expect(result).toBe(fixture);
    expect(result.reference_date).toBe("2026-10-03");
    expect(result.status).toBe("ready");
    expect(result.summary.stages.overdue.customers).toBe(1);
    expect(result.customers[0].invoices[2].eligible).toBe(false);
    expect(result.customers[0].total_balance).toBe("150000");
    expect(result.customers[0].eligible_balance).toBe("100000");
  });
  it("rejects duplicate customers and incompatible payloads instead of silently showing zero", () => {
    const fixture = collectionFixture(); fixture.customers.push(fixture.customers[0]);
    expect(() => readCollectionResponse({ data: fixture })).toThrow("collection_contract");
    expect(() => readCollectionResponse({ data: {} })).toThrow("collection_contract");
  });
  it.each([403, 404, 400, 500])("sanitizes HTTP errors: %s", async status => {
    api.get.mockRejectedValue({ response: { status, data: { message: "SQL private data" } } });
    await expect(getCollection("2026-10-03")).rejects.toThrow(collectionError({ response: { status } }));
    expect(collectionError({ response: { status } })).not.toContain("SQL");
  });
  it("builds calendar dates using local components", () => {
    expect(localDateValue(new Date(2026, 9, 3, 23, 59))).toBe("2026-10-03");
  });
});
