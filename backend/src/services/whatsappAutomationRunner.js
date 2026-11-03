import pool from '../config/database.js';
import { processWhatsAppAutomations } from './whatsappCenter.service.js';
import { resolveMertelCompany } from './mertelCompany.service.js';

// The timer only polls due notices; it does not define commercial contact intervals.
// Company locks and the existing UNIQUE idempotency index arbitrate multiple processes.
export function startWhatsAppAutomationRunner({ dbPool = pool, intervalMs = 60000, report = console.error, clock = () => new Date() } = {}) {
  let running = false, stopped = false;
  async function tick() {
    if (running || stopped) return;
    running = true;
    try {
      const company = await resolveMertelCompany(dbPool);
      if (!stopped) await processWhatsAppAutomations({ scope: { companyId: String(company.id), companyName: company.name, actorId: null }, now: clock() }, dbPool);
    } catch (error) { report('Automatización WhatsApp: evaluación no disponible.', error.code || 'INTERNAL'); }
    finally { running = false; }
  }
  const timer = setInterval(() => { void tick(); }, intervalMs); timer.unref();
  return { tick, stop() { stopped = true; clearInterval(timer); } };
}
