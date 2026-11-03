import "dotenv/config";
import { createApp } from "./app.js";
import {startWhatsAppWorker} from './services/whatsappWorker.service.js';

const app = createApp();
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MERTEL API ejecutándose en http://localhost:${PORT}`));
const stopAutomation = startWhatsAppWorker();
process.once('SIGTERM', stopAutomation);
process.once('SIGINT', stopAutomation);
