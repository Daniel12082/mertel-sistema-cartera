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
import { compatibleCompanies, financialError, isApplicablePayment, lockActiveCustomer, validateCompanyCustomer } from "../utils/financialIntegrity.js";

function paymentError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function validateReferences(payment, db) {
  const customer = await lockActiveCustomer(payment.customer_id, db);
  await validateCompanyCustomer(payment.company_id, customer, db);
  if (payment.created_by != null && !(await userExists(payment.created_by, db))) {
    throw paymentError("USER_NOT_FOUND", "Usuario creador no encontrado");
  }
}

export async function listPayments() {
  return getAllPayments();
}

export async function getPayment(id) {
  return getPaymentById(id);
}

export async function addPayment(payment) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await validateReferences(payment, connection);
    const id = await createPayment(payment, connection);
    const created = await getPaymentById(id, connection);
    await connection.commit();
    return created;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

export async function editPayment(id, payment) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const existing = await getPaymentForUpdate(id, connection);
    if (!existing) {
      await connection.commit();
      return null;
    }

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

    await validateReferences(payment, connection);
    await updatePayment(id, payment, connection);
    await connection.commit();
    return getPaymentById(id);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function removePayment(id) {
  const payment = await getPaymentById(id);
  if (!payment) return null;
  throw paymentError("PAYMENT_DELETE_UNSUPPORTED", "Los pagos no se eliminan físicamente y esta tabla no dispone de baja lógica");
}

export async function listPaymentAllocations(paymentId) {
  const payment = await getPaymentById(paymentId);
  if (!payment) throw paymentError("PAYMENT_NOT_FOUND", "Pago no encontrado");
  return getAllocationsByPayment(paymentId);
}

export async function addPaymentAllocation(paymentId, allocation) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Preserve parent lock order: payment -> customer -> invoice -> allocation.
    // Customer locks also serialize document creation with customer deletion.
    const payment = await getPaymentForUpdate(paymentId, connection);
    if (!payment) throw paymentError("PAYMENT_NOT_FOUND", "Pago no encontrado");

    if (!isApplicablePayment(payment.status)) {
      throw financialError("PAYMENT_NOT_APPLICABLE", "Solo un pago confirmado puede recibir aplicaciones de pago.");
    }
    const customer = await lockActiveCustomer(payment.customer_id, connection);
    await validateCompanyCustomer(payment.company_id, customer, connection);
    const invoice = await getInvoiceForUpdate(allocation.invoice_id, connection);
    if (!invoice) throw paymentError("INVOICE_NOT_FOUND", "Factura no encontrada");
    if (String(payment.customer_id) !== String(invoice.customer_id)) {
      throw paymentError("CUSTOMER_MISMATCH", "El pago y la factura pertenecen a clientes diferentes");
    }
    if (!compatibleCompanies(payment.company_id, invoice.company_id)) {
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

    await connection.commit();
    const [created, updatedPayment, invoiceBalance] = await Promise.all([
      getAllocationById(allocationId),
      getPaymentById(paymentId),
      getInvoiceBalance(allocation.invoice_id),
    ]);
    return { ...created, payment_available: updatedPayment.available_amount, invoice_balance: invoiceBalance };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function reversePaymentAllocation(paymentId, allocationId) {
  const invoiceId = await getAllocationInvoiceId(paymentId, allocationId);
  if (invoiceId === null) throw paymentError("ALLOCATION_NOT_FOUND", "Asignación no encontrada para este pago");

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const payment = await getPaymentForUpdate(paymentId, connection);
    if (!payment) throw paymentError("PAYMENT_NOT_FOUND", "Pago no encontrado");
    const invoice = await getInvoiceForUpdate(invoiceId, connection, true);
    if (!invoice) throw paymentError("INVOICE_NOT_FOUND", "Factura no encontrada");
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
      getPaymentById(paymentId),
      getInvoiceBalance(invoiceId),
    ]);
    return { allocation_id: allocationId, payment_available: updatedPayment.available_amount, invoice_balance: invoiceBalance };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
