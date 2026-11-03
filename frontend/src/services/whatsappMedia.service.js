import { simulationData, simulationSnapshot, subscribeSimulation } from '../simulation/store';

export const MEDIA_TYPES = { text: 'Solo texto', image: 'Imagen', video: 'Video', audio: 'Audio' };
const MIME_TYPES = {
  image: ['image/jpeg', 'image/png', 'image/webp'],
  video: ['video/mp4', 'video/webm'],
  audio: ['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/webm'],
};
const limit = (value, fallback) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
export const MEDIA_LIMITS = Object.freeze({
  image: limit(import.meta.env.VITE_WHATSAPP_MEDIA_IMAGE_MAX_BYTES, 5 * 1024 * 1024),
  video: limit(import.meta.env.VITE_WHATSAPP_MEDIA_VIDEO_MAX_BYTES, 10 * 1024 * 1024),
  audio: limit(import.meta.env.VITE_WHATSAPP_MEDIA_AUDIO_MAX_BYTES, 5 * 1024 * 1024),
  session: limit(import.meta.env.VITE_WHATSAPP_MEDIA_SESSION_MAX_BYTES, 40 * 1024 * 1024),
});
export const mediaAccept = type => (type && type !== 'text' ? MIME_TYPES[type] || [] : Object.values(MIME_TYPES).flat()).join(',');
export const mediaSize = size => `${(size / (1024 * 1024)).toFixed(2)} MB`;
export const MEDIA_UNAVAILABLE = 'El proveedor MOCK actual no transporta archivos. Este adjunto solo se puede preparar y probar en Simulación; no se guardará ni enviará en producción.';

export function validateMediaFile(file, expectedType) {
  const type = Object.keys(MIME_TYPES).find(key => MIME_TYPES[key].includes(file?.type));
  if (!type || expectedType && expectedType !== type) throw new Error('Tipo de archivo no permitido. Selecciona una imagen, video o audio del tipo indicado.');
  if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error('El archivo está vacío o su tamaño no es válido.');
  if (file.size > MEDIA_LIMITS[type]) throw new Error(`El archivo supera el límite provisional de ${mediaSize(MEDIA_LIMITS[type])} para ${MEDIA_TYPES[type].toLowerCase()}.`);
  return type;
}

// Storage contract: metadata goes in existing records; File/Blob and URLs stay here.
// A persistent implementation must provide authenticated server storage, never local paths.
const files = new Map();
const readers = new Map();
let epoch = simulationSnapshot().epoch;
export const temporaryWhatsAppMedia = {
  async put(file, expectedType) {
    const source = simulationSnapshot().epoch;
    const type = validateMediaFile(file, expectedType);
    const used = [...files.values()].reduce((total, row) => total + row.metadata.size, 0);
    if (used + file.size > MEDIA_LIMITS.session) throw new Error('La sesión alcanzó su límite provisional de adjuntos. Retira archivos o reinicia la simulación.');
    await new Promise((resolve, reject) => {
      const reader = new FileReader();
      const failure = message => { readers.delete(reader); reject(new Error(message)); };
      readers.set(reader, () => { reader.abort(); failure('La sesión cambió durante la lectura. Vuelve a seleccionar el archivo.'); });
      reader.onload = () => {
        readers.delete(reader);
        if (reader.result instanceof ArrayBuffer && reader.result.byteLength === file.size) resolve();
        else failure('No se pudo leer el archivo completo. Selecciónalo nuevamente.');
      };
      reader.onerror = reader.onabort = () => failure('No se pudo leer el archivo. Revisa que siga disponible en el dispositivo.');
      try { reader.readAsArrayBuffer(file); } catch { failure('No se pudo leer el archivo. Revisa que siga disponible en el dispositivo.'); }
    });
    if (simulationSnapshot().epoch !== source) throw new Error('La sesión cambió durante la lectura. Vuelve a seleccionar el archivo.');
    if ([...files.values()].reduce((total, row) => total + row.metadata.size, 0) + file.size > MEDIA_LIMITS.session) throw new Error('La sesión alcanzó su límite provisional de adjuntos. Retira archivos o reinicia la simulación.');
    const metadata = { id: crypto.randomUUID(), type, mime: file.type, name: file.name.split(/[\\/]/).at(-1).slice(0, 200), size: file.size, storage: 'session' };
    files.set(metadata.id, { metadata, file, url: URL.createObjectURL(file) });
    return { ...metadata };
  },
  get(reference) { return reference?.storage === 'session' ? files.get(reference.id) || null : null; },
  remove(reference) { const row = this.get(reference); if (row) { URL.revokeObjectURL(row.url); files.delete(reference.id); } },
  clear() { for (const cancel of [...readers.values()]) cancel(); readers.clear(); for (const row of files.values()) URL.revokeObjectURL(row.url); files.clear(); },
};
subscribeSimulation(() => {
  if (epoch !== simulationSnapshot().epoch) { temporaryWhatsAppMedia.clear(); epoch = simulationSnapshot().epoch; }
});

export function requireMedia(reference) {
  const row = temporaryWhatsAppMedia.get(reference);
  if (!row || JSON.stringify(reference) !== JSON.stringify(row.metadata)) throw new Error('El adjunto temporal ya no está disponible. Vuelve a seleccionarlo.');
  validateMediaFile(row.file, reference.type);
  return { ...row.metadata };
}

// Cancel/replacement can release a draft without revoking media used by saved local records.
export function discardDraftMedia(reference) {
  if (!reference) return;
  if (simulationSnapshot().mode === 'SIMULATION') {
    const data = simulationData();
    if ([...data.templates, ...data.messages].some(row => row.attachment?.id === reference.id)) return;
  }
  temporaryWhatsAppMedia.remove(reference);
}
