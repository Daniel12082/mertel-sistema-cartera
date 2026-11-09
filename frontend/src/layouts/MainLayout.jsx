import { NavLink, Outlet } from "react-router-dom";
import SimulationControls from '../simulation/SimulationControls';
import { simulationAvailable } from '../simulation/store';
import { useAppDataMode } from '../simulation/useAppDataMode';
import { useAppearance } from '../appearance/appearance.context';
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
  const { mode } = useAppDataMode();
  const { appearance } = useAppearance();
  return (
    <div className="mertel-layout">
      <aside className="mertel-sidebar">
        <div className="mertel-brand">
          <div className="mertel-brand-mark">{appearance.compactLogo ? <img src={appearance.compactLogo} alt="Logo compacto"/> : appearance.name.slice(0,1)}</div>

          <div className="mertel-brand-copy">
            <span className="mertel-brand-kicker">Sistema operativo</span>
            <strong>{appearance.name}</strong>
            <span>{appearance.description}</span>
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
            {permissions.includes("settings.manage") && <NavLink end to="/administracion" className={({isActive})=>`mertel-nav-item ${isActive?'active':''}`}><LayoutDashboard size={19}/><span>Centro Administrativo</span></NavLink>}
            {permissions.includes("portfolio.import") && <NavLink to="/administracion/resolucion-clientes" className={({ isActive }) =>
              `mertel-nav-item ${isActive ? "active" : ""}`}><SearchCheck size={19} strokeWidth={2} /><span>Clientes por resolver</span></NavLink>}
            {permissions.includes("settings.manage") && <NavLink to="/administracion/pagos-reportados" className={({ isActive }) =>
              `mertel-nav-item ${isActive ? "active" : ""}`}><CreditCard size={19} strokeWidth={2} /><span>Pagos reportados</span></NavLink>}
            {permissions.includes("history.view") && permissions.includes("settings.manage") && <NavLink to="/administracion/historial-cobranza" className={({ isActive }) =>
              `mertel-nav-item ${isActive ? "active" : ""}`}><ClipboardCheck size={19} strokeWidth={2} /><span>Auditoría</span></NavLink>}
            {permissions.includes("settings.manage") && <NavLink to="/administracion/whatsapp" className={({ isActive }) =>
              `mertel-nav-item ${isActive ? "active" : ""}`}><MessageSquareText size={19} strokeWidth={2} /><span>WhatsApp</span></NavLink>}
            {permissions.includes("message_templates.manage") && <NavLink to="/administracion/plantillas-whatsapp" className={({ isActive }) =>
              `mertel-nav-item ${isActive ? "active" : ""}`}>
              <MessageSquareText size={19} strokeWidth={2} />
              <span>Plantillas WhatsApp</span>
            </NavLink>}
            {permissions.includes("portfolio.import") && <NavLink to="/administracion/importar-cartera" className={({ isActive }) =>
              `mertel-nav-item ${isActive ? "active" : ""}`}>
              <FileSpreadsheet size={19} strokeWidth={2} />
              <span>Importar cartera</span>
            </NavLink>}
            {permissions.includes("collection.view") && permissions.includes("settings.manage") && <NavLink to="/administracion/dashboard-cobranza" className={({ isActive }) =>
              `mertel-nav-item ${isActive ? "active" : ""}`}><Gauge size={19} strokeWidth={2} /><span>Dashboard de cobranza</span></NavLink>}
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
            {appearance.logo && <img className="mertel-brand-main-logo" src={appearance.logo} alt="Logo principal"/>}
            <span className="mertel-header-kicker">MERTEL IMPORTACIONES · CARTERA</span>
            <h1>{appearance.name}</h1>
            <span>{appearance.description}</span>
          </div>
          {simulationAvailable && <SimulationControls />}
          {mode !== 'SIMULATION' && <SessionActions />}
        </header>

        <main className="mertel-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default MainLayout;
