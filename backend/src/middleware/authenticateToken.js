import { findUserById, isActiveUser } from "../models/auth.model.js";
import { verifyAccessToken } from "../services/auth.service.js";
export function authenticateToken(config) {
  return async (req, res, next) => {
    const header = req.get("Authorization");
    const match = typeof header === "string" ? header.match(/^Bearer ([A-Za-z0-9_.-]+)$/i) : null;
    if (!match || match[1].length > 4096) return res.status(401).json({ success: false, message: "Autenticación requerida" });
    let userId;
    try { userId = verifyAccessToken(match[1], config); }
    catch { return res.status(401).json({ success: false, message: "Sesión inválida o expirada" }); }
    try {
      const user = await findUserById(userId);
      if (!isActiveUser(user)) return res.status(401).json({ success: false, message: "Sesión inválida o expirada" });
      req.user = user; return next();
    } catch { return next(new Error("No se pudo verificar la sesión")); }
  };
}
