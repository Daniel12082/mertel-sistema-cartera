function parseDateOnly(value, fieldName) {
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

  const parsed = new Date(0);
  parsed.setUTCFullYear(year, month - 1, day);
  parsed.setUTCHours(0, 0, 0, 0);
  if (
    year < 1000 ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new TypeError(`${fieldName} no es una fecha de calendario válida`);
  }
  return Math.floor(parsed.getTime() / 86_400_000);
}

function moneyToCents(value) {
  const text = typeof value === "number" && Number.isFinite(value)
    ? value.toString()
    : value;
  if (typeof text !== "string" || !/^\d{1,13}(?:\.\d{1,2})?$/.test(text)) {
    throw new TypeError("balance debe ser un monto DECIMAL(15,2) no negativo");
  }
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
}

export function calculatePortfolioState({ dueDate, balance, referenceDate }) {
  const referenceDay = parseDateOnly(referenceDate, "referenceDate");
  const balanceCents = moneyToCents(balance);

  if (balanceCents === 0n) {
    return { portfolio_status: "paid", days_overdue: null, days_until_due: null };
  }
  if (dueDate === null || dueDate === undefined || dueDate === "") {
    return { portfolio_status: "no_due_date", days_overdue: null, days_until_due: null };
  }

  const dueDay = parseDateOnly(dueDate, "dueDate");
  const dayDifference = dueDay - referenceDay;
  if (dayDifference > 0) {
    return { portfolio_status: "current", days_overdue: 0, days_until_due: dayDifference };
  }
  if (dayDifference === 0) {
    return { portfolio_status: "due_today", days_overdue: 0, days_until_due: 0 };
  }
  return { portfolio_status: "overdue", days_overdue: -dayDifference, days_until_due: null };
}
