import api from './api';
export async function loadAppearance(signal) {
  try { return (await api.get('/appearance', {signal})).data.data; }
  catch { throw new Error('No pudimos cargar la apariencia de MERTEL.'); }
}
export async function persistAppearance(appearance) {
  try { return (await api.put('/appearance', appearance)).data.data; }
  catch(error) { throw new Error(error.response?.status === 400 ? 'Revisa los colores, el contraste y los archivos del logo.' : 'No pudimos guardar la apariencia. Intenta nuevamente.', {cause:error}); }
}
