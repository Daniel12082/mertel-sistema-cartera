import {
  getAllCustomers,
  createCustomer,
} from "../models/customer.model.js";

export async function listCustomers() {
  return await getAllCustomers();
}

export async function addCustomer(customer) {
  return await createCustomer(customer);
}