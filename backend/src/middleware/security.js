import { rateLimit } from 'express-rate-limit';

export function transportSecurity(config) {
  return (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (config.cookieOptions.secure && !req.secure) {
      return res.status(403).json({ success: false, message: 'Se requiere HTTPS' });
    }
    next();
  };
}
export function apiRateLimit() {
  return rateLimit({ windowMs: 60000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { success: false, message: 'Demasiadas solicitudes. Inténtalo más tarde.' } });
}

// Reject structural attacks without altering legitimate business text.
export function validateRequestStructure(req, res, next) {
  let nodes = 0;
  function inspect(value, depth = 0) {
    if (++nodes > 10000 || depth > 20) throw new Error();
    if (typeof value === 'string' && /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error();
    if (!value || typeof value !== 'object' || Buffer.isBuffer(value)) return;
    for (const key of Object.keys(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error();
      inspect(value[key], depth + 1);
    }
  }
  try { inspect(req.body); inspect(req.query); return next(); }
  catch { return res.status(400).json({ success: false, message: 'Estructura de datos no permitida' }); }
}
