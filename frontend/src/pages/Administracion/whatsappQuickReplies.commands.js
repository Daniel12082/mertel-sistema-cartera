export const normalizeCommand = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Commands are a view of the existing catalog, never a second template store.
export function quickReplyCommands(templates) {
  const rows = templates.filter(row => row?.id != null && typeof row.name === 'string' && typeof row.content === 'string')
    .map(row => ({ ...row, base: normalizeCommand(row.name).replace(/^mertel\s+/, '').match(/[a-z0-9]+/)?.[0].slice(0, 32) || 'plantilla' }));
  const counts = new Map();
  for (const row of rows) counts.set(row.base, (counts.get(row.base) || 0) + 1);
  const used = new Set();
  return rows.sort((a, b) => String(a.id).localeCompare(String(b.id))).map(row => {
    let command = counts.get(row.base) > 1 ? `${row.base}-${row.id}` : row.base;
    while (used.has(command) || command !== row.base && counts.has(command)) command += `-${row.id}`;
    used.add(command);
    return { ...row, command };
  });
}

export function quickReplyToken(text, caret) {
  const match = /(?:^|\s)\/([\p{L}\p{N}_-]*)$/u.exec(text.slice(0, caret));
  if (!match) return null;
  // Do not replace part of a word or a URL when the caret is inside it.
  const tail = /^[\p{L}\p{N}_-]*/u.exec(text.slice(caret))[0];
  const end = caret + tail.length;
  if (text[end] && !/\s/.test(text[end])) return null;
  return { start: caret - match[1].length - 1, end, query: normalizeCommand(match[1]) };
}

export function previewProblem(preview) {
  const missing = [...(preview.missing_variables || []), ...(preview.unsupported_variables || []), ...(preview.malformed_variables || [])];
  return missing.length ? `Información pendiente: ${missing.join(', ')}` : !preview.can_prepare ? 'Revisa el teléfono y el contenido de la plantilla.' : '';
}
