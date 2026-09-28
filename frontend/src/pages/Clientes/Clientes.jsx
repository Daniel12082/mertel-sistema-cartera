import { useEffect, useMemo, useState } from "react";
import {
  Search,
  Plus,
  Users,
  RefreshCw,
  X,
  Pencil,
  Trash2,
  Eye,
} from "lucide-react";

import {
  getCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
} from "../../services/customer.service";

import "./Clientes.css";

const initialForm = {
  nit: "",
  name: "",
  phone: "",
  email: "",
  address: "",
  city: "",
  credit_limit: 0,
  available_credit: 0,
  status: "active",
  notes: "",
};

function Clientes() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");

  const [search, setSearch] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState("create");
  const [selectedCustomer, setSelectedCustomer] = useState(null);

  const [form, setForm] = useState(initialForm);

  // =========================================================
  // CARGAR CLIENTES
  // =========================================================

  async function loadCustomers() {
    try {
      setLoading(true);
      setError("");

      const response = await getCustomers();

      if (!response.success) {
        throw new Error(
          response.message || "No se pudieron cargar los clientes",
        );
      }

      setCustomers(response.data || []);
    } catch (error) {
      console.error("Error cargando clientes:", error);

      setError(
        error.response?.data?.message ||
          error.message ||
          "No se pudieron cargar los clientes",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
  const timer = setTimeout(() => {
    loadCustomers();
  }, 0);

  return () => clearTimeout(timer);
}, []);

  // =========================================================
  // BUSCADOR
  // =========================================================

  const filteredCustomers = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (!term) {
      return customers;
    }

    return customers.filter((customer) => {
      return (
        String(customer.nit || "")
          .toLowerCase()
          .includes(term) ||
        String(customer.name || "")
          .toLowerCase()
          .includes(term) ||
        String(customer.phone || "")
          .toLowerCase()
          .includes(term) ||
        String(customer.email || "")
          .toLowerCase()
          .includes(term) ||
        String(customer.city || "")
          .toLowerCase()
          .includes(term)
      );
    });
  }, [customers, search]);

  // =========================================================
  // FORMATEAR MONEDA
  // =========================================================

  function formatCurrency(value) {
    const number = Number(value || 0);

    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: "COP",
      maximumFractionDigits: 0,
    }).format(number);
  }

  // =========================================================
  // ABRIR MODAL CREAR
  // =========================================================

  function openCreateModal() {
    setModalMode("create");
    setSelectedCustomer(null);
    setForm(initialForm);
    setFormError("");
    setShowModal(true);
  }

  // =========================================================
  // ABRIR MODAL EDITAR
  // =========================================================

    function openEditModal(customer) {
    setFormError("");
    setModalMode("edit");
    setSelectedCustomer(customer);

    setForm({
      nit: customer.nit || "",
      name: customer.name || "",
      phone: customer.phone || "",
      email: customer.email || "",
      address: customer.address || "",
      city: customer.city || "",
      credit_limit: customer.credit_limit ?? 0,
      available_credit: customer.available_credit ?? 0,
      status: customer.status || "active",
      notes: customer.notes || "",
    });

    setShowModal(true);
  }

  // =========================================================
  // ABRIR MODAL VER
  // =========================================================

  function openViewModal(customer) {
    setModalMode("view");
    setSelectedCustomer(customer);
    setFormError("");

    setForm({
      nit: customer.nit || "",
      name: customer.name || "",
      phone: customer.phone || "",
      email: customer.email || "",
      address: customer.address || "",
      city: customer.city || "",
      credit_limit: customer.credit_limit ?? 0,
      available_credit: customer.available_credit ?? 0,
      status: customer.status || "active",
      notes: customer.notes || "",
    });

    setShowModal(true);
  }

  // =========================================================
  // CERRAR MODAL
  // =========================================================

  function closeModal() {
    if (saving) {
      return;
    }

    setShowModal(false);
    setSelectedCustomer(null);
    setForm(initialForm);
    setFormError("");
  }

  // =========================================================
  // CAMBIAR FORMULARIO
  // =========================================================

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  }

  // =========================================================
  // GUARDAR / ACTUALIZAR
  // =========================================================

  async function handleSubmit(event) {
    event.preventDefault();

    setFormError("");

    if (!form.nit.trim()) {
      setFormError("El NIT es obligatorio.");
      return;
    }

    if (!form.name.trim()) {
      setFormError("El nombre del cliente es obligatorio.");
      return;
    }

    try {
      setSaving(true);

      let response;

      if (modalMode === "edit") {
        if (!selectedCustomer?.id) {
          throw new Error("No se encontró el cliente que deseas editar.");
        }

        response = await updateCustomer(selectedCustomer.id, {
          ...form,
          credit_limit: Number(form.credit_limit || 0),
          available_credit: Number(form.available_credit || 0),
        });
      } else {
        response = await createCustomer({
          ...form,
          credit_limit: Number(form.credit_limit || 0),
          available_credit: Number(form.available_credit || 0),
        });
      }

      if (!response.success) {
        throw new Error(
          response.message ||
            (modalMode === "edit"
              ? "No se pudo actualizar el cliente."
              : "No se pudo crear el cliente."),
        );
      }

      await loadCustomers();

      closeModal();
    } catch (error) {
      console.error("Error guardando cliente:", error);

      setFormError(
        error.response?.data?.message ||
          error.message ||
          "Ocurrió un error al guardar el cliente.",
      );
    } finally {
      setSaving(false);
    }
  }

  // =========================================================
  // ELIMINAR
  // =========================================================

  async function handleDelete(customer) {
    const confirmed = window.confirm(
      `¿Está seguro de eliminar al cliente "${customer.name}"?`,
    );

    if (!confirmed) {
      return;
    }

    try {
      setDeletingId(customer.id);
      setError("");

      const response = await deleteCustomer(customer.id);

      if (!response.success) {
        throw new Error(
          response.message || "No se pudo eliminar el cliente.",
        );
      }

      setCustomers((previous) =>
        previous.filter((item) => item.id !== customer.id),
      );
    } catch (error) {
      console.error("Error eliminando cliente:", error);

      setError(
        error.response?.data?.message ||
          error.message ||
          "No se pudo eliminar el cliente.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  // =========================================================
  // TITULO DEL MODAL
  // =========================================================

  function getModalTitle() {
    if (modalMode === "create") {
      return "Nuevo cliente";
    }

    if (modalMode === "edit") {
      return "Editar cliente";
    }

    return "Información del cliente";
  }

  // =========================================================
  // RENDER
  // =========================================================

  return (
    <section className="clientes-page">
      {/* =====================================================
          HEADER
      ===================================================== */}

      <div className="page-header">
        <div className="page-title-row">
          <div>
            <h1 className="page-title">Clientes</h1>

            <p className="page-subtitle">
              Gestión y administración de clientes
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

        {/* ===================================================
            TOOLBAR
        =================================================== */}

        <div className="page-toolbar">
          <div className="search-box">
            <Search size={18} />

            <input
              type="text"
              placeholder="Buscar por NIT, nombre, teléfono, correo o ciudad..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />

            {search && (
              <button
                type="button"
                className="search-clear"
                onClick={() => setSearch("")}
                title="Limpiar búsqueda"
              >
                <X size={16} />
              </button>
            )}
          </div>

          <button
            type="button"
            className="secondary-button"
            onClick={loadCustomers}
            disabled={loading}
            title="Actualizar clientes"
          >
            <RefreshCw
              size={17}
              className={loading ? "spin" : ""}
            />

            Actualizar
          </button>
        </div>
      </div>

      {/* =====================================================
          ERROR GENERAL
      ===================================================== */}

      {error && (
        <div className="clientes-alert clientes-alert-error">
          {error}
        </div>
      )}

      {/* =====================================================
          TABLA
      ===================================================== */}

      <div className="data-card">
        <div className="table-header">
          <div className="table-header-title">
            <Users size={19} />

            <span>Clientes registrados</span>

            <span className="table-count">
              {filteredCustomers.length}
            </span>
          </div>
        </div>

        <div className="table-container">
          {loading ? (
            <div className="empty-state">
              <RefreshCw size={26} className="spin" />

              <p>Cargando clientes...</p>
            </div>
          ) : filteredCustomers.length === 0 ? (
            <div className="empty-state">
              <Users size={32} />

              <h3>
                {search
                  ? "No se encontraron clientes"
                  : "No hay clientes registrados"}
              </h3>

              <p>
                {search
                  ? "Intenta cambiar los términos de búsqueda."
                  : "Crea el primer cliente para comenzar."}
              </p>

              {!search && (
                <button
                  type="button"
                  className="primary-button"
                  onClick={openCreateModal}
                >
                  <Plus size={17} />
                  Nuevo cliente
                </button>
              )}
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>NIT</th>
                  <th>Cliente</th>
                  <th>Teléfono</th>
                  <th>Correo</th>
                  <th>Ciudad</th>
                  <th>Cupo</th>
                  <th>Disponible</th>
                  <th>Estado</th>
                  <th className="actions-column">Acciones</th>
                </tr>
              </thead>

              <tbody>
                {filteredCustomers.map((customer) => (
                  <tr key={customer.id}>
                    <td>
                      <strong>{customer.nit || "—"}</strong>
                    </td>

                    <td>
                      <div className="customer-name">
                        {customer.name || "—"}
                      </div>
                    </td>

                    <td>{customer.phone || "—"}</td>

                    <td>{customer.email || "—"}</td>

                    <td>{customer.city || "—"}</td>

                    <td>
                      {formatCurrency(customer.credit_limit)}
                    </td>

                    <td>
                      {formatCurrency(customer.available_credit)}
                    </td>

                    <td>
                      <span
                        className={`status-badge ${
                          customer.status === "active"
                            ? "status-active"
                            : "status-inactive"
                        }`}
                      >
                        {customer.status === "active"
                          ? "Activo"
                          : "Inactivo"}
                      </span>
                    </td>

                    <td>
                      <div className="cliente-actions">
                        {/* VER */}
                        <button
                          type="button"
                          className="icon-button view"
                          onClick={() => openViewModal(customer)}
                          title="Ver cliente"
                        >
                          <Eye size={17} />
                        </button>

                        {/* EDITAR */}
                        <button
                          type="button"
                          className="icon-button edit"
                          onClick={() => openEditModal(customer)}
                          title="Editar cliente"
                        >
                          <Pencil size={17} />
                        </button>

                        {/* ELIMINAR */}
                        <button
                          type="button"
                          className="icon-button delete"
                          onClick={() => handleDelete(customer)}
                          disabled={deletingId === customer.id}
                          title="Eliminar cliente"
                        >
                          {deletingId === customer.id ? (
                            <RefreshCw size={17} className="spin" />
                          ) : (
                            <Trash2 size={17} />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* =====================================================
          MODAL
      ===================================================== */}

      {showModal && (
        <div
          className="cliente-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeModal();
            }
          }}
        >
          <div className="cliente-modal">
            {/* =================================================
                HEADER MODAL
            ================================================= */}

            <div className="cliente-modal-header">
              <div>
                <h2>{getModalTitle()}</h2>

                <p>
                  {modalMode === "create"
                    ? "Registra la información del nuevo cliente."
                    : modalMode === "edit"
                      ? "Actualiza la información del cliente."
                      : "Consulta la información registrada del cliente."}
                </p>
              </div>

              <button
                type="button"
                className="cliente-modal-close"
                onClick={closeModal}
                disabled={saving}
              >
                <X size={20} />
              </button>
            </div>

            {/* =================================================
                CONTENIDO
            ================================================= */}

            {modalMode === "view" ? (
              <div className="cliente-modal-body">
                <div className="cliente-detail-grid">
                  <Detail
                    label="NIT"
                    value={form.nit}
                  />

                  <Detail
                    label="Nombre"
                    value={form.name}
                  />

                  <Detail
                    label="Teléfono"
                    value={form.phone}
                  />

                  <Detail
                    label="Correo electrónico"
                    value={form.email}
                  />

                  <Detail
                    label="Dirección"
                    value={form.address}
                  />

                  <Detail
                    label="Ciudad"
                    value={form.city}
                  />

                  <Detail
                    label="Cupo de crédito"
                    value={formatCurrency(form.credit_limit)}
                  />

                  <Detail
                    label="Crédito disponible"
                    value={formatCurrency(form.available_credit)}
                  />

                  <Detail
                    label="Estado"
                    value={
                      form.status === "active"
                        ? "Activo"
                        : "Inactivo"
                    }
                  />

                  <div className="cliente-detail cliente-detail-full">
                    <span>Notas</span>

                    <strong>
                      {form.notes || "Sin notas"}
                    </strong>
                  </div>
                </div>
              </div>
            ) : (
              <form
                className="cliente-modal-body"
                onSubmit={handleSubmit}
              >
                {/* =============================================
                    ERROR FORMULARIO
                ============================================= */}

                {formError && (
                  <div className="cliente-form-error">
                    {formError}
                  </div>
                )}

                {/* =============================================
                    CAMPOS
                ============================================= */}

                <div className="cliente-form-grid">
                  <Field
                    label="NIT"
                    name="nit"
                    value={form.nit}
                    onChange={handleChange}
                    required
                    placeholder="Ej. 900123456-7"
                  />

                  <Field
                    label="Nombre"
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    required
                    placeholder="Nombre del cliente"
                  />

                  <Field
                    label="Teléfono"
                    name="phone"
                    value={form.phone}
                    onChange={handleChange}
                    placeholder="Ej. 3001234567"
                  />

                  <Field
                    label="Correo electrónico"
                    name="email"
                    type="email"
                    value={form.email}
                    onChange={handleChange}
                    placeholder="correo@empresa.com"
                  />

                  <Field
                    label="Dirección"
                    name="address"
                    value={form.address}
                    onChange={handleChange}
                    placeholder="Dirección"
                  />

                  <Field
                    label="Ciudad"
                    name="city"
                    value={form.city}
                    onChange={handleChange}
                    placeholder="Ciudad"
                  />

                  <Field
                    label="Cupo de crédito"
                    name="credit_limit"
                    type="number"
                    value={form.credit_limit}
                    onChange={handleChange}
                    min="0"
                    step="0.01"
                    placeholder="0"
                  />

                  <Field
                    label="Crédito disponible"
                    name="available_credit"
                    type="number"
                    value={form.available_credit}
                    onChange={handleChange}
                    min="0"
                    step="0.01"
                    placeholder="0"
                  />

                  <div className="cliente-field">
                    <label htmlFor="status">
                      Estado
                    </label>

                    <select
                      id="status"
                      name="status"
                      value={form.status}
                      onChange={handleChange}
                    >
                      <option value="active">
                        Activo
                      </option>

                      <option value="inactive">
                        Inactivo
                      </option>
                    </select>
                  </div>

                  <div className="cliente-field cliente-field-full">
                    <label htmlFor="notes">
                      Notas
                    </label>

                    <textarea
                      id="notes"
                      name="notes"
                      value={form.notes}
                      onChange={handleChange}
                      rows="4"
                      placeholder="Notas adicionales..."
                    />
                  </div>
                </div>

                {/* =============================================
                    FOOTER FORMULARIO
                ============================================= */}

                <div className="cliente-modal-footer">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={closeModal}
                    disabled={saving}
                  >
                    Cancelar
                  </button>

                  <button
                    type="submit"
                    className="primary-button"
                    disabled={saving}
                  >
                    {saving ? (
                      <>
                        <RefreshCw
                          size={17}
                          className="spin"
                        />

                        Guardando...
                      </>
                    ) : modalMode === "edit" ? (
                      <>
                        <Pencil size={17} />

                        Actualizar cliente
                      </>
                    ) : (
                      <>
                        <Plus size={17} />

                        Crear cliente
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}

            {/* =================================================
                FOOTER VISTA
            ================================================= */}

            {modalMode === "view" && (
              <div className="cliente-modal-footer">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={closeModal}
                >
                  Cerrar
                </button>

                <button
                  type="button"
                  className="primary-button"
                  onClick={() =>
                    selectedCustomer &&
                    openEditModal(selectedCustomer)
                  }
                >
                  <Pencil size={17} />
                  Editar cliente
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// =============================================================
// COMPONENTE FIELD
// =============================================================

function Field({
  label,
  name,
  value,
  onChange,
  type = "text",
  required = false,
  placeholder = "",
  min,
  step,
}) {
  return (
    <div className="cliente-field">
      <label htmlFor={name}>
        {label}

        {required && (
          <span className="required-mark">*</span>
        )}
      </label>

      <input
        id={name}
        name={name}
        type={type}
        value={value}
        onChange={onChange}
        required={required}
        placeholder={placeholder}
        min={min}
        step={step}
      />
    </div>
  );
}

// =============================================================
// COMPONENTE DETAIL
// =============================================================

function Detail({ label, value }) {
  return (
    <div className="cliente-detail">
      <span>{label}</span>

      <strong>{value || "—"}</strong>
    </div>
  );
}

export default Clientes;