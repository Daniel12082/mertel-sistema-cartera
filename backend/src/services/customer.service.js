import {
  getAllCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer,
} from "../models/customer.model.js";

export async function listCustomers() {
  return await getAllCustomers();
}

export async function getCustomer(id) {
  return await getCustomerById(id);
}

export async function addCustomer(customer) {
  return await createCustomer(customer);
}

export async function editCustomer(id, customer) {
  return await updateCustomer(id, customer);
}

export async function removeCustomer(id) {
  return await deleteCustomer(id);
}