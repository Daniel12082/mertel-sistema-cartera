import { NavLink, Outlet } from "react-router-dom";
import SessionActions from "../auth/SessionActions";
import {
  LayoutDashboard,
  Users,
  FileText,
  WalletCards,
  ClipboardCheck,
  CreditCard,
  BarChart3,
  Settings,
  MessageSquareText,
  SlidersHorizontal,
  FileSpreadsheet,
  SearchCheck,
  Gauge,
} from "lucide-react";
import { useAuth } from "../auth/useAuth";

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
  const { permissions = [] } = useAuth();
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
          {(permissions.includes("message_templates.manage") || permissions.includes("settings.manage") || permissions.includes("portfolio.import")) && <div className="mertel-navigation-group">
            <span>Administración</span>
            {permissions.includes("settings.manage") && <NavLink to="/administracion/whatsapp" className={({ isActive }) =>
              `mertel-nav-item ${isActive ? "active" : ""}`}><MessageSquareText size={19} strokeWidth={2} /><span>WhatsApp</span></NavLink>}
            {permissions.includes("collection.view") && permissions.includes("settings.manage") && <NavLink to="/administracion/dashboard-cobranza" className={({ isActive }) =>
              `mertel-nav-item ${isActive ? "active" : ""}`}><Gauge size={19} strokeWidth={2} /><span>Dashboard de cobranza</span></NavLink>}
            {permissions.includes("history.view") && permissions.includes("settings.manage") && <NavLink to="/administracion/historial-cobranza" className={({ isActive }) =>
              `mertel-nav-item ${isActive ? "active" : ""}`}><ClipboardCheck size={19} strokeWidth={2} /><span>Historial de cobranza</span></NavLink>}
            {permissions.includes("settings.manage") && <NavLink to="/administracion/configuracion-cobranza" className={({ isActive }) =>
              `mertel-nav-item ${isActive ? "active" : ""}`}>
              <SlidersHorizontal size={19} strokeWidth={2} />
              <span>Configuración de cobranza</span>
            </NavLink>}
            {permissions.includes("portfolio.import") && <NavLink to="/administracion/importar-cartera" className={({ isActive }) =>
              `mertel-nav-item ${isActive ? "active" : ""}`}>
              <FileSpreadsheet size={19} strokeWidth={2} />
              <span>Importar cartera</span>
            </NavLink>}
            {permissions.includes("portfolio.import") && <NavLink to="/administracion/resolucion-clientes" className={({ isActive }) =>
              `mertel-nav-item ${isActive ? "active" : ""}`}><SearchCheck size={19} strokeWidth={2} /><span>Resolución de clientes</span></NavLink>}
            {permissions.includes("message_templates.manage") && <NavLink to="/administracion/plantillas-whatsapp" className={({ isActive }) =>
              `mertel-nav-item ${isActive ? "active" : ""}`}>
              <MessageSquareText size={19} strokeWidth={2} />
              <span>Plantillas WhatsApp</span>
            </NavLink>}
          </div>}
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
          <SessionActions />
        </header>

        <main className="mertel-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default MainLayout;
