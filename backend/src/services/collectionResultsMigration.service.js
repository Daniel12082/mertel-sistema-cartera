import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

export async function applyCollectionResultsMigration(db) {
  const [[{name}]] = await db.query('SELECT DATABASE() AS name');
  if (!name) throw new Error('Selecciona una base de datos existente.');
  const lock = `mertel_results_${createHash('sha256').update(name).digest('hex').slice(0,30)}`;
  const [[{acquired}]] = await db.query('SELECT GET_LOCK(?,10) AS acquired',[lock]);
  if (acquired !== 1) throw new Error('Otra migración de resultados está en curso.');
  try {
    const sql = await readFile(new URL('../../../database/migrations/009_collection_results_payments.sql',import.meta.url),'utf8');
    let applied = false;
    for (const statement of sql.split(';').map(part => part.trim()).filter(Boolean)) {
      const table = statement.match(/ALTER TABLE (\w+)/)?.[1];
      const expected = [...statement.matchAll(/ADD COLUMN (\w+)/g)].map(match => match[1]);
      const [columns] = await db.query('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[table]);
      const names = new Set(columns.map(column => column.COLUMN_NAME));
      const [indexes] = await db.query('SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[table]);
      const indexNames = new Set(indexes.map(row => row.INDEX_NAME));
      const requiredIndexes = [...statement.matchAll(/ADD (?:UNIQUE )?KEY (\w+)/g)].map(match => match[1]);
      if (!names.has('id')) throw new Error(`Falta la tabla ${table}. No se ejecutará la migración 001.`);
      if (expected.every(column => names.has(column)) && requiredIndexes.every(index => indexNames.has(index))) continue;
      if (expected.some(column => names.has(column)) || requiredIndexes.some(index => indexNames.has(index))) throw new Error('Migración de resultados parcial: requiere revisión manual.');
      await db.query(statement); applied = true;
    }
    return {migration:'009_collection_results_payments.sql',applied};
  } finally { await db.query('SELECT RELEASE_LOCK(?)',[lock]); }
}
