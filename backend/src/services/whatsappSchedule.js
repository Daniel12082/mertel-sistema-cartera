import {operationError} from './collectionOperations.validation.js';
export function bogotaDate(now = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
export function nextWindow(rule, now = new Date()) {
  const day = bogotaDate(now);
  for (let offset = 0; offset < 8; offset++) {
    const date = new Date(`${day}T00:00:00-05:00`); date.setUTCDate(date.getUTCDate() + offset);
    const dateKey = bogotaDate(date); const weekday = date.getUTCDay() || 7;
    if (!rule.weekdays.includes(weekday)) continue;
    const start = new Date(`${dateKey}T${rule.start_time}:00-05:00`);
    const end = new Date(`${dateKey}T${rule.end_time}:00-05:00`);
    if (now < end) return new Date(Math.max(now.getTime(), start.getTime()));
  }
  throw operationError(400, 'No hay horario disponible.');
}
