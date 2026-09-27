import { NavLink, Outlet } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  FileText,
  WalletCards,
  ClipboardCheck,
  CreditCard,
  BarChart3,
  Settings,
} from "lucide-react";

const navigation = [
  { label: "Dashboard", path: "/", icon: LayoutDashboard },
  { label: "Clientes", path: "/clientes", icon: Users },
  { label: "Facturas", path: "/facturas", icon: FileText },
  { label: "Cartera", path: "/cartera", icon: WalletCards },
  { label: "Cobranza", path: "/cobranza", icon: ClipboardCheck },
  { label: "Pagos", path: "/pagos", icon: CreditCard },
  { label: "Reportes", path: "/reportes", icon: BarChart3 },
  { label: "Configuración", path: "/configuracion", icon: Settings },
];

function MainLayout() {
  return (
    <div className="mertel-layout">
      <aside className="mertel-sidebar">
        <div className="mertel-brand">
          <div className="mertel-brand-mark">M</div>

          <div className="mertel-brand-copy">
            <strong>MERTEL</strong>
            <span>Gestión de cartera</span>
          </div>
        </div>

        <nav className="mertel-navigation" aria-label="Navegación principal">
          {navigation.map(({ label, path, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              end={path === "/"}
              className={({ isActive }) =>
                `mertel-nav-item ${isActive ? "active" : ""}`
              }
            >
              <Icon size={19} strokeWidth={2} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="mertel-sidebar-footer">
          <span>Panel de cartera</span>
          <small>Versión 1.0</small>
        </div>
      </aside>

      <div className="mertel-main">
        <header className="mertel-header">
          <div>
            <h1>MERTEL</h1>
            <span>Sistema de gestión de cartera</span>
          </div>
        </header>

        <main className="mertel-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default MainLayout;
