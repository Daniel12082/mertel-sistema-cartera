import pool from "../config/database.js";
import { validCompanyId } from "../utils/companyScope.js";
import { operationError, operationId, validateOperation } from "./collectionOperations.validation.js";
import { auditOperation, insertOperation, listOperations, operationCustomer, operationInvoice } from "../models/collectionOperations.model.js";

export async function collectionOperation({ kind, customerId, invoiceId = null, body, scope, transactionDb }, dbPool = pool) {
  if (!["action", "promise"].includes(kind)) throw operationError(400, "Operación no válida.");
  if (!validCompanyId(scope?.companyId)) throw operationError(scope?.globalAdmin ? 400 : 403, "La gestión manual requiere contexto de empresa autorizado.");
  customerId = operationId(customerId, "customer_id");
  const writing = body !== undefined;
  const data = writing ? validateOperation(kind, body) : null;
  invoiceId = writing ? data.invoice_id : invoiceId == null ? null : operationId(invoiceId, "invoice_id");
  if (writing && !validCompanyId(scope.actorId)) throw operationError(403, "Usuario de operación no válido.");
  const db = transactionDb || await dbPool.getConnection();
  try {
    if (!transactionDb) { if (writing) await db.beginTransaction(); else await db.query("START TRANSACTION READ ONLY"); }
    const customer = await operationCustomer(customerId, scope, db, writing);
    if (!customer) throw operationError(404, "Cliente no encontrado.");
    if (writing && customer.status !== "active") throw operationError(409, "El cliente no está activo para registrar operaciones.");
    if (invoiceId && !(await operationInvoice(invoiceId, customerId, scope, db, writing))) throw operationError(404, "Factura no encontrada para este cliente.");
    let id;
    if (writing) { id = await insertOperation(kind, customerId, data, scope, db); await auditOperation(kind, id, customerId, data, scope, db); }
    const result = await listOperations(kind, customerId, invoiceId, scope, db);
    if (!transactionDb) await db.commit();
    return writing ? result.find(item => item.id === id) : result;
  } catch (error) {
    if (!transactionDb) { try { await db.rollback(); } catch { /* preserve failure */ } }
    throw error;
  } finally { if (!transactionDb) db.release(); }
}
