import pool from "../config/database.js";
import {
  comparePaymentAmountToAllocated,
  createPayment,
  getActiveAllocatedAmount,
  getAllPayments,
  hasAnyAllocationRows,
  getPaymentById,
  getPaymentForUpdate,
  updatePayment,
  userExists,
} from "../models/payment.model.js";
import {
  getAllocationById,
  getAllocationForPaymentInvoice,
  getAllocationForUpdate,
  getAllocationInvoiceId,
  getAllocationsByPayment,
  getInvoiceBalance,
  getInvoiceForUpdate,
  hasEnoughInvoiceBalance,
  hasEnoughPaymentAvailable,
  increaseInvoiceBalance,
  insertAllocation,
  reduceInvoiceBalance,
  softDeleteAllocation,
} from "../models/paymentAllocation.model.js";
import { financialError, isApplicablePayment, lockActiveCustomer, validateCompanyCustomer } from "../utils/financialIntegrity.js";
import { companyFilter, documentCompany, sameCompany, validCompanyId } from "../utils/companyScope.js";
import { moneyCents } from './collectionMoney.js';

function paymentError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function validateReferences(payment, db, scope, existing) {
  const customer = await lockActiveCustomer(payment.customer_id, db, scope);
  await validateCompanyCustomer(existing ? existing.company_id : scope.companyId ?? payment.company_id ?? customer.company_id, customer, db);
  payment.company_id = documentCompany(payment, customer, scope, existing);
  if (payment.created_by != null && !(await userExists(payment.created_by, db))) {
    throw paymentError("USER_NOT_FOUND", "Usuario creador no encontrado");
  }
}

export async function listPayments(scope) {
  return getAllPayments(scope);
}

export async function getPayment(id, scope) {
  return getPaymentById(id, scope);
}

export async function addPayment(payment, scope) {
  companyFilter(scope, "company_id");
  payment = { ...payment, created_by: scope.actorId };
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await validateReferences(payment, connection, scope);
    const id = await createPayment(payment, connection);
    const created = await getPaymentById(id, scope, connection);
    await connection.commit();
    return created;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

// Atomic composition of the existing ledger operations, usable by report review too.
export async function addPaymentWithAllocations({ payment, allocations, operationKey, payloadHash, expectedBalances, scope, transactionDb }, dbPool = pool) {
  companyFilter(scope, 'company_id');
  try {
    if (!/^[a-f\d]{64}$/.test(operationKey || '') || !/^[a-f\d]{64}$/.test(payloadHash || '') || !Array.isArray(allocations) || !allocations.length || allocations.length > 50 || moneyCents(payment.amount) <= 0n ||
      new Set(allocations.map(allocation => String(allocation.invoice_id))).size !== allocations.length || allocations.some(allocation => !validCompanyId(allocation.invoice_id) || moneyCents(allocation.amount) <= 0n) ||
      allocations.reduce((sum,allocation) => sum + moneyCents(allocation.amount),0n) > moneyCents(payment.amount)) throw new Error();
  } catch { throw financialError('INVALID_ATOMIC_PAYMENT','Pago o asignaciones inválidos.',400); }
  allocations = [...allocations].sort((a,b) => BigInt(a.invoice_id) < BigInt(b.invoice_id) ? -1 : 1);
  const connection = transactionDb || await dbPool.getConnection();
  try {
    if (!transactionDb) await connection.beginTransaction();
    payment = { ...payment, status: 'confirmed', created_by: scope.actorId };
    await validateReferences(payment, connection, scope);
    const [[prior]] = await connection.query('SELECT CAST(id AS CHAR) AS id,operation_payload_hash FROM payments WHERE company_id=? AND operation_key=? FOR UPDATE', [scope.companyId, operationKey]);
    if (prior) {
      if (prior.operation_payload_hash !== payloadHash) throw financialError('IDEMPOTENCY_CONFLICT', 'La clave ya se usó con otros datos.');
      const existing = await getPaymentById(prior.id, scope, connection);
      const existingAllocations = await getAllocationsByPayment(prior.id, scope, connection);
      if (!transactionDb) await connection.commit();
      return { payment: existing, allocations: existingAllocations, duplicate: true };
    }
    // Stable invoice order plus authoritative balance comparisons protects stale previews.
    for (const allocation of allocations) {
      const invoice = await getInvoiceForUpdate(allocation.invoice_id, connection, scope);
      if (!invoice) throw financialError('INVOICE_NOT_FOUND', 'Factura no encontrada.', 404);
      if (String(invoice.customer_id) !== String(payment.customer_id)) throw financialError('CUSTOMER_MISMATCH', 'La factura no pertenece al cliente.');
      if (['cancelled','inactive','void','paid'].includes(invoice.status) || !(await hasEnoughInvoiceBalance(invoice.balance, allocation.amount, connection))) throw financialError('INVOICE_OVERALLOCATION', 'La factura no está activa o el monto supera su saldo.');
      if (expectedBalances && String(invoice.balance) !== expectedBalances[String(allocation.invoice_id)]) throw financialError('STALE_PAYMENT_PREVIEW', 'El saldo cambió desde la vista previa. Genera nuevamente el resumen.');
    }
    const paymentId = await createPayment(payment, connection);
    await connection.query('UPDATE payments SET operation_key=?,operation_payload_hash=? WHERE id=?', [operationKey, payloadHash, paymentId]);
    const createdAllocations = [];
    for (const allocation of allocations) {
      const id = await applyPaymentAllocationInTransaction(paymentId, allocation, scope, connection);
      createdAllocations.push(await getAllocationById(id, scope, connection));
    }
    const created = await getPaymentById(paymentId, scope, connection);
    if (!transactionDb) await connection.commit();
    return { payment: created, allocations: createdAllocations, duplicate: false };
  } catch (error) { if (!transactionDb) await connection.rollback(); throw error; }
  finally { if (!transactionDb) connection.release(); }
}

export async function editPayment(id, payment, scope) {
  companyFilter(scope, "company_id");
  payment = { ...payment };
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const existing = await getPaymentForUpdate(id, connection, scope);
    if (!existing) {
      await connection.commit();
      return null;
    }

    // Resolve company inside the same transaction before checking financial history.
    payment.created_by = existing.created_by;
    await validateReferences(payment, connection, scope, existing);
    const allocated = await getActiveAllocatedAmount(id, connection);
    const hasAllocations = await hasAnyAllocationRows(id, connection);
    if (Number(allocated) > 0 && !isApplicablePayment(payment.status)) {
      throw financialError("PAYMENT_STATUS_IN_USE", "No se puede cambiar a un estado no aplicable un pago con aplicaciones activas.");
    }
    if (!(await comparePaymentAmountToAllocated(payment.amount, allocated, connection))) {
      throw paymentError("PAYMENT_AMOUNT_BELOW_ALLOCATED", "El valor del pago no puede ser menor que sus asignaciones activas");
    }
    if (hasAllocations) {
      const sameAmount = await connection.query(
        "SELECT CAST(? AS DECIMAL(15,2)) = CAST(? AS DECIMAL(15,2)) AS same_amount",
        [payment.amount, existing.amount],
      );
      if (!sameAmount[0][0].same_amount) {
        throw paymentError("PAYMENT_AMOUNT_IN_USE", "No se puede cambiar el valor de un pago con asignaciones o historial de asignaciones");
      }
      if (String(payment.customer_id) !== String(existing.customer_id)) {
        throw paymentError("PAYMENT_CUSTOMER_IN_USE", "No se puede cambiar el cliente de un pago con asignaciones o historial de asignaciones");
      }
      if (String(payment.company_id ?? null) !== String(existing.company_id)) {
        throw financialError("PAYMENT_COMPANY_IN_USE", "No se puede cambiar la empresa de un pago con aplicaciones o historial.");
      }
    }

    await updatePayment(id, payment, connection, scope);
    await connection.commit();
    return getPaymentById(id, scope);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function removePayment(id, scope) {
  const payment = await getPaymentById(id, scope);
  if (!payment) return null;
  throw paymentError("PAYMENT_DELETE_UNSUPPORTED", "Los pagos no se eliminan físicamente y esta tabla no dispone de baja lógica");
}

export async function listPaymentAllocations(paymentId, scope) {
  const payment = await getPaymentById(paymentId, scope);
  if (!payment) throw paymentError("PAYMENT_NOT_FOUND", "Pago no encontrado");
  return getAllocationsByPayment(paymentId, scope);
}

export async function applyPaymentAllocationInTransaction(paymentId, allocation, scope, connection) {
    // Preserve parent lock order: payment -> customer -> invoice -> allocation.
    // Customer locks also serialize document creation with customer deletion.
    const payment = await getPaymentForUpdate(paymentId, connection, scope);
    if (!payment) throw paymentError("PAYMENT_NOT_FOUND", "Pago no encontrado");

    if (!isApplicablePayment(payment.status)) {
      throw financialError("PAYMENT_NOT_APPLICABLE", "Solo un pago confirmado puede recibir aplicaciones de pago.");
    }
    const customer = await lockActiveCustomer(payment.customer_id, connection, scope);
    documentCompany(payment, customer, scope, payment);
    await validateCompanyCustomer(payment.company_id, customer, connection);
    const invoice = await getInvoiceForUpdate(allocation.invoice_id, connection, scope);
    if (!invoice) throw paymentError("INVOICE_NOT_FOUND", "Factura no encontrada");
    if (String(payment.customer_id) !== String(invoice.customer_id)) {
      throw paymentError("CUSTOMER_MISMATCH", "El pago y la factura pertenecen a clientes diferentes");
    }
    if (!sameCompany(payment.company_id, invoice.company_id)) {
      throw financialError("COMPANY_MISMATCH", "El pago y la factura pertenecen a empresas diferentes.");
    }
    await validateCompanyCustomer(invoice.company_id, customer, connection);

    const priorPair = await getAllocationForPaymentInvoice(paymentId, allocation.invoice_id, connection);
    if (priorPair) {
      throw paymentError("ALLOCATION_ALREADY_EXISTS", "Este pago ya tiene una asignación activa para la factura");
    }

    const allocated = await getActiveAllocatedAmount(paymentId, connection);
    if (!(await hasEnoughPaymentAvailable(payment.amount, allocated, allocation.amount, connection))) {
      throw paymentError("PAYMENT_OVERALLOCATION", "El valor supera el disponible del pago");
    }
    if (!(await hasEnoughInvoiceBalance(invoice.balance, allocation.amount, connection))) {
      throw paymentError("INVOICE_OVERALLOCATION", "El valor supera el saldo disponible de la factura");
    }

    const allocationId = await insertAllocation(paymentId, allocation.invoice_id, allocation.amount, connection);
    if (!(await reduceInvoiceBalance(allocation.invoice_id, allocation.amount, connection))) {
      throw paymentError("INVOICE_BALANCE_CONFLICT", "No fue posible actualizar el saldo de la factura");
    }

    return allocationId;
}

export async function addPaymentAllocation(paymentId, allocation, scope) {
  companyFilter(scope, "company_id");
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const allocationId = await applyPaymentAllocationInTransaction(paymentId, allocation, scope, connection);

    await connection.commit();
    const [created, updatedPayment, invoiceBalance] = await Promise.all([
      getAllocationById(allocationId, scope),
      getPaymentById(paymentId, scope),
      getInvoiceBalance(allocation.invoice_id, scope),
    ]);
    return { ...created, payment_available: updatedPayment.available_amount, invoice_balance: invoiceBalance };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function reversePaymentAllocation(paymentId, allocationId, scope) {
  const invoiceId = await getAllocationInvoiceId(paymentId, allocationId, scope);
  if (invoiceId === null) throw paymentError("ALLOCATION_NOT_FOUND", "Asignación no encontrada para este pago");

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const payment = await getPaymentForUpdate(paymentId, connection, scope);
    if (!payment) throw paymentError("PAYMENT_NOT_FOUND", "Pago no encontrado");
    const invoice = await getInvoiceForUpdate(invoiceId, connection, scope, true);
    if (!invoice) throw paymentError("INVOICE_NOT_FOUND", "Factura no encontrada");
    if (!sameCompany(payment.company_id, invoice.company_id)) throw financialError("COMPANY_MISMATCH", "El pago y la factura pertenecen a empresas diferentes.");
    const allocation = await getAllocationForUpdate(paymentId, allocationId, connection);
    if (!allocation) throw paymentError("ALLOCATION_NOT_FOUND", "Asignación no encontrada para este pago");
    if (allocation.deleted_at !== null) {
      throw paymentError("ALLOCATION_ALREADY_REVERSED", "La asignación ya fue revertida");
    }

    if (!(await softDeleteAllocation(paymentId, allocationId, connection))) {
      throw paymentError("ALLOCATION_ALREADY_REVERSED", "La asignación ya fue revertida");
    }
    if (!(await increaseInvoiceBalance(invoiceId, allocation.amount, connection))) {
      throw paymentError("INVOICE_NOT_FOUND", "Factura no encontrada");
    }

    await connection.commit();
    const [updatedPayment, invoiceBalance] = await Promise.all([
      getPaymentById(paymentId, scope),
      getInvoiceBalance(invoiceId, scope),
    ]);
    return { allocation_id: allocationId, payment_available: updatedPayment.available_amount, invoice_balance: invoiceBalance };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
