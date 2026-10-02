import { PERMISSIONS } from "../config/permissions.js";
export function requirePermission(permission) {
  if (!PERMISSIONS.some(item => item.name === permission && item.implemented)) throw new TypeError("Permiso inexistente o pendiente de implementación");
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, message: "Autenticación requerida" });
    if (!req.user.permissions?.includes(permission)) return res.status(403).json({ success: false, message: "No tienes permiso para esta operación" });
    return next();
  };
}
