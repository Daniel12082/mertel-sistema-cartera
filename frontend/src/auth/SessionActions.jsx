import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { useAuth } from "./useAuth";
import "./SessionActions.css";

export default function SessionActions() {
  const { user, logout } = useAuth();
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);
  const navigate = useNavigate();
  async function signOut() {
    if (busy.current) return;
    busy.current = true; setLoading(true);
    try { await logout(); navigate("/login", { replace: true }); }
    catch { navigate("/login", { replace: true, state: { logoutFailed: true } }); }
    finally { busy.current = false; setLoading(false); }
  }
  return <div className="session-actions">
    <span>{user?.name || user?.email}</span>
    <button type="button" onClick={signOut} disabled={loading}><LogOut size={17} aria-hidden="true" />{loading ? "Cerrando sesión…" : "Cerrar sesión"}</button>
  </div>;
}
