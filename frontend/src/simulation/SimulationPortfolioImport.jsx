import { useEffect, useRef, useState } from 'react';
import { useAppDataMode } from './useAppDataMode';
import { loadTemporaryPortfolio } from './store';

export default function SimulationPortfolioImport() {
  const { source } = useAppDataMode();
  const [file, setFile] = useState(null), [result, setResult] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const controller = useRef(null);
  useEffect(() => () => controller.current?.abort(), []);
  function selectFile(event) {
    controller.current?.abort(); setBusy(false); setFile(event.target.files?.[0] || null); setResult(null); setError('');
  }
  async function analyze() {
    const operation = new AbortController(); controller.current?.abort(); controller.current = operation;
    setBusy(true); setError(''); setResult(null);
    try {
      const { analyzeTemporaryPortfolio } = await import('./temporaryPortfolio');
      const analyzed = await analyzeTemporaryPortfolio(file, { signal: operation.signal });
      if (!operation.signal.aborted) setResult(analyzed);
    } catch (failure) { if (!operation.signal.aborted) setError(failure.message); }
    finally { if (!operation.signal.aborted) setBusy(false); }
  }
  function load() {
    try { loadTemporaryPortfolio(result.prepared, result.epoch); } catch (failure) { setError(failure.message); }
  }
  return <section className="portfolio-import-page">
    <header><h2>Importar cartera</h2><p>Importación simulada · Procesamiento local y temporal.</p></header>
    <div className="simulation-import-note" role="status">El archivo se procesa en este navegador. No se envía al backend ni se guarda en MySQL o en el almacenamiento del navegador. Se descarta al reiniciar, salir o recargar la página. Los nombres, NIT y saldos de tu archivo serán visibles mientras simulas.</div>
    {source && <section className="portfolio-import-card" aria-live="polite"><h3>Cartera temporal activa</h3><p>{source.file_name} · {source.customers} clientes · {source.invoices} facturas. Ya puedes consultar Dashboard, clientes, facturas, cartera y cobranza.</p></section>}
    <section className="portfolio-import-card"><h3>Cargar archivo en memoria</h3>
      <p>XLSX MERTEL con la hoja «cartera de clientes NIIF0» o CSV UTF-8 con las mismas columnas, máximo 2 MiB. El saldo se lee de las columnas de antigüedad. No se aplican devoluciones ni notas débito como pagos.</p>
      <label className="portfolio-import-file">Archivo CSV o Excel<input aria-label="Archivo CSV o Excel" type="file" accept=".csv,.xlsx" onChange={selectFile} disabled={busy} /></label>
      {file && <p>{file.name}</p>}
      <button type="button" disabled={!file || busy} onClick={analyze}>{busy ? 'Analizando localmente…' : 'Analizar archivo localmente'}</button>
      {error && <p role="alert" className="portfolio-import-notice error">{error}</p>}
    </section>
    {result && <section className="portfolio-import-card"><h3>Vista previa temporal</h3>
      <p>{result.prepared.customers.length} clientes · {result.prepared.invoices.length} facturas. Al cargar se reemplazará toda la cartera y las operaciones de esta simulación.</p>
      <p>Documentos sin aplicar: {result.prepared.source.skipped_documents} (devoluciones y notas débito). Base de descuento no inferida: los beneficios que requieran una base verificada quedan sujetos a revisión.</p>
      <div className="portfolio-import-table-wrap"><table><thead><tr><th>Cliente</th><th>NIT</th><th>Factura</th><th>Vencimiento</th><th>Saldo</th></tr></thead><tbody>{result.prepared.invoices.slice(0, 25).map(invoice => {
        const customer = result.prepared.customers.find(row => row.id === invoice.customer_id);
        return <tr key={invoice.id}><td>{customer.name}</td><td>{customer.nit}</td><td>{invoice.invoice_number}</td><td>{invoice.due_date}</td><td>{invoice.balance}</td></tr>;
      })}</tbody></table></div>
      <button type="button" onClick={load}>Cargar cartera temporal</button>
    </section>}
  </section>;
}
