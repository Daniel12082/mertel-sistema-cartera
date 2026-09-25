import { useEffect, useState } from "react";
import { getCustomers } from "./services/customer.service";

function App() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadCustomers() {
      try {
        const response = await getCustomers();

        if (response.success) {
          setCustomers(response.data);
        } else {
          setError("No se pudieron cargar los clientes.");
        }
      } catch (err) {
        console.error(err);
        setError("Error conectando con el API.");
      } finally {
        setLoading(false);
      }
    }

    loadCustomers();
  }, []);

  return (
    <main style={{ padding: "40px", fontFamily: "Arial, sans-serif" }}>
      <h1>MERTEL</h1>

      <p>Prueba de conexión Frontend → Backend → MySQL</p>

      {loading && <p>Cargando clientes...</p>}

      {error && <p>{error}</p>}

      {!loading && !error && (
        <>
          <p>Clientes encontrados: {customers.length}</p>

          {customers.length === 0 ? (
            <p>No hay clientes registrados todavía.</p>
          ) : (
            <ul>
              {customers.map((customer) => (
                <li key={customer.id}>
                  {customer.name} — {customer.nit}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}

export default App;