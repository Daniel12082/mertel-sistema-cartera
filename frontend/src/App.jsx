import { Route, Routes, useLocation } from "react-router-dom";
import MainLayout from "./layouts/MainLayout";
import Dashboard from "./pages/Dashboard/Dashboard";
import Clientes from "./pages/Clientes/Clientes";
import Facturas from "./pages/Factura/Facturas";
import Pagos from "./pages/Pagos/Pagos";
import Cartera from "./pages/Cartera/Cartera";
import Cobranza from "./pages/Cobranza/Cobranza";
import PortfolioPipelineView from "./pages/Cobranza/PortfolioPipelineView";
import Configuracion from "./pages/Configuracion/Configuracion";
import MessageTemplates from "./pages/Administracion/MessageTemplates";
import CollectionSettings from "./pages/Administracion/CollectionSettings";
import PortfolioImport from "./pages/Administracion/PortfolioImport";
import CollectionDashboard from "./pages/Administracion/CollectionDashboard";
import CollectionHistory from "./pages/Administracion/CollectionHistory";
import WhatsAppCenter from "./pages/Administracion/WhatsAppCenter";
import ReportedPayments from "./pages/Administracion/ReportedPayments";
import CustomerResolution from "./pages/Administracion/CustomerResolution";
import LoginPage from "./pages/Login/LoginPage";
import ProtectedRoute from "./auth/ProtectedRoute";

function PlaceholderPage({ title }) {
  return (
    <section>
      <h2>{title}</h2>
      <p>Módulo de {title.toLowerCase()} en construcción.</p>
    </section>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
      <Route element={<MainLayout />}>
        <Route path="/" element={<Dashboard />} />

        <Route 
          path="/clientes"
          element={<Clientes />}
        />

        <Route
          path="/facturas"
          element={<Facturas />}
        />

        <Route
          path="/cartera"
          element={<Cartera />}
        />

        <Route
          path="/cobranza"
          element={<CobranzaRoute />}
        />

        <Route
          path="/pagos"
          element={<Pagos />}
        />

        <Route
          path="/reportes"
          element={<PlaceholderPage title="Reportes" />}
        />

        <Route
          path="/configuracion"
          element={<Configuracion />}
        />

        <Route
          path="/administracion/plantillas-whatsapp"
          element={<MessageTemplates />}
        />

        <Route path="/administracion/dashboard-cobranza" element={<CollectionDashboard />} />
        <Route path="/administracion/historial-cobranza" element={<CollectionHistory />} />
        <Route path="/administracion/whatsapp" element={<WhatsAppCenter />} />
        <Route path="/administracion/pagos-reportados" element={<ReportedPayments />} />
        <Route path="/administracion/resolucion-clientes" element={<CustomerResolution />} />

        <Route
          path="/administracion/configuracion-cobranza"
          element={<CollectionSettings />}
        />

        <Route
          path="/administracion/importar-cartera"
          element={<PortfolioImport />}
        />

        <Route
          path="*"
          element={<PlaceholderPage title="Página no encontrada" />}
        />
      </Route>
      </Route>
    </Routes>
  );
}

export default App;

function CobranzaRoute() {
  const location = useLocation();
  return location.state?.portfolioPipeline ? <PortfolioPipelineView data={location.state.portfolioPipeline} /> : <Cobranza />;
}
