import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export async function applyWhatsAppMigration(db) {
  const [[{ name }]] = await db.query('SELECT DATABASE() AS name');
  if (!name) throw new Error('Selecciona una base de datos existente.');
  const lock = `mertel_wa_${createHash('sha256').update(name).digest('hex').slice(0, 32)}`;
  const [[{ acquired }]] = await db.query('SELECT GET_LOCK(?,10) AS acquired', [lock]);
  if (acquired !== 1) throw new Error('Otra migración de WhatsApp está en curso.');
  try {
    const [columns] = await db.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='messages'");
    const names = new Set(columns.map(row => row.COLUMN_NAME));
    const added = ['stage', 'direction', 'message_mode', 'idempotency_key', 'scheduled_at', 'budget_date', 'attempts', 'last_attempt_at', 'next_attempt_at', 'received_at'];
    const [indexes] = await db.query("SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='messages'");
    const indexNames = new Set(indexes.map(row => row.INDEX_NAME));
    const required = ['uk_messages_idempotency', 'uk_messages_provider_event', 'idx_messages_queue', 'idx_messages_budget'];
    if (!names.has('id')) throw new Error('Falta la tabla messages. No se ejecutará la migración 001.');
    if (added.every(column => names.has(column)) && required.every(index => indexNames.has(index))) return { migration: '007_whatsapp_center.sql', applied: false };
    if (added.some(column => names.has(column)) || required.some(index => indexNames.has(index))) throw new Error('Migración WhatsApp parcial: requiere revisión manual.');
    const sql = await readFile(new URL('../../../database/migrations/007_whatsapp_center.sql', import.meta.url), 'utf8');
    await db.query(sql);
    return { migration: '007_whatsapp_center.sql', applied: true };
  } finally { await db.query('SELECT RELEASE_LOCK(?)', [lock]); }
}
