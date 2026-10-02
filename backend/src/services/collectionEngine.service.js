const DAY_IN_MS = 86_400_000;

function parseDateDay(value, fieldName) {
  let year;
  let month;
  let day;

  if (typeof value === "string") {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) throw new TypeError(`${fieldName} debe usar el formato YYYY-MM-DD`);
    [, year, month, day] = match.map(Number);
  } else if (value instanceof Date && !Number.isNaN(value.getTime())) {
    year = value.getUTCFullYear();
    month = value.getUTCMonth() + 1;
    day = value.getUTCDate();
  } else {
    throw new TypeError(`${fieldName} debe ser una fecha válida`);
  }

  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  if (
    year < 1000 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new TypeError(`${fieldName} no es una fecha de calendario válida`);
  }
  return Math.floor(date.getTime() / DAY_IN_MS);
}

function parseBalanceCents(value) {
  const text = typeof value === "number" && Number.isFinite(value)
    ? value.toString()
    : value;
  if (typeof text !== "string" || !/^\d{1,13}(?:\.\d{1,2})?$/.test(text)) {
    throw new TypeError("invoice.balance debe ser un monto no negativo con máximo dos decimales");
  }
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
}

function ruleCondition(rule) {
  if (rule.condition && typeof rule.condition === "object") {
    return rule.condition.type;
  }
  if (typeof rule.condition === "string") return rule.condition;
  if (rule.condition_type) return rule.condition_type;
  if (rule.days_before_due !== undefined) return "days_before_due";
  if (rule.key === "due_today" || rule.key === "overdue") return rule.key;
  throw new TypeError(`La regla ${rule.key} debe definir una condición`);
}

function validateRules(rules) {
  if (!Array.isArray(rules)) throw new TypeError("rules debe ser un arreglo");

  return rules.map((rule) => {
    if (!rule || typeof rule !== "object" || typeof rule.key !== "string" || !rule.key.trim()) {
      throw new TypeError("Cada regla debe tener una key no vacía");
    }
    if (typeof rule.active !== "boolean") {
      throw new TypeError(`La regla ${rule.key} debe indicar active como booleano`);
    }
    if (!rule.active) return { rule, condition: null };
    if (typeof rule.priority !== "number" || !Number.isFinite(rule.priority)) {
      throw new TypeError(`La regla ${rule.key} debe tener una prioridad numérica finita`);
    }

    const condition = ruleCondition(rule);
    if (!["due_today", "overdue", "days_before_due"].includes(condition)) {
      throw new TypeError(`La condición de la regla ${rule.key} no está soportada`);
    }
    if (condition === "days_before_due") {
      const days = rule.condition && typeof rule.condition === "object"
        ? rule.condition.days
        : rule.days_before_due;
      if (!Number.isSafeInteger(days) || days < 0) {
        throw new TypeError(`La regla ${rule.key} debe tener days_before_due entero no negativo`);
      }
    }
    return { rule, condition };
  });
}

function invoiceIdentifier(invoice) {
  return invoice.invoice_id ?? invoice.id ?? null;
}

function customerIdentifier(customer) {
  return customer?.customer_id ?? customer?.id ?? null;
}

function isDeleted(record) {
  return record.deleted_at != null || record.deletedAt != null || record.active === false;
}

function noEligibleResult(invoice, reason) {
  return {
    invoiceId: invoiceIdentifier(invoice),
    customerId: invoice.customer_id ?? invoice.customerId ?? null,
    invoice: { ...invoice },
    stage: "no_eligible",
    priority: null,
    reason,
    eligible: false,
    stageCandidates: [],
  };
}

function ruleMatches(rule, condition, daysUntilDue) {
  if (!rule.active) return false;
  if (condition === "overdue") return daysUntilDue < 0;
  if (condition === "due_today") return daysUntilDue === 0;
  const configuredDays = rule.condition && typeof rule.condition === "object"
    ? rule.condition.days
    : rule.days_before_due;
  return daysUntilDue === configuredDays;
}

function reasonForRule(rule, condition) {
  if (typeof rule.reason === "string" && rule.reason.trim()) return rule.reason;
  if (condition === "overdue") return "Factura vencida con saldo pendiente.";
  if (condition === "due_today") return "La factura vence hoy.";
  const days = rule.condition && typeof rule.condition === "object"
    ? rule.condition.days
    : rule.days_before_due;
  if (rule.key === "prompt_payment") {
    return "La factura se encuentra dentro de la ventana configurada de pronto pago.";
  }
  return `Faltan ${days} días para el vencimiento.`;
}

function compareIdentifier(left, right) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
  return String(left).localeCompare(String(right));
}

function compareInvoiceCandidates(left, right, referenceDay) {
  if (left.priority !== right.priority) return right.priority - left.priority;
  const leftDue = parseDateDay(left.invoice.due_date ?? left.invoice.dueDate, "invoice.due_date");
  const rightDue = parseDateDay(right.invoice.due_date ?? right.invoice.dueDate, "invoice.due_date");
  const distanceDifference = Math.abs(leftDue - referenceDay) - Math.abs(rightDue - referenceDay);
  if (distanceDifference !== 0) return distanceDifference;
  const balanceDifference = parseBalanceCents(right.invoice.balance) - parseBalanceCents(left.invoice.balance);
  if (balanceDifference !== 0n) return balanceDifference > 0n ? 1 : -1;
  return compareIdentifier(left.invoiceId ?? "", right.invoiceId ?? "");
}

/**
 * Classifies one invoice against supplied rules. The result is new data and
 * never adds or changes properties on the input invoice.
 */
export function evaluateCollectionInvoice({ referenceDate, invoice, rules }) {
  const referenceDay = parseDateDay(referenceDate, "referenceDate");
  if (!invoice || typeof invoice !== "object") throw new TypeError("invoice debe ser un objeto");
  const normalizedRules = validateRules(rules);

  if (isDeleted(invoice)) return noEligibleResult(invoice, "La factura no está activa.");
  const balanceCents = parseBalanceCents(invoice.balance);
  if (balanceCents === 0n) return noEligibleResult(invoice, "La factura no tiene saldo pendiente.");

  const dueDate = invoice.due_date ?? invoice.dueDate;
  if (dueDate === null || dueDate === undefined || dueDate === "") {
    return noEligibleResult(invoice, "La factura no tiene fecha de vencimiento.");
  }
  const dueDay = parseDateDay(dueDate, "invoice.due_date");
  const daysUntilDue = dueDay - referenceDay;
  const matches = normalizedRules
    .filter(({ rule, condition }) => ruleMatches(rule, condition, daysUntilDue))
    .map(({ rule, condition }) => ({
      stage: rule.key,
      priority: rule.priority,
      reason: reasonForRule(rule, condition),
    }))
    .sort((left, right) => right.priority - left.priority || left.stage.localeCompare(right.stage));

  if (matches.length === 0) {
    return noEligibleResult(invoice, "Ninguna regla activa aplica a esta factura.");
  }

  const selected = matches[0];
  return {
    invoiceId: invoiceIdentifier(invoice),
    customerId: invoice.customer_id ?? invoice.customerId ?? null,
    invoice: { ...invoice },
    stage: selected.stage,
    priority: selected.priority,
    reason: selected.reason,
    eligible: true,
    stageCandidates: matches,
  };
}

/** Classifies every invoice with one shared reference date and rule set. */
export function evaluateCollectionInvoices({ referenceDate, invoices, rules }) {
  parseDateDay(referenceDate, "referenceDate");
  if (!Array.isArray(invoices)) throw new TypeError("invoices debe ser un arreglo");
  const normalizedRules = validateRules(rules);
  return invoices.map((invoice) => evaluateCollectionInvoice({
    referenceDate,
    invoice,
    rules: normalizedRules.map(({ rule }) => rule),
  }));
}

/** Groups eligible invoice classifications without choosing a commercial priority. */
export function groupCollectionCandidatesByCustomer(classifiedInvoices, customers = []) {
  if (!Array.isArray(classifiedInvoices)) throw new TypeError("classifiedInvoices debe ser un arreglo");
  if (!Array.isArray(customers)) throw new TypeError("customers debe ser un arreglo");

  const customerById = new Map(customers.map((customer) => [String(customerIdentifier(customer)), customer]));
  const groups = new Map();
  for (const classified of classifiedInvoices) {
    if (!classified?.eligible || classified.customerId === null || classified.customerId === undefined) continue;
    const key = String(classified.customerId);
    if (!groups.has(key)) {
      groups.set(key, {
        customerId: classified.customerId,
        customer: customerById.get(key) || classified.invoice?.customer || { id: classified.customerId },
        invoices: [],
      });
    }
    groups.get(key).invoices.push(classified);
  }
  return [...groups.values()];
}

/** Selects the highest configured priority and a stable primary invoice. */
export function selectCustomerStage(group, referenceDate) {
  if (!group || typeof group !== "object" || !Array.isArray(group.invoices)) {
    throw new TypeError("group debe contener un arreglo invoices");
  }
  const referenceDay = parseDateDay(referenceDate, "referenceDate");
  const candidates = group.invoices.filter((invoice) => invoice?.eligible && invoice.stage !== "no_eligible");
  if (candidates.length === 0) {
    return {
      customerId: group.customerId ?? customerIdentifier(group.customer),
      customer: group.customer ?? null,
      stage: "no_eligible",
      priority: null,
      reason: "El cliente no tiene facturas elegibles para cobranza.",
      primaryInvoice: null,
      invoices: group.invoices,
      stageCandidates: [],
      eligible: false,
    };
  }

  const ranked = [...candidates].sort((left, right) => compareInvoiceCandidates(left, right, referenceDay));
  const primary = ranked[0];
  return {
    customerId: group.customerId ?? primary.customerId,
    customer: group.customer ?? null,
    stage: primary.stage,
    priority: primary.priority,
    reason: primary.reason,
    primaryInvoice: primary.invoice,
    invoices: group.invoices,
    stageCandidates: candidates.map(({ invoiceId, stage, priority, reason }) => ({ invoiceId, stage, priority, reason })),
    eligible: true,
  };
}

/** Evaluates the invoices for one customer and returns its single pipeline card. */
export function evaluateCollectionCase({ referenceDate, customer, invoices, rules }) {
  if (!customer || typeof customer !== "object") throw new TypeError("customer debe ser un objeto");
  const customerId = customerIdentifier(customer);
  if (customerId === null || customerId === undefined) throw new TypeError("customer debe tener id o customer_id");
  const classifiedInvoices = evaluateCollectionInvoices({ referenceDate, invoices, rules })
    .map((classified) => {
      if (classified.customerId !== null && String(classified.customerId) !== String(customerId)) {
        return noEligibleResult(classified.invoice, "La factura pertenece a otro cliente.");
      }
      return { ...classified, customerId, customer };
    });
  const group = {
    customerId,
    customer,
    invoices: classifiedInvoices.filter((classified) => classified.eligible),
  };
  const selection = selectCustomerStage(group, referenceDate);
  return { ...selection, classifiedInvoices };
}
