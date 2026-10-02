import { login, logout, refresh } from "../services/auth.service.js";
import { publicUser } from "../models/auth.model.js";
function setRefreshCookie(res, session, config) {
  res.cookie(config.cookieName, session.refreshToken, { ...config.cookieOptions,
    expires: session.expiresAt, maxAge: Math.max(0, session.expiresAt.getTime() - Date.now()) });
}
export function authControllers(config) {
  return {
    async login(req, res, next) {
      const { email, password } = req.body ?? {};
      if (typeof email !== "string" || email.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
          typeof password !== "string" || !password || Buffer.byteLength(password) > 1024) {
        return res.status(400).json({ success: false, message: "Email válido y contraseña son obligatorios" });
      }
      try {
        const session = await login(email.trim(), password, config, req.ip);
        setRefreshCookie(res, session, config);
        return res.status(200).json({ success: true, data: session.response });
      } catch (error) { return next(error); }
    },
    async refresh(req, res, next) {
      try {
        const session = await refresh(req.cookies?.[config.cookieName], config, req.ip);
        setRefreshCookie(res, session, config);
        return res.status(200).json({ success: true, data: session.response });
      } catch (error) {
        if (error.status === 401) res.clearCookie(config.cookieName, config.cookieOptions);
        return next(error);
      }
    },
    async logout(req, res, next) {
      try {
        await logout(req.cookies?.[config.cookieName], req.ip);
        res.clearCookie(config.cookieName, config.cookieOptions);
        return res.status(200).json({ success: true, message: "Sesión cerrada" });
      } catch (error) { return next(error); }
    },
    async me(req, res, next) {
      try { return res.status(200).json({ success: true, data: await publicUser(req.user) }); }
      catch (error) { return next(error); }
    },
  };
}
