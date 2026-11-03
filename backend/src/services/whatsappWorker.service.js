import { startWhatsAppAutomationRunner } from './whatsappAutomationRunner.js';
// Existing worker entry point delegates to the single queue processor.
export function startWhatsAppWorker(options) {
  const runner = startWhatsAppAutomationRunner(options);
  return () => runner.stop();
}
