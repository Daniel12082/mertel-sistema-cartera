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