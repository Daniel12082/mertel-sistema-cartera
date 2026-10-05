// Official relative order. Numeric ranks are only ordinal representations.
export const MERTEL_STAGE_ORDER = Object.freeze(["overdue", "due_today", "days_before_due", "prompt_payment"]);
export const PROMPT_PAYMENT_POLICY = Object.freeze({ percentage: "3", base_calculation: "base_value", days: 10 });

export function resolveCollectionPolicy(configuration) {
  const legacy = Array.isArray(configuration);
  if (!legacy && (!configuration || configuration.version !== 2 || !Array.isArray(configuration.rules))) throw new TypeError("Configuración de cobranza incompatible");
  const rules = legacy ? configuration : configuration.rules;
  const stageOrder = legacy ? [...MERTEL_STAGE_ORDER] : configuration.stage_order;
  if (!Array.isArray(stageOrder) || stageOrder.length !== MERTEL_STAGE_ORDER.length || new Set(stageOrder).size !== stageOrder.length || stageOrder.some(key => !MERTEL_STAGE_ORDER.includes(key))) throw new TypeError("stage_order debe contener las cuatro categorías sin duplicados");
  const window = { day_type: "pending", include_issue_date: null, include_day_ten: null, ...(legacy ? {} : configuration.prompt_payment?.window) };
  if (!["pending", "calendar", "business"].includes(window.day_type)) throw new TypeError("Tipo de día de Pronto Pago inválido");
  for (const key of ["include_issue_date", "include_day_ten"]) if (window[key] !== null && typeof window[key] !== "boolean") throw new TypeError("Los límites de Pronto Pago deben ser explícitos o pendientes");
  if (!legacy && configuration.prompt_payment) {
    const prompt = configuration.prompt_payment;
    if ((prompt.percentage !== undefined && String(prompt.percentage) !== PROMPT_PAYMENT_POLICY.percentage) ||
        (prompt.days !== undefined && prompt.days !== PROMPT_PAYMENT_POLICY.days) ||
        (prompt.base_calculation !== undefined && prompt.base_calculation !== PROMPT_PAYMENT_POLICY.base_calculation)) throw new TypeError("Pronto Pago MERTEL exige 3% sobre base_value y diez días desde emisión");
  }
  return { rules, stageOrder, promptPayment: { ...PROMPT_PAYMENT_POLICY, window } };
}

export function collectionRuleCategory(rule, condition) {
  if (rule.key === "prompt_payment" || condition === "days_since_issue") return "prompt_payment";
  return condition;
}

export function collectionStageCatalog(configuration) {
  const policy = resolveCollectionPolicy(configuration);
  return policy.rules.filter(rule => rule.active).map(rule => {
    const condition = rule.key === "prompt_payment" ? "days_since_issue" : (typeof rule.condition === "object" ? rule.condition?.type : rule.condition) || rule.condition_type || (rule.days_before_due !== undefined ? "days_before_due" : rule.key);
    const category = collectionRuleCategory(rule, condition);
    const days = typeof rule.condition === "object" ? rule.condition.days : rule.days_before_due;
    const label = category === "overdue" ? "En mora" : category === "due_today" ? "Vence hoy" : category === "prompt_payment" ? "Pronto pago" : `Faltan ${days} días`;
    return { key: rule.key, label, category, priority: policy.stageOrder.length - policy.stageOrder.indexOf(category) };
  }).sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key));
}
