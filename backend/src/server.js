import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";

dotenv.config();

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

// Servidor
app.listen(PORT, () => {
  console.log(`MERTEL API ejecutándose en http://localhost:${PORT}`);
});