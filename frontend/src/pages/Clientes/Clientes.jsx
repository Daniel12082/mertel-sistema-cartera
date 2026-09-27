import { useEffect, useMemo, useState } from "react";
import { Search, Plus, Users, RefreshCw, X } from "lucide-react";
import { getCustomers, createCustomer } from "../../services/customer.service";

const initialForm = {
  nit: "",
  name: "",
  phone: "",
  email: "",
  address: "",
  city: "",
  credit_limit: "",
  available_credit: "",
  notes: "",
};

function Clientes() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(initialForm);

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
        String(customer.nit || "").toLowerCase().includes(normalizedSearch) ||
        String(customer.name || "").toLowerCase().includes(normalizedSearch) ||
        String(customer.phone || "").toLowerCase().includes(normalizedSearch) ||
        String(customer.city || "").toLowerCase().includes(normalizedSearch)
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

  function openCreateModal() {
    setForm(initialForm);
    setFormError("");
    setShowModal(true);
  }

  function closeCreateModal() {
    if (saving) return;

    setShowModal(false);
    setFormError("");
  }

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError("");

    const nit = form.nit.trim();
    const name = form.name.trim();

    if (!nit || !name) {
      setFormError("El NIT y el nombre del cliente son obligatorios.");
      return;
    }

    try {
      setSaving(true);

      const payload = {
        nit,
        name,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        credit_limit: Number(form.credit_limit || 0),
        available_credit:
          form.available_credit === ""
            ? Number(form.credit_limit || 0)
            : Number(form.available_credit),
        status: "active",
        notes: form.notes.trim() || null,
      };

      const response = await createCustomer(payload);

      if (!response.success) {
        throw new Error(
          response.message || "No se pudo crear el cliente.",
        );
      }

      setCustomers((current) => [...current, response.data]);
      setShowModal(false);
      setForm(initialForm);
      setFormError("");
    } catch (err) {
      console.error("Error creando cliente:", err);

      const message =
        err?.response?.data?.message ||
        err?.message ||
        "No se pudo crear el cliente.";

      setFormError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
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

          <button
            type="button"
            className="primary-button"
            onClick={openCreateModal}
          >
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
              <button
                type="button"
                className="primary-button"
                onClick={openCreateModal}
              >
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
                            {customer.email && <small>{customer.email}</small>}
                          </td>
                          <td>{customer.phone || "—"}</td>
                          <td>{customer.city || "—"}</td>
                          <td>{formatCurrency(customer.credit_limit)}</td>
                          <td>{formatCurrency(customer.available_credit)}</td>
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

      {showModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            background: "rgba(8, 15, 28, 0.58)",
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeCreateModal();
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="nuevo-cliente-title"
            style={{
              width: "min(720px, 100%)",
              maxHeight: "90vh",
              overflowY: "auto",
              background: "#ffffff",
              borderRadius: "14px",
              boxShadow: "0 24px 70px rgba(0, 0, 0, 0.25)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "20px 24px",
                borderBottom: "1px solid #e5e7eb",
              }}
            >
              <div>
                <h3
                  id="nuevo-cliente-title"
                  style={{
                    margin: 0,
                    fontSize: "20px",
                    color: "#111827",
                  }}
                >
                  Nuevo cliente
                </h3>
                <p
                  style={{
                    margin: "5px 0 0",
                    fontSize: "13px",
                    color: "#6b7280",
                  }}
                >
                  Registra la información básica del cliente.
                </p>
              </div>

              <button
                type="button"
                onClick={closeCreateModal}
                disabled={saving}
                aria-label="Cerrar"
                style={{
                  width: "36px",
                  height: "36px",
                  display: "grid",
                  placeItems: "center",
                  border: "1px solid #e5e7eb",
                  borderRadius: "8px",
                  background: "#ffffff",
                  color: "#6b7280",
                  cursor: saving ? "not-allowed" : "pointer",
                }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: "16px",
                  padding: "24px",
                }}
              >
                <label style={{ display: "grid", gap: "7px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 600 }}>
                    NIT <span style={{ color: "#c62828" }}>*</span>
                  </span>
                  <input
                    name="nit"
                    value={form.nit}
                    onChange={handleChange}
                    placeholder="900123456-7"
                    required
                    style={inputStyle}
                  />
                </label>

                <label style={{ display: "grid", gap: "7px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 600 }}>
                    Nombre / Razón social{" "}
                    <span style={{ color: "#c62828" }}>*</span>
                  </span>
                  <input
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    placeholder="Nombre del cliente"
                    required
                    style={inputStyle}
                  />
                </label>

                <label style={{ display: "grid", gap: "7px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 600 }}>
                    Teléfono
                  </span>
                  <input
                    name="phone"
                    value={form.phone}
                    onChange={handleChange}
                    placeholder="3001234567"
                    style={inputStyle}
                  />
                </label>

                <label style={{ display: "grid", gap: "7px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 600 }}>
                    Correo electrónico
                  </span>
                  <input
                    type="email"
                    name="email"
                    value={form.email}
                    onChange={handleChange}
                    placeholder="correo@empresa.com"
                    style={inputStyle}
                  />
                </label>

                <label style={{ display: "grid", gap: "7px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 600 }}>
                    Ciudad
                  </span>
                  <input
                    name="city"
                    value={form.city}
                    onChange={handleChange}
                    placeholder="Bucaramanga"
                    style={inputStyle}
                  />
                </label>

                <label style={{ display: "grid", gap: "7px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 600 }}>
                    Dirección
                  </span>
                  <input
                    name="address"
                    value={form.address}
                    onChange={handleChange}
                    placeholder="Dirección del cliente"
                    style={inputStyle}
                  />
                </label>

                <label style={{ display: "grid", gap: "7px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 600 }}>
                    Cupo de crédito
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    name="credit_limit"
                    value={form.credit_limit}
                    onChange={handleChange}
                    placeholder="0"
                    style={inputStyle}
                  />
                </label>

                <label style={{ display: "grid", gap: "7px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 600 }}>
                    Crédito disponible
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    name="available_credit"
                    value={form.available_credit}
                    onChange={handleChange}
                    placeholder="Igual al cupo si se deja vacío"
                    style={inputStyle}
                  />
                </label>

                <label
                  style={{
                    display: "grid",
                    gap: "7px",
                    gridColumn: "1 / -1",
                  }}
                >
                  <span style={{ fontSize: "13px", fontWeight: 600 }}>
                    Observaciones
                  </span>
                  <textarea
                    name="notes"
                    value={form.notes}
                    onChange={handleChange}
                    placeholder="Observaciones del cliente..."
                    rows={3}
                    style={{ ...inputStyle, resize: "vertical" }}
                  />
                </label>
              </div>

              {formError && (
                <div
                  style={{
                    margin: "0 24px 16px",
                    padding: "11px 13px",
                    borderRadius: "8px",
                    border: "1px solid #fecaca",
                    background: "#fef2f2",
                    color: "#b91c1c",
                    fontSize: "13px",
                  }}
                >
                  {formError}
                </div>
              )}

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "10px",
                  padding: "16px 24px 20px",
                  borderTop: "1px solid #e5e7eb",
                }}
              >
                <button
                  type="button"
                  className="secondary-button"
                  onClick={closeCreateModal}
                  disabled={saving}
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  className="primary-button"
                  disabled={saving}
                >
                  {saving ? "Guardando..." : "Guardar cliente"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  minHeight: "40px",
  padding: "9px 11px",
  border: "1px solid #d1d5db",
  borderRadius: "8px",
  outline: "none",
  background: "#ffffff",
  color: "#111827",
  fontSize: "14px",
};

export default Clientes;
