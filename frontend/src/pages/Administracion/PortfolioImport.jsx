import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { analyzePortfolioFile, getPortfolioImportCompanies, getPortfolioImports } from "../../services/portfolioImport.service";
import "./PortfolioImport.css";

const MAX_BYTES = 2 * 1024 * 1024;
function formatDate(value) { return value ? new Date(value).toLocaleString() : "—"; }

export default function PortfolioImport() {
  const { user, permissions = [] } = useAuth();
  const authorized = permissions.includes("portfolio.import");
  const globalAdmin = user?.is_global_admin === true;
  const [companies, setCompanies] = useState([]); const [companyId, setCompanyId] = useState("");
  const [file, setFile] = useState(null); const [analysis, setAnalysis] = useState(null);
  const [history, setHistory] = useState([]); const [loading, setLoading] = useState(false);
  const [error, setError] = useState(""); const [historyError, setHistoryError] = useState("");
  const ready = authorized && (!globalAdmin || Boolean(companyId));

  useEffect(() => {
    if (!authorized || !globalAdmin) return undefined;
    const controller = new AbortController();
    getPortfolioImportCompanies({ signal: controller.signal }).then(setCompanies).catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [authorized, globalAdmin]);

  const loadHistory = useCallback(async signal => {
    if (!ready) return;
    try { setHistory(await getPortfolioImports({ companyId: globalAdmin ? companyId : undefined, signal })); setHistoryError(""); }
    catch (reason) { if (!signal?.aborted) setHistoryError(reason.message); }
  }, [ready, globalAdmin, companyId]);
  useEffect(() => {
    if (!ready) return undefined;
    const controller = new AbortController();
    getPortfolioImports({ companyId: globalAdmin ? companyId : undefined, signal: controller.signal })
      .then(rows => { if (!controller.signal.aborted) { setHistory(rows); setHistoryError(""); } })
      .catch(reason => { if (!controller.signal.aborted) setHistoryError(reason.message); });
    return () => controller.abort();
  }, [ready, globalAdmin, companyId]);

  async function analyze() {
    setError(""); setAnalysis(null);
    if (!file) { setError("Selecciona un archivo CSV."); return; }
    if (file.size > MAX_BYTES) { setError("El archivo supera el límite de 2 MiB."); return; }
    if (!file.name.toLowerCase().endsWith(".csv") || !["text/csv", "application/vnd.ms-excel", ""].includes(file.type)) { setError("Selecciona un archivo .csv."); return; }
    setLoading(true);
    try { const result = await analyzePortfolioFile(file, { companyId: globalAdmin ? companyId : undefined }); setAnalysis(result); await loadHistory(); }
    catch (reason) { setError(reason.message); }
    finally { setLoading(false); }
  }

  if (!authorized) return <section className="portfolio-import-page"><div className="portfolio-import-notice error" role="alert">No tienes permiso para analizar archivos de cartera.</div></section>;
  return <section className="portfolio-import-page">
    <header><h2>Importar cartera</h2><p>Analiza la estructura de un CSV sin modificar información comercial.</p></header>
    {globalAdmin && <label className="portfolio-import-company">Empresa
      <select aria-label="Empresa" value={companyId} onChange={event => { setCompanyId(event.target.value); setAnalysis(null); setHistory([]); }}>
        <option value="">{companies.length ? "Selecciona una empresa" : "No hay empresas disponibles"}</option>
        {companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}
      </select>
    </label>}
    {globalAdmin && !companyId && <div className="portfolio-import-notice">Selecciona una empresa para analizar archivos y consultar su historial.</div>}
    {ready && <section className="portfolio-import-card">
      <h3>Análisis estructural</h3>
      <p>Formato aceptado en esta fase: CSV UTF-8, máximo 2 MiB. El archivo no se almacena.</p>
      <label className="portfolio-import-file">Archivo CSV
        <input aria-label="Archivo CSV" type="file" accept=".csv,text/csv" disabled={loading} onChange={event => { setFile(event.target.files?.[0] || null); setAnalysis(null); setError(""); }} />
      </label>
      {file && <p className="portfolio-import-file-meta">{file.name} · {(file.size / 1024).toFixed(1)} KiB</p>}
      {error && <div className="portfolio-import-notice error" role="alert">{error}</div>}
      <button type="button" disabled={!file || loading} onClick={analyze}>{loading ? "Analizando…" : "Analizar archivo"}</button>
    </section>}
    {analysis && <section className="portfolio-import-card" aria-live="polite">
      <h3>Resultado del análisis</h3>
      <div className="portfolio-import-summary"><span><strong>Archivo</strong>{analysis.file.name}</span><span><strong>Filas</strong>{analysis.total_rows}</span><span><strong>Columnas</strong>{analysis.headers.length}</span><span><strong>Vacías</strong>{analysis.empty_rows}</span><span><strong>Válidas estructuralmente</strong>{analysis.successful_rows}</span><span><strong>Con errores</strong>{analysis.failed_rows}</span></div>
      <p><strong>Columnas detectadas:</strong> {analysis.headers.map(header => header || "(vacía)").join(" · ") || "Ninguna"}</p>
      <p><strong>Estado:</strong> Formato no configurado</p>
      {analysis.duplicate && <div className="portfolio-import-notice">Este archivo ya fue analizado. Se muestra la referencia al lote existente; no se creó otro lote.</div>}
      <div className="portfolio-import-notice">El archivo fue analizado correctamente, pero el formato de cartera de MERTEL aún no está configurado. No se realizaron cambios.</div>
      {analysis.preview.length > 0 && <div className="portfolio-import-table-wrap"><table><thead><tr>{analysis.headers.map((header, index) => <th key={`${header}-${index}`}>{header || `(columna ${index + 1})`}</th>)}</tr></thead><tbody>{analysis.preview.map((row, index) => <tr key={index}>{analysis.headers.map((_, cell) => <td key={cell}>{row[cell] ?? ""}</td>)}</tr>)}</tbody></table></div>}
      {analysis.issues.length > 0 && <div className="portfolio-import-issues"><h4>Errores y advertencias ({analysis.issues.length})</h4><ul>{analysis.issues.map((issue, index) => <li key={`${issue.error_code}-${index}`}><strong>{issue.severity === "warning" ? "Advertencia" : "Error"} · {issue.error_code}</strong>{issue.row_number ? ` · fila ${issue.row_number}` : ""}{issue.field_name ? ` · ${issue.field_name}` : ""}: {issue.message}</li>)}</ul></div>}
    </section>}
    {ready && <section className="portfolio-import-card"><h3>Historial de análisis</h3>
      {historyError && <div className="portfolio-import-notice error" role="alert">{historyError}</div>}
      {!historyError && history.length === 0 && <p>No hay archivos analizados para esta empresa.</p>}
      {history.length > 0 && <div className="portfolio-import-table-wrap"><table><thead><tr><th>Archivo</th><th>Fecha</th><th>Usuario</th><th>Estado</th><th>Filas</th><th>Incidencias</th></tr></thead><tbody>{history.map(row => <tr key={row.id}><td>{row.file_name}</td><td>{formatDate(row.created_at)}</td><td>{row.first_name || "—"}</td><td>{row.status}</td><td>{row.total_rows}</td><td>{row.error_count}</td></tr>)}</tbody></table></div>}
    </section>}
  </section>;
}
