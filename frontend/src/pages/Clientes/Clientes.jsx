import { useEffect, useMemo, useState } from "react";
import { Search, Plus, Users, RefreshCw } from "lucide-react";
import { getCustomers } from "../../services/customer.service";

function Clientes() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  async function loadCustomers() {
    try {
      setLoading(true);
      setError("");

      const response = await getCustomers();

      if (!response.success) {
        throw new Error(
          response.message || "No se pudieron cargar los clientes.",
        );
      }

      setCustomers(response.data || []);
    } catch (err) {
      console.error("Error cargando clientes:", err);
      setError("No fue posible cargar los clientes.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadInitialCustomers() {
      try {
        setError("");

        const response = await getCustomers();

        if (!response.success) {
          throw new Error(
            response.message || "No se pudieron cargar los clientes.",
          );
        }

        if (!cancelled) {
          setCustomers(response.data || []);
          setLoading(false);
        }
      } catch (err) {
        console.error("Error cargando clientes:", err);

        if (!cancelled) {
          setError("No fue posible cargar los clientes.");
          setLoading(false);
        }
      }
    }

    loadInitialCustomers();

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredCustomers = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    if (!normalizedSearch) {
      return customers;
    }

    return customers.filter((customer) => {
      return (
        String(customer.nit || "")
          .toLowerCase()
          .includes(normalizedSearch) ||
        String(customer.name || "")
          .toLowerCase()
          .includes(normalizedSearch) ||
        String(customer.phone || "")
          .toLowerCase()
          .includes(normalizedSearch) ||
        String(customer.city || "")
          .toLowerCase()
          .includes(normalizedSearch)
      );
    });
  }, [customers, search]);

  function formatCurrency(value) {
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: "COP",
      maximumFractionDigits: 0,
    }).format(Number(value || 0));
  }

  return (
    <section className="clientes-page">
      <div className="page-header">
        <div>
          <div className="page-title-row">
            <Users size={24} />
            <h2>Clientes</h2>
          </div>

          <p>
            Consulta y administra los clientes registrados en MERTEL.
          </p>
        </div>

        <button type="button" className="primary-button">
          <Plus size={18} />
          Nuevo cliente
        </button>
      </div>

      <div className="page-toolbar">
        <div className="search-box">
          <Search size={18} />

          <input
            type="search"
            placeholder="Buscar por NIT, nombre, teléfono o ciudad..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <button
          type="button"
          className="secondary-button"
          onClick={loadCustomers}
          disabled={loading}
        >
          <RefreshCw size={17} />
          Actualizar
        </button>
      </div>

      <div className="data-card">
        {loading && (
          <div className="empty-state">
            <p>Cargando clientes...</p>
          </div>
        )}

        {!loading && error && (
          <div className="empty-state">
            <h3>No se pudieron cargar los clientes</h3>

            <p>{error}</p>

            <button
              type="button"
              className="secondary-button"
              onClick={loadCustomers}
            >
              Intentar nuevamente
            </button>
          </div>
        )}

        {!loading && !error && customers.length === 0 && (
          <div className="empty-state">
            <Users size={32} />

            <h3>No hay clientes registrados</h3>

            <p>
              Todavía no existen clientes en la base de datos de MERTEL.
            </p>

            <button type="button" className="primary-button">
              <Plus size={18} />
              Registrar primer cliente
            </button>
          </div>
        )}

        {!loading && !error && customers.length > 0 && (
          <>
            <div className="table-header">
              <span>
                {filteredCustomers.length}{" "}
                {filteredCustomers.length === 1 ? "cliente" : "clientes"}
              </span>
            </div>

            {filteredCustomers.length === 0 ? (
              <div className="empty-state">
                <Search size={32} />

                <h3>No encontramos resultados</h3>

                <p>
                  Prueba con otro NIT, nombre, teléfono o ciudad.
                </p>
              </div>
            ) : (
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>NIT</th>
                      <th>Cliente</th>
                      <th>Teléfono</th>
                      <th>Ciudad</th>
                      <th>Cupo</th>
                      <th>Disponible</th>
                      <th>Estado</th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredCustomers.map((customer) => (
                      <tr key={customer.id}>
                        <td>{customer.nit}</td>

                        <td>
                          <strong>{customer.name}</strong>

                          {customer.email && (
                            <small>{customer.email}</small>
                          )}
                        </td>

                        <td>{customer.phone || "—"}</td>

                        <td>{customer.city || "—"}</td>

                        <td>
                          {formatCurrency(customer.credit_limit)}
                        </td>

                        <td>
                          {formatCurrency(customer.available_credit)}
                        </td>

                        <td>
                          <span
                            className={`status-badge status-${String(
                              customer.status || "unknown",
                            ).toLowerCase()}`}
                          >
                            {customer.status || "—"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export default Clientes;