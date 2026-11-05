import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { validateXlsxArchive } from '../src/utils/xlsxSecurity.js';
test('XLSX archive accepts ordinary workbooks and rejects malformed and oversized archives', async () => {
  const book = new ExcelJS.Workbook(); book.addWorksheet('test').addRow(['value', 10]);
  const bytes = Buffer.from(await book.xlsx.writeBuffer());
  assert.doesNotThrow(() => validateXlsxArchive(bytes));
  assert.throws(() => validateXlsxArchive(Buffer.from('PK invalid')), { code: 'INVALID_XLSX' });
  assert.throws(() => validateXlsxArchive(bytes.subarray(0, bytes.length - 2)), { code: 'INVALID_XLSX' });
  assert.throws(() => validateXlsxArchive(Buffer.alloc(11 * 1024 * 1024)), { code: 'INVALID_XLSX' });
});
