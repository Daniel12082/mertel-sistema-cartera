import {
  listInvoices,
  getInvoice,
  addInvoice,
  editInvoice,
  removeInvoice,
} from "../services/invoice.service.js";

function parsePositiveId(value) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    return null;
  }

  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function isValidMoney(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0;
  }

  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    /^\d+(\.\d{1,2})?$/.test(value.trim())
  );
}

function hasRequiredInvoiceFields(body) {
  return (
    Number.isSafeInteger(body?.customer_id) &&
    body.customer_id > 0 &&
    typeof body?.invoice_number === "string" &&
    body.invoice_number.trim().length > 0 &&
    isValidMoney(body?.document_value) &&
    isValidMoney(body?.base_value) &&
    isValidMoney(body?.iva_value)
  );
}

export async function getInvoices(req, res) {
  try {
    const invoices = await listInvoices();
    return res.status(200).json({ success: true, data: invoices });
  } catch (error) {
    console.error("Error obteniendo facturas:", error);
    return res.status(500).json({
      success: false,
      message: "No se pudieron obtener las facturas",
    });
  }
}

export async function getInvoiceById(req, res) {
  const id = parsePositiveId(req.params.id);
  if (id === null) {
    return res.status(400).json({ success: false, message: "ID inválido" });
  }

  try {
    const invoice = await getInvoice(id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: "Factura no encontrada" });
    }
    return res.status(200).json({ success: true, data: invoice });
  } catch (error) {
    console.error("Error obteniendo factura:", error);
    return res.status(500).json({
      success: false,
      message: "No se pudo obtener la factura",
    });
  }
}

export async function createInvoice(req, res) {
  if (!hasRequiredInvoiceFields(req.body)) {
    return res.status(400).json({
      success: false,
      message: "Cliente, número y valores de factura son obligatorios y válidos",
    });
  }

  try {
    const invoice = await addInvoice(req.body);
    return res.status(201).json({ success: true, data: invoice });
  } catch (error) {
    if (error.code === "CUSTOMER_NOT_FOUND" || error.code === "ER_NO_REFERENCED_ROW_2") {
      return res.status(404).json({ success: false, message: "Cliente no encontrado" });
    }

    console.error("Error creando factura:", error);
    return res.status(500).json({
      success: false,
      message: "No se pudo crear la factura",
    });
  }
}

export async function updateInvoice(req, res) {
  const id = parsePositiveId(req.params.id);
  if (id === null) {
    return res.status(400).json({ success: false, message: "ID inválido" });
  }

  if (!hasRequiredInvoiceFields(req.body)) {
    return res.status(400).json({
      success: false,
      message: "Cliente, número y valores de factura son obligatorios y válidos",
    });
  }

  try {
    const invoice = await editInvoice(id, req.body);
    if (!invoice) {
      return res.status(404).json({ success: false, message: "Factura no encontrada" });
    }
    return res.status(200).json({ success: true, data: invoice });
  } catch (error) {
    if (error.code === "CUSTOMER_NOT_FOUND" || error.code === "ER_NO_REFERENCED_ROW_2") {
      return res.status(404).json({ success: false, message: "Cliente no encontrado" });
    }

    console.error("Error actualizando factura:", error);
    return res.status(500).json({
      success: false,
      message: "No se pudo actualizar la factura",
    });
  }
}

export async function deleteInvoice(req, res) {
  const id = parsePositiveId(req.params.id);
  if (id === null) {
    return res.status(400).json({ success: false, message: "ID inválido" });
  }

  try {
    const deleted = await removeInvoice(id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Factura no encontrada" });
    }
    return res.status(200).json({ success: true, message: "Factura eliminada correctamente" });
  } catch (error) {
    console.error("Error eliminando factura:", error);
    return res.status(500).json({
      success: false,
      message: "No se pudo eliminar la factura",
    });
  }
}
