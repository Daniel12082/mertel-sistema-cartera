import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import pool from "./config/database.js";

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(helmet());
app.use(cors());
app.use(express.json());

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "MERTEL API funcionando correctamente",
    timestamp: new Date().toISOString(),
  });
});

// Health check de base de datos
app.get("/api/health/db", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT 1 AS connected");

    res.json({
      success: true,
      message: "MERTEL conectado correctamente a MySQL",
      database: process.env.DB_NAME,
      result: rows[0],
    });
  } catch (error) {
    console.error("Error de conexión a MySQL:", error);

    res.status(500).json({
      success: false,
      message: "No se pudo conectar a MySQL",
    });
  }
});

// Servidor
app.listen(PORT, () => {
  console.log(`MERTEL API ejecutándose en http://localhost:${PORT}`);
});