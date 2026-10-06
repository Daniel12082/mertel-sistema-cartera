import { Route, Routes } from "react-router-dom";
import MainLayout from "./layouts/MainLayout";
import Dashboard from "./pages/Dashboard/Dashboard";
import Clientes from "./pages/Clientes/Clientes";
import Facturas from "./pages/Factura/Facturas";
import Pagos from "./pages/Pagos/Pagos";
import Cartera from "./pages/Cartera/Cartera";
import Cobranza from "./pages/Cobranza/Cobranza";
import Configuracion from "./pages/Configuracion/Configuracion";
import MessageTemplates from "./pages/Administracion/MessageTemplates";
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
          element={<Cobranza />}
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
