import "dotenv/config";
import { createApp } from "./app.js";
import {startWhatsAppWorker} from './services/whatsappWorker.service.js';

const app = createApp();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
app.listen(PORT, HOST, () => console.log(`MERTEL API ejecutándose en http://localhost:${PORT}`));
const stopAutomation = startWhatsAppWorker();
process.once('SIGTERM', stopAutomation);
process.once('SIGINT', stopAutomation);
