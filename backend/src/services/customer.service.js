import { getAllCustomers } from "../models/customer.model.js";

export async function listCustomers() {
  return await getAllCustomers();
}