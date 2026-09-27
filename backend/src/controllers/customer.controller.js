import {
  listCustomers,
  addCustomer,
} from "../services/customer.service.js";

export async function getCustomers(req, res) {
  try {
    const customers = await listCustomers();

    res.json({
      success: true,
      data: customers,
    });
  } catch (error) {
    console.error("Error obteniendo clientes:", error);

    res.status(500).json({
      success: false,
      message: "No se pudieron obtener los clientes",
    });
  }
}

export async function createCustomer(req, res) {
  try {
    const { nit, name } = req.body;

    if (!nit || !name) {
      return res.status(400).json({
        success: false,
        message: "El NIT y el nombre del cliente son obligatorios",
      });
    }

    const customer = await addCustomer(req.body);

    res.status(201).json({
      success: true,
      data: customer,
    });
  } catch (error) {
    console.error("Error creando cliente:", error);

    res.status(500).json({
      success: false,
      message: "No se pudo crear el cliente",
    });
  }
}