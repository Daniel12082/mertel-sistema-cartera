import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import CustomerHistory from "../src/pages/Cobranza/CustomerHistory";
import { getCustomerHistory } from "../src/services/collectionHistory.service";

vi.mock("../src/services/collectionHistory.service", () => ({ getCustomerHistory: vi.fn() }));
const action = { id: "action:1", type: "action", occurred_at: "2026-10-06T15:30:00Z", actor: "Carlos", invoice: "FV-1", title: "Llamada", description: "Paga mañana", status: "completed", metadata: { action_type: "Llamada" } };
const data = { events: [action], pagination: { page: 1, limit: 20, total: 1, pages: 1, has_next: false, has_previous: false } };
beforeEach(() => { vi.clearAllMocks(); getCustomerHistory.mockResolvedValue(data); });

describe("customer history timeline", () => {
  it("renders event date, actor, invoice and filters event type", async () => {
    render(<CustomerHistory customerId="8" companyId="2" />);
    expect(await screen.findByText("Paga mañana")).toBeVisible(); expect(screen.getByText("Factura: FV-1")).toBeVisible(); expect(screen.getByText(/Carlos/)).toBeVisible();
    fireEvent.change(screen.getByRole("combobox", { name: "Tipo de evento" }), { target: { value: "promise" } });
    await waitFor(() => expect(getCustomerHistory).toHaveBeenLastCalledWith("8", expect.objectContaining({ type: "promise", company_id: "2" }), expect.anything()));
  });
  it("shows empty and error states without edit or send actions", async () => {
    getCustomerHistory.mockResolvedValueOnce({ ...data, events: [], pagination: { ...data.pagination, total: 0, pages: 0 } });
    const { rerender } = render(<CustomerHistory customerId="8" />); expect(await screen.findByText("Este cliente aún no tiene actividad registrada.")).toBeVisible();
    getCustomerHistory.mockRejectedValueOnce(new Error("Historial inaccesible")); rerender(<CustomerHistory customerId="9" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Historial inaccesible");
    expect(screen.queryByRole("button", { name: /editar|eliminar|enviar/i })).not.toBeInTheDocument();
  });
});
