import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import pool from "./config/database.js";
import { loadAuthConfig } from "./config/auth.js";
import { authRoutes } from "./routes/auth.routes.js";
import { authenticateToken } from "./middleware/authenticateToken.js";
import { requireCompanyScope } from "./middleware/companyScope.js";
import customerRoutes from "./routes/customer.routes.js";
import invoiceRoutes from "./routes/invoice.routes.js";
import paymentRoutes from "./routes/payment.routes.js";
import portfolioRoutes from "./routes/portfolio.routes.js";
import adminRoutes from "./routes/admin.routes.js";
export function createApp(config = loadAuthConfig()) {
  const app = express();
  app.set("trust proxy", config.trustProxyHops);
  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      if (!origin || config.origins.includes(origin)) return callback(null, true);
      return callback(Object.assign(new Error("Origen no permitido"), { status: 403 }));
    }, credentials: true, methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }));
  app.use(express.json());
  app.use(cookieParser());
  app.get("/api/health", (req, res) => res.json({ success: true, message: "MERTEL API funcionando correctamente", timestamp: new Date().toISOString() }));
  app.get("/api/health/db", async (req, res) => {
    try { await pool.query("SELECT 1 AS connected"); return res.json({ success: true, message: "MERTEL conectado correctamente a MySQL" }); }
    catch { return res.status(500).json({ success: false, message: "No se pudo conectar a MySQL" }); }
  });
  app.use("/api/auth", authRoutes(config));
  const authenticate = authenticateToken(config);
  app.use("/api/customers", authenticate, requireCompanyScope, customerRoutes);
  app.use("/api/invoices", authenticate, requireCompanyScope, invoiceRoutes);
  app.use("/api/payments", authenticate, requireCompanyScope, paymentRoutes);
  app.use("/api/portfolio", authenticate, requireCompanyScope, portfolioRoutes);
  app.use("/api/admin", authenticate, adminRoutes);
  // There are no collection HTTP routes yet; the pure engine is unchanged.
  app.use((req, res) => res.status(404).json({ success: false, message: "Ruta no encontrada" }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = [400, 401, 403, 413].includes(error.status) ? error.status : 500;
    const message = status === 500 ? "No se pudo procesar la solicitud" :
      status === 400 ? "Datos inválidos" : status === 413 ? "Solicitud demasiado grande" : error.message;
    // Never log exception objects, SQL, request data or credentials.
    if (status === 500) console.error("Error interno procesando la solicitud");
    return res.status(status).json({ success: false, message });
  });
  return app;
}
