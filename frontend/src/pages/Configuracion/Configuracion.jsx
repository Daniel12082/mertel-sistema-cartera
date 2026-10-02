import { useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { getRoleCatalog } from "../../services/auth.service";
import "./Configuracion.css";

export default function Configuracion() {
  const { user, accessToken, permissions } = useAuth();
  const [catalog, setCatalog] = useState([]);
  const [selected, setSelected] = useState("admin");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const authorized = Boolean(user && permissions.includes("roles.view"));
  async function loadRoles() {
    setLoading(true); setError("");
    try { setCatalog(await getRoleCatalog(accessToken)); }
    catch (failure) { setCatalog([]); setError(failure.response?.status === 403 ? "No tienes permiso para consultar roles." : "No se pudo consultar la matriz de roles."); }
    finally { setLoading(false); }
  }
  const role = authorized ? catalog.find(item => item.name === selected) : null;
  return <section className="role-permissions">
    <h2>Roles y permisos</h2>
    {!user ? <p>La consulta administrativa requiere una sesión interna autenticada.</p> : !authorized ?
      <p>No tienes acceso a la administración de roles.</p> : <>
      <p>Consulta qué puede hacer cada rol. Los permisos previstos se aplicarán cuando esté disponible su operación.</p>
      <button type="button" onClick={loadRoles} disabled={loading}>{loading ? "Cargando…" : "Consultar roles y permisos"}</button>
      {error && <p role="alert">{error}</p>}
      {catalog.length > 0 && <label>Rol <select value={selected} onChange={event => setSelected(event.target.value)}>
        {catalog.map(item => <option key={item.name} value={item.name}>{item.label}</option>)}
      </select></label>}
      {role && <div className="role-permissions-table"><table>
        <caption>Permisos de {role.label}</caption>
        <thead><tr><th>Módulo</th><th>Permiso</th><th>Estado</th><th>Disponibilidad</th></tr></thead>
        <tbody>{role.permissions.map(permission => <tr key={permission.name}>
          <td>{permission.moduleLabel}</td><td>{permission.description}{permission.scope === "own_user" && <small>Solo su propia actividad</small>}</td>
          <td>{permission.enabled ? "Habilitado" : "No habilitado"}</td><td>{permission.implemented ? "Disponible" : "Previsto"}</td>
        </tr>)}</tbody>
      </table></div>}
    </>}
  </section>;
}
