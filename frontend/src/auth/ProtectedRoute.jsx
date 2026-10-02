import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./useAuth";
import "../pages/Login/Login.css";

export function SessionLoading() {
  return <main className="login-screen session-loading" role="status">Verificando sesión…</main>;
}
export default function ProtectedRoute() {
  const { user, initializing } = useAuth();
  if (initializing) return <SessionLoading />;
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}
