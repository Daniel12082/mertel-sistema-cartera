import { findUserById, isActiveUser, userRoles } from "../models/auth.model.js";
import { permissionsForRoles } from "../config/permissions.js";
import { verifyAccessToken } from "../services/auth.service.js";
import { isSimulationAccount } from '../utils/simulationAccount.js';
export function authenticateToken(config, { allowSimulationAccount = false } = {}) {
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
      const roles = await userRoles(user.id);
      if (isSimulationAccount(roles) && !allowSimulationAccount) {
        return res.status(403).json({ success: false, code: 'SIMULATION_ACCOUNT_ONLY', message: 'Esta cuenta solo utiliza datos de demostración. No tiene acceso a la operación real.' });
      }
      req.user = { ...user, roles, permissions: permissionsForRoles(roles) }; return next();
    } catch { return next(new Error("No se pudo verificar la sesión")); }
  };
}
