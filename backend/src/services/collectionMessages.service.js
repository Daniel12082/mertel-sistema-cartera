import pool from "../config/database.js";
import { companyFilter, validCompanyId } from "../utils/companyScope.js";
import { getCompanyMessageTemplates } from "../models/companyConfiguration.model.js";
import { readCompanyCollection } from "./collection.service.js";
import { operationError, operationId } from "./collectionOperations.validation.js";
import { dateDay } from "./promptPayment.service.js";
import { renderMessageTemplate, templateVariables } from "../utils/messageTemplate.js";

function validateDate(value) {
  if (typeof value !== "string") throw operationError(400, "reference_date debe ser una fecha válida YYYY-MM-DD.");
  try { dateDay(value); } catch { throw operationError(400, "reference_date debe ser una fecha válida YYYY-MM-DD."); }
  return value;
}
function money(value) {
  if (value == null) return null;
  const [whole, fraction = ""] = String(value).split(".");
  return `${new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(BigInt(whole))},${fraction.padEnd(2, "0")}`;
}

// Both preview and preparation are READ ONLY, including messages/audits/operations.
export async function collectionMessage({ customerId, referenceDate, templateId, step = "templates", scope, transactionDb }, dbPool = pool) {
  if (!["templates", "preview", "prepare"].includes(step)) throw operationError(400, "Operación no válida.");
  if (!validCompanyId(scope?.companyId)) throw operationError(scope?.globalAdmin ? 400 : 403, "Se requiere contexto de empresa autorizado.");
  customerId = operationId(customerId, "customer_id");
  referenceDate = validateDate(referenceDate);
  if (step !== "templates") templateId = operationId(templateId, "template_id");
  const db = transactionDb || await dbPool.getConnection();
  try {
    if (!transactionDb) await db.query("START TRANSACTION READ ONLY");
    const [[company]] = await db.query("SELECT id FROM companies WHERE id=? AND status='active' AND deleted_at IS NULL", [scope.companyId]);
    if (!company) throw operationError(403, "Empresa no disponible.");
    const filter = companyFilter(scope, "company_id");
    const [[customer]] = await db.query(`SELECT CAST(id AS CHAR) AS id,name,nit,phone FROM customers
      WHERE id=? AND status='active' AND deleted_at IS NULL ${filter.sql}`, [customerId, ...filter.values]);
    if (!customer) throw operationError(404, "Cliente no encontrado.");
    const collection = await readCompanyCollection({ referenceDate, scope, filters: { customerId } }, db);
    const item = [...collection.customers, ...collection.non_overdue_pending.customers].find(row => String(row.customer.id) === customerId);
    const templates = (await getCompanyMessageTemplates(scope.companyId, { channel: "whatsapp", stringIds: true }, db))
      .filter(template => template.stage == null || template.stage === item?.stage);
    if (step === "templates") {
      if (!transactionDb) await db.commit();
      return templates.map(template => ({ id: template.id, name: template.name, content: template.content, stage: template.stage,
        variables: templateVariables(template.content) }));
    }
    const template = templates.find(row => row.id === templateId);
    if (!template) throw operationError(404, "Plantilla no disponible para este cliente.");
    const primary = item?.main_invoice;
    const invoice = primary?.invoice;
    const invoiceNumber = invoice?.invoice_number || null;
    const customerBalance = money(item?.total_balance);
    const daysUntilDue = primary?.days_until_due ?? null;
    const overdueDays = daysUntilDue == null ? null : Math.max(0, -daysUntilDue);
    const values = {
      nombre_cliente: customer.name || null, identificacion_cliente: customer.nit || null, telefono_cliente: customer.phone || null,
      numero_factura: invoiceNumber, fecha_factura: invoice?.issue_date || null, fecha_vencimiento: invoice?.due_date || null,
      valor_factura: money(invoice?.document_value), saldo_pendiente: customerBalance,
      dias_mora: overdueDays, dias_para_vencimiento: daysUntilDue == null ? null : Math.max(0, daysUntilDue),
      etapa_cobranza: item?.stage_label || item?.stage || null, motivo_cobranza: item?.reason || null,
      // Preserve the exact variable names already accepted by Fase 5.1 templates.
      cliente: customer.name || null, factura: invoiceNumber, saldo: customerBalance,
      cliente_nombre: customer.name || null, nit: customer.nit || null, fecha_emision: invoice?.issue_date || null,
      dias_restantes: daysUntilDue == null ? null : Math.max(0, daysUntilDue), etapa: item?.stage_label || item?.stage || null,
      empresa: scope.companyName || "MERTEL IMPORTACIONES S.A.S.",
    };
    const rendered = renderMessageTemplate(template.content, values);
    const phoneAvailable = typeof customer.phone === "string" && customer.phone.trim().length > 0;
    const emptyContent = !template.content.trim();
    const canPrepare = phoneAvailable && !emptyContent && !rendered.missing_variables.length && !rendered.unsupported_variables.length && !rendered.malformed_variables;
    if (step === "prepare" && !canPrepare) throw operationError(409, "Falta información del cliente o de las variables para preparar el mensaje.");
    if (!transactionDb) await db.commit();
    return { customer, template: { id: template.id, name: template.name }, stage: item?.stage || null, reference_date: referenceDate,
      main_invoice: invoice ? { id: String(invoice.invoice_id ?? invoice.id), invoice_number: invoice.invoice_number } : null,
      ...rendered, empty_content: emptyContent, phone_available: phoneAvailable, can_prepare: canPrepare, prepared: step === "prepare",
      notice: step === "prepare" ? "Mensaje preparado temporalmente. No se ha enviado ni guardado como envío." : "Vista previa. No se ha enviado ningún mensaje." };
  } catch (error) { if (!transactionDb) { try { await db.rollback(); } catch { /* preserve error */ } } throw error; }
  finally { if (!transactionDb) db.release(); }
}
