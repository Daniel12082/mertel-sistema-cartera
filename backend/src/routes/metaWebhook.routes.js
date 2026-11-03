import express from 'express';
import { MetaWhatsAppProvider } from '../services/whatsappProvider.service.js';
import { receiveMetaWebhook } from '../services/whatsappCenter.service.js';

export const metaWebhookRoutes = express.Router();

function provider() { return new MetaWhatsAppProvider(); }

metaWebhookRoutes.get('/', (req, res) => {
  try {
    const challenge = provider().verifyWebhookChallenge(req.query['hub.mode'], req.query['hub.verify_token'], req.query['hub.challenge']);
    if (challenge === null) return res.sendStatus(403);
    return res.type('text/plain').status(200).send(challenge);
  } catch { return res.sendStatus(503); }
});

// This router is mounted before express.json(), so req.body is the exact signed bytes.
metaWebhookRoutes.post('/', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  try {
    const meta = provider();
    if (!Buffer.isBuffer(req.body) || !meta.verifyWebhookSignature(req.body, req.get('x-hub-signature-256'))) return res.sendStatus(401);
    let payload;
    try { payload = JSON.parse(req.body.toString('utf8')); } catch { return res.sendStatus(400); }
    const events = meta.handleIncomingWebhook(payload);
    await receiveMetaWebhook({ events });
    return res.sendStatus(200);
  } catch {
    // Do not expose webhook payloads, credentials or provider details to callers.
    return res.sendStatus(500);
  }
});
