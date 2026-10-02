import {
  getAllCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer,
} from "../models/customer.model.js";

export async function listCustomers(scope) {
  return await getAllCustomers(scope);
}

export async function getCustomer(id, scope) {
  return await getCustomerById(id, scope);
}

export async function addCustomer(customer, scope) {
  return await createCustomer(customer, scope);
}

export async function editCustomer(id, customer, scope) {
  return await updateCustomer(id, customer, scope);
}

export async function removeCustomer(id, scope) {
  return await deleteCustomer(id, scope);
}