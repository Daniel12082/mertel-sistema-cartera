import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { analyzePortfolioFile, getPortfolioImports } from "../../services/portfolioImport.service";
import "./PortfolioImport.css";

const MAX_BYTES = 2 * 1024 * 1024;
function formatDate(value) { return value ? new Date(value).toLocaleString() : "—"; }

export default function PortfolioImport() {
  const { permissions = [] } = useAuth();
  const authorized = permissions.includes("portfolio.import");
  const [file, setFile] = useState(null); const [analysis, setAnalysis] = useState(null);
  const [history, setHistory] = useState([]); const [loading, setLoading] = useState(false);
  const [error, setError] = useState(""); const [historyError, setHistoryError] = useState("");
  const ready = authorized;

  const loadHistory = useCallback(async signal => {
    if (!ready) return;
    try { setHistory(await getPortfolioImports({ signal })); setHistoryError(""); }
    catch (reason) { if (!signal?.aborted) setHistoryError(reason.message); }
  }, [ready]);
  useEffect(() => {
    if (!ready) return undefined;
    const controller = new AbortController();
    getPortfolioImports({ signal: controller.signal })
      .then(rows => { if (!controller.signal.aborted) { setHistory(rows); setHistoryError(""); } })
      .catch(reason => { if (!controller.signal.aborted) setHistoryError(reason.message); });
    return () => controller.abort();
  }, [ready]);

  async function analyze() {
    setError(""); setAnalysis(null);
    if (!file) { setError("Selecciona un archivo CSV o XLSX."); return; }
    if (file.size > MAX_BYTES) { setError("El archivo supera el límite de 2 MiB."); return; }
    const extension = file.name.split(".").at(-1).toLowerCase();
    const supportedCsv = extension === "csv" && ["text/csv", "application/vnd.ms-excel", ""].includes(file.type);
    const supportedXlsx = extension === "xlsx" && ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ""].includes(file.type);
    if (!supportedCsv && !supportedXlsx) { setError("Selecciona un archivo .csv o una cartera MERTEL .xlsx."); return; }
    setLoading(true);
    try { const result = await analyzePortfolioFile(file); setAnalysis(result); await loadHistory(); }
    catch (reason) { setError(reason.message); }
    finally { setLoading(false); }
  }

  if (!authorized) return <section className="portfolio-import-page"><div className="portfolio-import-notice error" role="alert">No tienes permiso para analizar archivos de cartera.</div></section>;
  const mertelXlsx = analysis?.format === "mertel_xlsx";
  return <section className="portfolio-import-page">
    <header><h2>Importar cartera</h2><p>Analiza CSV o el Excel de cartera MERTEL sin modificar información comercial.</p></header>
    {ready && <section className="portfolio-import-card">
      <h3>Análisis estructural</h3>
      <p>Formatos: CSV UTF-8 o XLSX de MERTEL, máximo 2 MiB. El contenido del archivo no se almacena.</p>
      <label className="portfolio-import-file">Archivo CSV o Excel
        <input aria-label="Archivo CSV o Excel" type="file" accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={loading} onChange={event => { setFile(event.target.files?.[0] || null); setAnalysis(null); setError(""); }} />
      </label>
      {file && <p className="portfolio-import-file-meta">{file.name} · {(file.size / 1024).toFixed(1)} KiB</p>}
      {error && <div className="portfolio-import-notice error" role="alert">{error}</div>}
      <button type="button" disabled={!file || loading} onClick={analyze}>{loading ? "Analizando…" : "Analizar archivo"}</button>
    </section>}
    {analysis && <section className="portfolio-import-card" aria-live="polite">
      <h3>Resultado del análisis</h3>
      {mertelXlsx && <><h4>Reporte de origen</h4><div className="portfolio-import-summary"><span><strong>Empresa</strong>{analysis.report.company_name || "No identificada"}</span><span><strong>NIT</strong>{analysis.report.company_nit || "No identificado"}</span><span><strong>Fecha</strong>{analysis.report.report_date || "No identificada"}</span><span><strong>Hoja</strong>{analysis.selected_sheet}</span></div>
        <h4>Clasificación</h4><div className="portfolio-import-summary"><span><strong>Clientes detectados</strong>{analysis.summary.clients_detected}</span><span><strong>Documentos</strong>{analysis.summary.unique_documents}</span><span><strong>Facturas</strong>{analysis.summary.invoices}</span><span><strong>Devoluciones</strong>{analysis.summary.returns}</span><span><strong>Notas débito</strong>{analysis.summary.debit_notes}</span><span><strong>Movimientos desconocidos</strong>{analysis.summary.unknown_movements}</span><span><strong>Resúmenes cliente</strong>{analysis.classifications.customer_summary_rows}</span><span><strong>Totales del reporte</strong>{analysis.classifications.report_summary_rows}</span><span><strong>Filas vacías</strong>{analysis.empty_rows}</span><span><strong>Filas con errores</strong>{analysis.failed_rows}</span></div></>}
      <div className="portfolio-import-summary"><span><strong>Archivo</strong>{analysis.file.name}</span><span><strong>Filas leídas</strong>{analysis.total_rows}</span><span><strong>Columnas</strong>{analysis.headers.length}</span><span><strong>Válidas</strong>{analysis.successful_rows}</span><span><strong>Con errores</strong>{analysis.failed_rows}</span></div>
      <p><strong>Columnas detectadas:</strong> {analysis.headers.map(header => header || "(vacía)").join(" · ") || "Ninguna"}</p>
      <p><strong>Estado:</strong> {analysis.format_configured ? "Formato de análisis MERTEL reconocido; aplicación financiera pendiente" : "Análisis estructural; formato de aplicación no configurado"}</p>
      {analysis.duplicate && <div className="portfolio-import-notice">Este archivo ya fue analizado. Se muestra la referencia al lote existente; no se creó otro lote.</div>}
      {analysis.persistence?.saved === false && <div className="portfolio-import-notice error" role="alert">{analysis.persistence.message} Puedes revisar la previsualización; no se creó lote ni se guardó el archivo.</div>}
      <div className="portfolio-import-notice">Análisis y previsualización solamente. No se crearon ni modificaron clientes, facturas, pagos, asignaciones o saldos.</div>
      {analysis.preview.length > 0 && <div className="portfolio-import-table-wrap"><table><thead>{mertelXlsx ? <tr>{["Fila", "Tipo", "NIT cliente", "Documento", "Movimiento", "Emitida", "Vence", "Valor doc.", "IVA", "Cupo", "Condición cupo"].map(label => <th key={label}>{label}</th>)}</tr> : <tr>{analysis.headers.map((header, index) => <th key={`${header}-${index}`}>{header || `(columna ${index + 1})`}</th>)}</tr>}</thead><tbody>{analysis.preview.map((row, index) => <tr key={mertelXlsx ? row.row_number : index}>{mertelXlsx ? <>{[row.row_number, row.type, row.customer_nit_original, row.document_number || "—", row.movement || "—", row.issue_date || "—", row.due_date || "—", row.document_value ?? "—", row.iva ?? "—", row.cupo_amount ?? "—", row.cupo_condition || "—"].map((value, cell) => <td key={cell}>{value}</td>)}</> : analysis.headers.map((_, cell) => <td key={cell}>{row[cell] ?? ""}</td>)}</tr>)}</tbody></table></div>}
      {analysis.issues.length > 0 && <div className="portfolio-import-issues"><h4>Errores y advertencias ({analysis.issues.length})</h4><ul>{analysis.issues.map((issue, index) => <li key={`${issue.error_code}-${index}`}><strong>{issue.severity === "warning" ? "Advertencia" : "Error"} · {issue.error_code}</strong>{issue.row_number ? ` · fila ${issue.row_number}` : ""}{issue.field_name ? ` · ${issue.field_name}` : ""}: {issue.message}</li>)}</ul></div>}
    </section>}
    {ready && <section className="portfolio-import-card"><h3>Historial de análisis</h3>
      {historyError && <div className="portfolio-import-notice error" role="alert">{historyError}</div>}
      {!historyError && history.length === 0 && <p>MERTEL Importaciones todavía no tiene análisis de cartera.</p>}
      {history.length > 0 && <div className="portfolio-import-table-wrap"><table><thead><tr><th>Archivo</th><th>Fecha</th><th>Usuario</th><th>Estado</th><th>Filas</th><th>Incidencias</th></tr></thead><tbody>{history.map(row => <tr key={row.id}><td>{row.file_name}</td><td>{formatDate(row.created_at)}</td><td>{row.first_name || "—"}</td><td>{row.status}</td><td>{row.total_rows}</td><td>{row.error_count}</td></tr>)}</tbody></table></div>}
    </section>}
  </section>;
}
