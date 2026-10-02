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
    return (
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 9999999999999.99 &&
      Number(value.toFixed(2)) === value
    );
  }

  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    /^\d{1,13}(\.\d{1,2})?$/.test(value.trim())
  );
}

function isValidOptionalPositiveId(value) {
  return value === undefined || value === null ||
    (Number.isSafeInteger(value) && value > 0);
}

function isValidOptionalInteger(value) {
  return value === undefined || value === null ||
    (Number.isSafeInteger(value) && value >= 0);
}

function isValidOptionalString(value) {
  return value === undefined || value === null || typeof value === "string";
}

function isValidOptionalEmail(value) {
  if (value === undefined || value === null || value === "") {
    return true;
  }

  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidOptionalDate(value) {
  if (value === undefined || value === null) {
    return true;
  }

  const match = typeof value === "string"
    ? value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    : null;
  if (!match) {
    return false;
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);

  return (
    year >= 1000 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function hasRequiredInvoiceFields(body) {
  return (
    Number.isSafeInteger(body?.customer_id) &&
    body.customer_id > 0 &&
    typeof body?.invoice_number === "string" &&
    body.invoice_number.trim().length > 0 &&
    isValidMoney(body?.document_value) &&
    Number(body.document_value) > 0 &&
    isValidMoney(body?.base_value) &&
    isValidMoney(body?.iva_value) &&
    (body?.promo_18 === undefined || body.promo_18 === null || isValidMoney(body.promo_18)) &&
    (body?.discount === undefined || body.discount === null || isValidMoney(body.discount)) &&
    isValidOptionalDate(body?.issue_date) &&
    isValidOptionalDate(body?.due_date) &&
    isValidOptionalPositiveId(body?.company_id) &&
    isValidOptionalInteger(body?.credit_days) &&
    isValidOptionalString(body?.status) &&
    (body?.status === undefined || body.status === null || body.status.trim() !== "") &&
    isValidOptionalString(body?.notes) &&
    isValidOptionalEmail(body?.email)
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
    if (error.status) return res.status(error.status).json({ success: false, message: error.message });
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ success: false, message: "Ya existe una factura con ese número y empresa" });
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
    if (error.status) return res.status(error.status).json({ success: false, message: error.message });
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ success: false, message: "Ya existe una factura con ese número y empresa" });
    if (error.code === "INVOICE_VALUE_BELOW_ALLOCATIONS") {
      return res.status(409).json({
        success: false,
        message: "El valor del documento no puede ser menor que las asignaciones activas",
      });
    }
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
    if (error.status) return res.status(error.status).json({ success: false, message: error.message });
    console.error("Error eliminando factura:", error);
    return res.status(500).json({
      success: false,
      message: "No se pudo eliminar la factura",
    });
  }
}
