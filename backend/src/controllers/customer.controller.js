import {
  listCustomers,
  getCustomer,
  addCustomer,
  editCustomer,
  removeCustomer,
} from "../services/customer.service.js";

function parseCustomerId(value) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    return null;
  }

  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function hasRequiredCustomerFields(body) {
  return (
    typeof body?.nit === "string" &&
    body.nit.trim().length > 0 &&
    typeof body?.name === "string" &&
    body.name.trim().length > 0
  );
}

export async function getCustomers(req, res) {
  try {
    const customers = await listCustomers(req.companyScope);
    return res.status(200).json({ success: true, data: customers });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ success: false, message: error.message });
    console.error("Error obteniendo clientes:", error);
    return res.status(500).json({
      success: false,
      message: "No se pudieron obtener los clientes",
    });
  }
}

export async function createCustomer(req, res) {
  if (!hasRequiredCustomerFields(req.body)) {
    return res.status(400).json({
      success: false,
      message: "El NIT y el nombre del cliente son obligatorios",
    });
  }

  try {
    const customer = await addCustomer(req.body, req.companyScope);
    return res.status(201).json({ success: true, data: customer });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ success: false, message: error.message });
    console.error("Error creando cliente:", error);
    return res.status(500).json({
      success: false,
      message: "No se pudo crear el cliente",
    });
  }
}

export async function getCustomerById(req, res) {
  const id = parseCustomerId(req.params.id);
  if (id === null) {
    return res.status(400).json({ success: false, message: "ID inválido" });
  }

  try {
    const customer = await getCustomer(id, req.companyScope);
    if (!customer) {
      return res.status(404).json({ success: false, message: "Cliente no encontrado" });
    }
    return res.status(200).json({ success: true, data: customer });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ success: false, message: error.message });
    console.error("Error obteniendo cliente:", error);
    return res.status(500).json({
      success: false,
      message: "No se pudo obtener el cliente",
    });
  }
}

export async function updateCustomer(req, res) {
  const id = parseCustomerId(req.params.id);
  if (id === null) {
    return res.status(400).json({ success: false, message: "ID inválido" });
  }
  if (!hasRequiredCustomerFields(req.body)) {
    return res.status(400).json({
      success: false,
      message: "El NIT y el nombre del cliente son obligatorios",
    });
  }

  try {
    const customer = await editCustomer(id, req.body, req.companyScope);
    if (!customer) {
      return res.status(404).json({ success: false, message: "Cliente no encontrado" });
    }
    return res.status(200).json({ success: true, data: customer });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ success: false, message: error.message });
    console.error("Error actualizando cliente:", error);
    return res.status(500).json({
      success: false,
      message: "No se pudo actualizar el cliente",
    });
  }
}

export async function deleteCustomer(req, res) {
  const id = parseCustomerId(req.params.id);
  if (id === null) {
    return res.status(400).json({ success: false, message: "ID inválido" });
  }

  try {
    const deleted = await removeCustomer(id, req.companyScope);
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Cliente no encontrado" });
    }
    return res.status(200).json({ success: true, message: "Cliente eliminado correctamente" });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ success: false, message: error.message });
    console.error("Error eliminando cliente:", error);
    return res.status(500).json({
      success: false,
      message: "No se pudo eliminar el cliente",
    });
  }
}
