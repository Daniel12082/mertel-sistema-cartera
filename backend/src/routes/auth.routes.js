import express from "express";
import { rateLimit } from "express-rate-limit";
import { authControllers } from "../controllers/auth.controller.js";
import { authenticateToken } from "../middleware/authenticateToken.js";
export function authRoutes(config) {
  const router = express.Router();
  const controller = authControllers(config);
  router.use((req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  // JSON-only mutations plus exact Origin checks prevent form CSRF.
  router.use((req, res, next) => {
    if (req.method === "POST" && (!req.is("application/json") ||
        (req.get("Sec-Fetch-Site") === "cross-site" && !req.get("Origin")))) {
      return res.status(403).json({ success: false, message: "Solicitud de autenticación no permitida" });
    }
    return next();
  });
  router.post("/login", rateLimit({ windowMs: config.rateWindowMs, limit: config.rateMax,
    standardHeaders: "draft-8", legacyHeaders: false, skipSuccessfulRequests: true,
    message: { success: false, message: "Demasiados intentos de acceso. Inténtalo más tarde." },
  }), controller.login);
  router.post("/refresh", controller.refresh);
  router.post("/logout", controller.logout);
  router.get("/me", authenticateToken(config), controller.me);
  return router;
}
