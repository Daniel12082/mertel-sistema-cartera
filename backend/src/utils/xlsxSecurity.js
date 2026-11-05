import { inflateRawSync } from 'node:zlib';
const invalid = () => Object.assign(new Error('Archivo XLSX inválido o excede los límites permitidos'), { status: 400, code: 'INVALID_XLSX' });
// Validate the archive before ExcelJS allocates XML/workbook objects.
export function validateXlsxArchive(bytes) {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length < 22 || bytes.length > 10 * 1024 * 1024) throw invalid();
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
    }
    if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) throw invalid();
    const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12);
    let cursor = bytes.readUInt32LE(end + 16), total = 0;
    if (!count || count > 2000 || bytes.readUInt16LE(end + 8) !== count || cursor + size !== end) throw invalid();
    const names = new Set();
    for (let i = 0; i < count; i++) {
      if (bytes.readUInt32LE(cursor) !== 0x02014b50) throw invalid();
      const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10);
      const compressed = bytes.readUInt32LE(cursor + 20), expanded = bytes.readUInt32LE(cursor + 24);
      const nameLength = bytes.readUInt16LE(cursor + 28), extra = bytes.readUInt16LE(cursor + 30), comment = bytes.readUInt16LE(cursor + 32);
      const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
      const local = bytes.readUInt32LE(cursor + 42);
      total += expanded;
      if (flags & 1 || ![0,8].includes(method) || expanded > 20 * 1024 * 1024 || total > 50 * 1024 * 1024 || names.has(name) || name.includes('..') || name.includes('\\') || name.startsWith('/') || /vbaProject|externalLinks|embeddings/i.test(name)) throw invalid();
      names.add(name);
      if (bytes.readUInt32LE(local) !== 0x04034b50 || bytes.readUInt16LE(local + 8) !== method) throw invalid();
      const localNameLength = bytes.readUInt16LE(local + 26);
      if (bytes.subarray(local + 30, local + 30 + localNameLength).toString('utf8') !== name) throw invalid();
      const start = local + 30 + localNameLength + bytes.readUInt16LE(local + 28);
      if (start + compressed > bytes.readUInt32LE(end + 16)) throw invalid();
      const data = bytes.subarray(start, start + compressed);
      const output = method === 8 ? inflateRawSync(data, { maxOutputLength: Math.max(1, expanded) }) : data;
      if (output.length !== expanded) throw invalid();
      cursor += 46 + nameLength + extra + comment;
    }
    if (cursor !== end || !names.has('[Content_Types].xml') || !names.has('xl/workbook.xml')) throw invalid();
  } catch { throw invalid(); }
}
