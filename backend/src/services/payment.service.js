import pool from "../config/database.js";
import {
  companyExists,
  comparePaymentAmountToAllocated,
  createPayment,
  customerExists,
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

function paymentError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function validateReferences(payment, db, existingPayment = null) {
  const customerChanged = !existingPayment || String(existingPayment.customer_id) !== String(payment.customer_id);
  if (customerChanged && !(await customerExists(payment.customer_id, db))) {
    throw paymentError("CUSTOMER_NOT_FOUND", "Cliente no encontrado");
  }
  if (payment.company_id !== null && !(await companyExists(payment.company_id, db))) {
    throw paymentError("COMPANY_NOT_FOUND", "Empresa no encontrada");
  }
  if (payment.created_by !== null && !(await userExists(payment.created_by, db))) {
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
  await validateReferences(payment, pool);
  const id = await createPayment(payment);
  return getPaymentById(id);
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
    }

    if (!(await comparePaymentAmountToAllocated(payment.amount, allocated, connection))) {
      throw paymentError("PAYMENT_AMOUNT_BELOW_ALLOCATED", "El valor del pago no puede ser menor que sus asignaciones activas");
    }
    await validateReferences(payment, connection, existing);
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

    // Lock order (payment, invoice, allocation) serializes competing
    // allocations for either parent row and avoids oversubscription.
    const payment = await getPaymentForUpdate(paymentId, connection);
    if (!payment) throw paymentError("PAYMENT_NOT_FOUND", "Pago no encontrado");

    const invoice = await getInvoiceForUpdate(allocation.invoice_id, connection);
    if (!invoice) throw paymentError("INVOICE_NOT_FOUND", "Factura no encontrada");
    if (String(payment.customer_id) !== String(invoice.customer_id)) {
      throw paymentError("CUSTOMER_MISMATCH", "El pago y la factura pertenecen a clientes diferentes");
    }

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
