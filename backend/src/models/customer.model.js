import pool from "../config/database.js";

export async function getAllCustomers() {
  const [rows] = await pool.query(`
    SELECT
      id,
      company_id,
      nit,
      name,
      phone,
      email,
      address,
      city,
      credit_limit,
      available_credit,
      status,
      notes,
      created_at,
      updated_at
    FROM customers
    WHERE deleted_at IS NULL
    ORDER BY name ASC
  `);

  return rows;
}

export async function createCustomer(customer) {
  const {
    company_id = null,
    nit,
    name,
    phone = null,
    email = null,
    address = null,
    city = null,
    credit_limit = 0,
    available_credit = 0,
    status = "active",
    notes = null,
  } = customer;

  const [result] = await pool.query(
    `
      INSERT INTO customers (
        company_id,
        nit,
        name,
        phone,
        email,
        address,
        city,
        credit_limit,
        available_credit,
        status,
        notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      company_id,
      nit,
      name,
      phone,
      email,
      address,
      city,
      credit_limit,
      available_credit,
      status,
      notes,
    ],
  );

  return {
    id: result.insertId,
    ...customer,
  };
}