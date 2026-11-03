import { parseMertelPortfolioWorkbook, MERTEL_SHEET_NAME, parseMertelAmount } from '../../../backend/src/services/mertelPortfolioWorkbookParser.js';
import { parseCsv } from '../../../backend/src/services/portfolioCsvParser.js';
import { moneyCents } from '../../../backend/src/services/collectionMoney.js';
import { createSimulationDataset } from './dataset';
import { simulationSnapshot } from './store';

const buckets = ['Corriente', '1-30 días', '30-45 días', '45-60 días', '60-90 días', '+90 días'];
const toMoney = value => {
  const cents = moneyCents(value);
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
};
function assertCurrent(epoch, signal) {
  const current = simulationSnapshot();
  if (signal?.aborted || current.mode !== 'SIMULATION' || current.epoch !== epoch) throw new Error('La simulación cambió; vuelve a seleccionar el archivo.');
  if (!current.display.permissions.includes('portfolio.import')) throw new Error('No tienes permiso para cargar cartera.');
}
export async function analyzeTemporaryPortfolio(file, { signal } = {}) {
  const epoch = simulationSnapshot().epoch;
  assertCurrent(epoch, signal);
  if (!file || file.size === 0 || file.size > 2 * 1024 * 1024) throw new Error('Selecciona un archivo no vacío de máximo 2 MiB.');
  const extension = file.name.split('.').at(-1).toLowerCase();
  if (!['csv', 'xlsx'].includes(extension)) throw new Error('Selecciona un archivo .csv o .xlsx con las columnas de cartera MERTEL.');
  // Browser build only; the server parser's workbook classification is shared unchanged.
  const { default: ExcelJS } = await import('exceljs/dist/exceljs.min.js');
  const bytes = new Uint8Array(await file.arrayBuffer());
  assertCurrent(epoch, signal);
  const workbook = new ExcelJS.Workbook();
  if (extension === 'xlsx') {
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('El archivo no es un libro XLSX válido.');
    try { await workbook.xlsx.load(bytes); } catch { throw new Error('No se pudo leer el libro XLSX.'); }
  } else {
    const sheet = workbook.addWorksheet(MERTEL_SHEET_NAME);
    parseCsv(bytes).forEach(row => sheet.addRow(row));
  }
  assertCurrent(epoch, signal);
  const analysis = parseMertelPortfolioWorkbook(workbook);
  if (analysis.missing_columns.length) throw new Error(`Faltan columnas MERTEL: ${analysis.missing_columns.join(', ')}.`);
  const blocking = analysis.issues.filter(issue => (issue.severity === 'error' && !['SOURCE_COMPANY_MISMATCH', 'SOURCE_NIT_MISMATCH'].includes(issue.error_code)) || issue.error_code === 'DUPLICATE_DOCUMENT');
  if (blocking.length) throw new Error(`Corrige el archivo antes de cargarlo: ${blocking.slice(0, 5).map(issue => `fila ${issue.row_number}: ${issue.message}`).join(' · ')}`);
  const prepared = createSimulationDataset();
  for (const key of ['customers', 'invoices', 'payments', 'allocations', 'actions', 'promises', 'reports', 'messages', 'resolution', 'events']) prepared[key] = [];
  prepared.confirmations = {}; prepared.idempotency = {};
  const customers = new Map();
  const documents = analysis.documents.filter(row => row.type === 'DOCUMENT' && row.movement_type === 'invoice');
  if (!documents.length) throw new Error('El archivo no contiene facturas de venta válidas para simular.');
  for (const row of documents) {
    const values = row.values;
    let customer = customers.get(row.customer_nit_normalized);
    if (!customer) {
      customer = { id: String(81000001 + customers.size), company_id: null, simulation: true, status: 'active',
        nit: row.customer_nit_original, name: values['Nombre cliente'] || `Cliente ${row.customer_nit_original}`,
        address: values.Direccion || '', city: values.Ciudad || '', phone: '', email: '',
        notes: 'Cartera temporal del archivo. Contacto deshabilitado; no hay envíos reales.' };
      customers.set(row.customer_nit_normalized, customer); prepared.customers.push(customer);
    }
    // Aging buckets represent outstanding balance, not original invoice value.
    const populated = buckets.filter(key => String(values[key] ?? '').trim());
    if (!populated.length) throw new Error(`Fila ${row.row_number}: no hay saldo en las columnas de antigüedad. No se inferirá del valor original.`);
    let balance = 0n;
    for (const key of populated) {
      const amount = parseMertelAmount(values[key]);
      if (amount == null) throw new Error(`Fila ${row.row_number}: saldo inválido en ${key}.`);
      try { balance += moneyCents(amount); } catch { throw new Error(`Fila ${row.row_number}: saldo negativo o con precisión inválida en ${key}.`); }
    }
    const balanceText = toMoney(`${balance / 100n}.${String(balance % 100n).padStart(2, '0')}`);
    const invoiceId = String(82000001 + prepared.invoices.length);
    prepared.invoices.push({ id: invoiceId, invoice_id: invoiceId, customer_id: customer.id, company_id: null, simulation: true,
      invoice_number: row.document_number, issue_date: row.issue_date, due_date: row.due_date,
      document_value: toMoney(row.document_value), base_value: null, iva_value: toMoney(row.iva), balance: balanceText,
      status: balance === 0n ? 'paid' : 'pending', notes: values.Observaciones || '', promo_18: null, discount: null });
  }
  const skipped = analysis.documents.length - documents.length;
  prepared.source = { file_name: file.name, customers: prepared.customers.length, invoices: prepared.invoices.length, skipped_documents: skipped };
  prepared.imports = [{ id: 'TEMP-LOCAL', file_name: file.name, file_type: extension, total_rows: analysis.total_rows,
    successful_rows: documents.length, failed_rows: 0, error_count: 0, status: 'Importación simulada · Solo en memoria', created_at: new Date().toISOString() }];
  assertCurrent(epoch, signal);
  return { epoch, prepared, analysis };
}
