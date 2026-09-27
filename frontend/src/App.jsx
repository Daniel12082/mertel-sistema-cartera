import { Route, Routes } from "react-router-dom";
import MainLayout from "./layouts/MainLayout";
import Dashboard from "./pages/Dashboard/Dashboard";
import Clientes from "./pages/Clientes/Clientes";

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
      <Route element={<MainLayout />}>
        <Route path="/" element={<Dashboard />} />

        <Route 
          path="/clientes"
          element={<Clientes />}
        />

        <Route
          path="/facturas"
          element={<PlaceholderPage title="Facturas" />}
        />

        <Route
          path="/cartera"
          element={<PlaceholderPage title="Cartera" />}
        />

        <Route
          path="/cobranza"
          element={<PlaceholderPage title="Cobranza" />}
        />

        <Route
          path="/pagos"
          element={<PlaceholderPage title="Pagos" />}
        />

        <Route
          path="/reportes"
          element={<PlaceholderPage title="Reportes" />}
        />

        <Route
          path="/configuracion"
          element={<PlaceholderPage title="Configuración" />}
        />

        <Route
          path="*"
          element={<PlaceholderPage title="Página no encontrada" />}
        />
      </Route>
    </Routes>
  );
}

export default App;