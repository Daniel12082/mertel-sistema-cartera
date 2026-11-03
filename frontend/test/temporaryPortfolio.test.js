import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { analyzeTemporaryPortfolio } from '../src/simulation/temporaryPortfolio';
import { enterSimulation, leaveSimulation, loadTemporaryPortfolio, resetSimulation, simulationData, simulationSnapshot } from '../src/simulation/store';
import { makeMertelWorkbook, mertelRow, MERTEL_FIXTURE_COLUMNS } from '../../backend/test/fixtures/mertelPortfolioWorkbook.js';
import { permissionsForRoles } from '../../backend/src/config/permissions.js';
import api from '../src/services/api';

const identity = { roles: [{ name: 'admin' }], permissions: permissionsForRoles([{ name: 'admin' }]) };
const file = (bytes, name = 'Cartera-personal.xlsx') => ({ name, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
beforeEach(() => { leaveSimulation(); enterSimulation(identity); api.defaults.adapter = vi.fn(() => { throw new Error('NETWORK FORBIDDEN'); }); });
afterEach(() => { leaveSimulation(); vi.restoreAllMocks(); });

it('loads XLSX in memory and reads outstanding balance from aging buckets, never original value or demo payments', async () => {
  const bytes = await makeMertelWorkbook({ rows: [mertelRow({ 'Nombre cliente': 'CLIENTE ARCHIVO PRIVADO', 'Valor doc.': '3,482,310', Corriente: '1,200,000.50', '1-30 días': '100,000.25' })] });
  const result = await analyzeTemporaryPortfolio(file(bytes));
  expect(simulationData().customers[0].name).toContain('DEMO'); // Preview has no side effects.
  expect(result.prepared.invoices[0].balance).toBe('1300000.75');
  loadTemporaryPortfolio(result.prepared, result.epoch);
  expect((await api.get('/customers')).data.data[0].name).toBe('CLIENTE ARCHIVO PRIVADO');
  expect((await api.get('/invoices')).data.data[0].invoice_number).toBe('ME-12345');
  expect(simulationData().payments).toEqual([]); expect(simulationData().allocations).toEqual([]);
  expect((await api.get('/admin/dashboard')).data.data.summary.data.total_balance).toBe('1300000.75');
  expect(api.defaults.adapter).not.toHaveBeenCalled();
  expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('CLIENTE ARCHIVO PRIVADO');
  resetSimulation(); expect(simulationData().customers[0].name).toContain('DEMO'); expect(simulationSnapshot().source).toBeNull();
  expect(() => loadTemporaryPortfolio(result.prepared, result.epoch)).toThrow(/cambió/);
});
it('loads CSV with the same MERTEL columns without any network traffic', async () => {
  const records = [MERTEL_FIXTURE_COLUMNS, mertelRow({ 'Nombre cliente': 'CLIENTE CSV TEMPORAL', Corriente: '999.50' })];
  const bytes = new TextEncoder().encode(records.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n'));
  const result = await analyzeTemporaryPortfolio(file(bytes, 'cartera.csv'));
  loadTemporaryPortfolio(result.prepared, result.epoch);
  expect(simulationData().customers[0].name).toBe('CLIENTE CSV TEMPORAL'); expect(simulationData().invoices[0].balance).toBe('999.50');
  expect(api.defaults.adapter).not.toHaveBeenCalled();
});
it('rejects invalid and duplicated documents atomically, and never guesses missing balances', async () => {
  for (const [rows, error] of [
    [[mertelRow({ Corriente: '' })], /no hay saldo/],
    [[mertelRow({ Corriente: '-100' })], /negativo/],
    [[mertelRow(), mertelRow()], /repetido/],
    [[mertelRow({ Vence: '31/02/2026' })], /vencimiento/],
  ]) {
    await expect(analyzeTemporaryPortfolio(file(await makeMertelWorkbook({ rows })))).rejects.toThrow(error);
    expect(simulationData().customers[0].name).toContain('DEMO');
  }
  expect(api.defaults.adapter).not.toHaveBeenCalled();
});
it('blocks parsing and loading after exit or reset and respects the existing import permission', async () => {
  const input = file(await makeMertelWorkbook({ rows: [mertelRow()] }));
  const result = await analyzeTemporaryPortfolio(input);
  leaveSimulation(); expect(() => loadTemporaryPortfolio(result.prepared, result.epoch)).toThrow(/cambió/);
  await expect(analyzeTemporaryPortfolio(input)).rejects.toThrow(/cambió/);
  enterSimulation({ roles: [], permissions: ['collection.view'] });
  await expect(analyzeTemporaryPortfolio(input)).rejects.toThrow(/permiso/);
});
it('clears an imported portfolio on exit and reload stores only the safe demo display, never the file', async () => {
  const result = await analyzeTemporaryPortfolio(file(await makeMertelWorkbook({ rows: [mertelRow()] })));
  loadTemporaryPortfolio(result.prepared, result.epoch); leaveSimulation();
  expect(() => simulationData()).toThrow();
  expect(sessionStorage.getItem('mertel_simulation_mode')).toBeNull();
  expect(sessionStorage.getItem('mertel_simulation_display')).toBeNull();
});
