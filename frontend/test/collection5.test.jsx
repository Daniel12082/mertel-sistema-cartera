import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AuthContext } from "../src/auth/auth.context";
import Cobranza from "../src/pages/Cobranza/Cobranza";
import CollectionBenefits from "../src/pages/Cobranza/CollectionBenefits";
import { getCollection } from "../src/services/collection.service";
import { collectionFixture } from "./collection.fixture";

vi.mock("../src/services/collection.service", () => ({ getCollection: vi.fn() }));
vi.mock("../src/services/collectionOperations.service", () => ({ getCollectionActions: vi.fn().mockResolvedValue([]), getPaymentPromises: vi.fn().mockResolvedValue([]) }));
beforeEach(() => vi.clearAllMocks());

const prompt = { percentage: "3", base_value: "50.00", window: { reason: "Diez días calendario desde fecha de factura.", end_date: "2026-10-15" }, eligibility: { status: "eligible", reason: "Evaluación positiva recibida." }, discount: { amount: null, preview_amount: "2", reason: "Beneficio pendiente de aplicación." } };
const conditional = { percentage: "10", window: { min_days: 60, max_days: 70 }, eligibility: { status: "eligible", reason: "Dentro de la ventana confirmada." }, discount: { amount: null, reason: "Base y fórmula financiera pendientes." } };

it("shows backend whole-peso preview as eligibility, never applied or a 13% combination", () => {
  render(<CollectionBenefits row={{ prompt_payment: prompt, conditional_discount: conditional }} />);
  fireEvent.click(screen.getByText("Ver evaluación")); fireEvent.click(screen.getByText("Ver beneficio condicionado"));
  expect(screen.getByText(/Descuento estimado en pesos enteros/)).toHaveTextContent("$ 2");
  expect(screen.getByText(/60–70 días calendario/)).toBeVisible();
  expect(screen.getAllByText("Estado: Elegible")).toHaveLength(2);
  expect(screen.queryByText(/descuento aplicado|13%/i)).not.toBeInTheDocument();
});

it("renders manual review and exclusion without inventing a preview", () => {
  render(<CollectionBenefits row={{ prompt_payment: { ...prompt, eligibility: { status: "manual_review", reason: "Factura mixta." }, product_eligibility: { exclusions: ["Alternadores para carros"] }, discount: { amount: null, preview_amount: null } } }} />);
  fireEvent.click(screen.getByText("Ver evaluación"));
  expect(screen.getByText("Estado: Revisión manual")).toBeVisible(); expect(screen.getByText(/Exclusiones: Alternadores/)).toBeVisible();
  expect(screen.queryByText(/Descuento estimado/)).not.toBeInTheDocument();
});

it("keeps a pending-only client visible outside the four stages and opens its existing operational detail", async () => {
  const fixture = collectionFixture();
  const customer = { id: 3, name: "Cliente no vencido", nit: "NIT-FIXTURE" };
  const row = { invoice: { id: 31, invoice_number: "NV-FIXTURE", balance: "100.00", due_date: "2026-12-01" }, stage: "no_eligible", eligible: false, prompt_payment: { ...prompt, eligibility: { status: "not_eligible", reason: "Fuera de ventana." }, discount: { amount: null } }, conditional_discount: conditional };
  fixture.non_overdue_pending = { label: "Facturas no vencidas", total_invoices: 1, total_balance: "100.00", invoices: [{ ...row, customer }], customers: [{ customer, stage: "no_eligible", stage_label: "Facturas no vencidas", main_invoice: null, total_balance: "100.00", eligible_balance: "0.00", invoices: [row] }] };
  getCollection.mockResolvedValue(fixture);
  render(<AuthContext.Provider value={{ user: { id: 1 }, permissions: ["collection.view"] }}><Cobranza /></AuthContext.Provider>);
  const region = await screen.findByRole("region", { name: "Facturas no vencidas" });
  expect(within(region).getByText("NV-FIXTURE")).toBeVisible();
  expect(screen.getByLabelText("Etapa").options).toHaveLength(5);
  fireEvent.click(within(region).getByRole("button", { name: "Ver factura no vencida NV-FIXTURE" }));
  expect(await screen.findByRole("dialog")).toHaveTextContent("Cobranza de Cliente no vencido");
});
