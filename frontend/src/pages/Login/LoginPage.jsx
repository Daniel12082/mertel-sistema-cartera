import { Navigate, useLocation } from "react-router-dom";
import { ChartNoAxesCombined, FileText, WalletCards } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { SessionLoading } from "../../auth/ProtectedRoute";
import logo from "../../assets/login/mertel-logo.png";
import LoginForm from "./LoginForm";
import "./Login.css";

export default function LoginPage() {
  const { user, initializing } = useAuth();
  const { state } = useLocation();
  if (initializing) return <SessionLoading />;
  if (user) return <Navigate to="/" replace />;
  return <main className="login-screen">
    <div className="login-card">
      <section className="login-brand-panel" aria-labelledby="login-brand-title">
        <div className="login-brand-content">
          <img className="login-brand-logo" src={logo} alt="MERTEL Importaciones s.a.s." />
          <div className="login-brand-heading">
            <span className="login-red-rule" aria-hidden="true" />
            <h2 id="login-brand-title">Gestión inteligente<br /><span>de cartera</span></h2>
            <p>Controla, gestiona y da seguimiento<br className="login-desktop-break" /> a tu cartera desde un solo lugar.</p>
          </div>
          <ul className="login-benefits">
            <li><span><ChartNoAxesCombined size={28} aria-hidden="true" /></span>Gestión<br />de cartera</li>
            <li><span><FileText size={28} aria-hidden="true" /></span>Cobranza<br />inteligente</li>
            <li><span><WalletCards size={28} aria-hidden="true" /></span>Control<br />financiero</li>
          </ul>
        </div>
      </section>
      <section className="login-form-panel" aria-labelledby="login-title">
        <img className="login-form-logo" src={logo} alt="MERTEL Importaciones s.a.s." />
        <header className="login-welcome"><h1 id="login-title">Bienvenido</h1><p>Inicia sesión para continuar</p></header>
        <LoginForm />
        {state?.logoutFailed && <p className="login-message" role="alert">La sesión local se cerró, pero no fue posible confirmar el cierre con el servidor. Intenta nuevamente cuando se restablezca la conexión.</p>}
      </section>
    </div>
  </main>;
}
