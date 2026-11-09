import { operationError } from './collectionOperations.validation.js';

export const MAX_WHATSAPP_UPLOAD_BYTES = 5 * 1024 * 1024;
const isMp4 = bytes => bytes.subarray(4, 8).toString('ascii') === 'ftyp';
const formats = {
  'image/jpeg': { type: 'image', extension: 'jpg', valid: bytes => bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) },
  'image/png': { type: 'image', extension: 'png', valid: bytes => bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) },
  'application/pdf': { type: 'document', extension: 'pdf', valid: bytes => bytes.subarray(0, 5).toString('ascii') === '%PDF-' },
  'audio/mpeg': { type: 'audio', extension: 'mp3', valid: bytes => bytes.subarray(0, 3).toString('ascii') === 'ID3' ||
    (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) !== 0) },
  'audio/ogg': { type: 'audio', extension: 'ogg', valid: bytes => bytes.subarray(0, 4).toString('ascii') === 'OggS' &&
    bytes.subarray(0, 64).includes(Buffer.from('OpusHead')) },
  'audio/mp4': { type: 'audio', extension: 'm4a', valid: isMp4 },
  'video/mp4': { type: 'video', extension: 'mp4', valid: isMp4 },
};

export async function parseWhatsAppMediaUpload(bytes, contentType) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw operationError(400, 'Selecciona un archivo para enviar.');
  let form;
  try { form = await new Response(bytes, { headers: { 'Content-Type': contentType } }).formData(); }
  catch { throw operationError(400, 'No se pudo leer el archivo adjunto.'); }
  const allowed = ['file', 'recipient', 'customer_id', 'content'];
  if ([...form.keys()].some(key => !allowed.includes(key) || form.getAll(key).length !== 1)) throw operationError(400, 'Campos de adjunto inválidos.');
  const file = form.get('file');
  const mime = file?.type?.split(';')[0];
  const format = Object.hasOwn(formats, mime) ? formats[mime] : null;
  if (!format || !file.size || file.size > MAX_WHATSAPP_UPLOAD_BYTES) {
    throw operationError(400, 'Usa un JPG, PNG, PDF, MP4, MP3, M4A u OGG Opus de hasta 5 MB.');
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!format.valid(buffer)) throw operationError(400, 'El contenido no corresponde al tipo de archivo seleccionado.');
  const name = file.name.split(/[\\/]/).at(-1).replace(/\.[^.]*$/, '').replace(/[\p{C}]/gu, '').trim().slice(0, 100);
  return {
    body: { recipient: form.get('recipient'), content: form.get('content') ?? '', ...(form.has('customer_id') ? { customer_id: form.get('customer_id') } : {}) },
    attachment: { buffer, mime, type: format.type, name: `${name || 'adjunto'}.${format.extension}` },
  };
}
