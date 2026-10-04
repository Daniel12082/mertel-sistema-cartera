// Synthetic data confined to tests; uses the 4.7A HTTP response shape.
export function collectionFixture() {
  const invoice = { id: 11, invoice_number: "FV-001", issue_date: "2026-09-01", due_date: "2026-10-01", document_value: "100000", balance: "50000" };
  const second = { ...invoice, id: 12, invoice_number: "FV-002", due_date: "2026-10-03" };
  const third = { ...invoice, id: 13, invoice_number: "FV-003", due_date: "2026-10-10" };
  const cases = [
    { customerId: 1, customer: { id: 1, name: "Cliente Águila", nit: "900111", phone: "3000000000" }, eligible: true, stage: "overdue", priority: 100, reason: "Factura vencida con saldo pendiente.", primaryInvoice: invoice, total_balance: "150000", eligible_balance: "100000", classifiedInvoices: [
      { invoiceId: 11, invoice, stage: "overdue", priority: 100, reason: "Factura vencida", eligible: true, stage_candidates: [{ stage: "overdue", priority: 100, reason: "Factura vencida" }] },
      { invoiceId: 12, invoice: second, stage: "due_today", priority: 80, eligible: true, stage_candidates: [{ stage: "due_today", priority: 80, reason: "Vence hoy" }] },
      { invoiceId: 13, invoice: third, stage: "no_eligible", priority: null, eligible: false, reason: "Ninguna regla activa aplica.", stage_candidates: [] },
    ] },
    { customerId: 2, customer: { id: 2, name: "Cliente Beta", nit: "900222" }, eligible: true, stage: "due_today", priority: 80, primaryInvoice: { ...second, invoice_number: "B-001" }, classifiedInvoices: [{ invoiceId: 21, invoice: { ...second, invoice_number: "B-001" }, stage: "due_today", eligible: true }] },
  ];
  return { reference_date: "2026-10-03", status: "ready", rules_configured: true,
    summary: { total_customers: 2, total_balance: "200000", eligible_balance: "150000", stages: { overdue: { customers: 1 }, due_today: { customers: 1 } } },
    customers: cases.map(item => ({ customer: item.customer, stage: item.stage, priority: item.priority, reason: item.reason,
      total_balance: item.total_balance, eligible_balance: item.eligible_balance,
      main_invoice: item.classifiedInvoices.find(row => row.invoice.invoice_number === item.primaryInvoice.invoice_number),
      invoices: item.classifiedInvoices.map(({ invoice, stage, reason, eligible, priority, stage_candidates }) => ({ invoice, stage, reason, eligible, priority, stage_candidates })),
    })),
  };
}
