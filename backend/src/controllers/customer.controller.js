import { listCustomers } from "../services/customer.service.js";

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