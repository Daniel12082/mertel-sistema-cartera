import express from "express";
import {requestPasswordRecovery,completePasswordRecovery} from "../services/passwordRecovery.service.js";
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
  router.post("/refresh", rateLimit({ windowMs: config.rateWindowMs, limit: config.rateMax * 3,
    standardHeaders: "draft-8", legacyHeaders: false,
    message: { success: false, message: "Demasiadas solicitudes de sesión" },
  }), controller.refresh);
  const recoverLimit=rateLimit({windowMs:config.rateWindowMs,limit:5,standardHeaders:'draft-8',legacyHeaders:false,message:{success:false,message:'Demasiadas solicitudes. Intenta nuevamente más tarde.'}});
  const recovery=handler=>async(req,res)=>{try{res.json({success:true,data:await handler(req.body)});}catch(error){const status=[400,503].includes(error.status)?error.status:500;res.status(status).json({success:false,message:status===500?'No se pudo procesar la recuperaci�n. Intenta nuevamente.':error.message});}};
  router.post('/forgot-password',recoverLimit,recovery(body=>requestPasswordRecovery(body?.email)));
  router.post('/reset-password',recoverLimit,recovery(body=>completePasswordRecovery(body??{})));
  router.post("/logout", controller.logout);
  router.get("/me", authenticateToken(config, { allowSimulationAccount: true }), controller.me);
  return router;
}
