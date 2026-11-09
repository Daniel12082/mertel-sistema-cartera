import express from 'express';
import { requirePermission } from '../middleware/requirePermission.js';
import { requireCompanyScope } from '../middleware/companyScope.js';
import * as center from '../services/whatsappCenter.service.js';

function respond(work) {
  return async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try { return res.json({ success: true, data: await work({ scope: req.companyScope, actorId: req.user.id, body: req.body,
      messageId: req.params.messageId, stage: req.params.stage, filters: req.query, fail: req.body?.fail,
      status: req.body?.status, customerId: req.params.customerId }) }); }
    catch (error) {
      if ([400, 403, 404, 409, 429].includes(error.status)) return res.status(error.status).json({ success: false, message: error.message });
      if (['ER_BAD_FIELD_ERROR', 'ER_NO_SUCH_TABLE'].includes(error.code)) return res.status(503).json({ success: false, message: 'Ejecuta la migración 007 del centro WhatsApp antes de usar la cola.' });
      return next(error);
    }
  };
}
export const adminWhatsAppRoutes = express.Router();
adminWhatsAppRoutes.use(requirePermission('settings.manage'), requireCompanyScope);
adminWhatsAppRoutes.get('/', respond(center.getWhatsAppCenter));
adminWhatsAppRoutes.get('/status', respond(center.getWhatsAppCenter));
adminWhatsAppRoutes.patch('/settings', respond(center.updateWhatsAppSettings));
adminWhatsAppRoutes.post('/test', respond(center.testWhatsAppConnection));
adminWhatsAppRoutes.get('/meta/templates', respond(center.listMetaMessageTemplates));
adminWhatsAppRoutes.post('/meta/replies', respond(center.replyToMetaConversation));
adminWhatsAppRoutes.put('/meta/conversations/association', respond(center.associateMetaConversation));
adminWhatsAppRoutes.post('/meta/invoice-notices', respond(center.sendMetaInvoiceNotice));
adminWhatsAppRoutes.post('/meta/test-messages', respond(center.enqueueMetaTestMessage));
adminWhatsAppRoutes.post('/meta/test-messages/:messageId/send', respond(args => center.sendMetaTestMessage({ ...args, body: args.body })));
adminWhatsAppRoutes.post('/disconnect', respond(center.disconnectWhatsApp));
adminWhatsAppRoutes.get('/automations', respond(center.getWhatsAppCenter));
adminWhatsAppRoutes.get('/automations/limit', respond(center.getMetaAutomationLimit));
adminWhatsAppRoutes.put('/automations/schedule', respond(center.configureAutomaticSchedule));
adminWhatsAppRoutes.get('/customers/:customerId/sequence', respond(center.getCustomerWhatsAppSequence));
adminWhatsAppRoutes.put('/automations/:stage', respond(center.saveWhatsAppRule));
adminWhatsAppRoutes.get('/messages', respond(center.listWhatsAppMessages));
adminWhatsAppRoutes.get('/audit', respond(center.listWhatsAppAudit));
adminWhatsAppRoutes.patch('/customers/:customerId/exclusion', respond(center.excludeWhatsAppCustomer));
adminWhatsAppRoutes.patch('/customers/:customerId/consent', respond(center.setWhatsAppCustomerConsent));
adminWhatsAppRoutes.post('/automations/process', respond(args => {
  if (args.body && Object.keys(args.body).length) throw Object.assign(new Error('La fecha automática la determina el servidor.'), { status: 400 });
  return center.processWhatsAppAutomations(args);
}));
adminWhatsAppRoutes.post('/preview', respond(center.previewWhatsApp));
adminWhatsAppRoutes.post('/test-configuration', respond(center.testWhatsAppConfiguration));
adminWhatsAppRoutes.post('/queue', respond(center.enqueueWhatsApp));
adminWhatsAppRoutes.post('/messages/:messageId/mock-send', respond(center.mockSendWhatsApp));
adminWhatsAppRoutes.post('/messages/:messageId/mock-delivery', respond(center.mockDeliveryWhatsApp));
adminWhatsAppRoutes.post('/messages/:messageId/cancel', respond(center.cancelWhatsAppMessage));
// Authenticated admin-only simulation, never a public/provider webhook.
adminWhatsAppRoutes.post('/mock-incoming', respond(center.mockIncomingWhatsApp));

export const collectorWhatsAppRoutes = express.Router();
collectorWhatsAppRoutes.use(requirePermission('collection.view'), requirePermission('collection.manage'), requireCompanyScope);
collectorWhatsAppRoutes.get('/customers/:customerId/messages', respond(center.listWhatsAppMessages));
collectorWhatsAppRoutes.get('/customers/:customerId/sequence', respond(center.getCustomerWhatsAppSequence));
collectorWhatsAppRoutes.post('/customers/:customerId/messages/:messageId/mock-send',respond(center.mockSendWhatsApp));
collectorWhatsAppRoutes.post('/customers/:customerId/queue', respond(args => {
  if (args.body?.mode && args.body.mode !== 'MANUAL') return Promise.reject(Object.assign(new Error('El cobrador solo puede preparar mensajes manuales.'), { status: 403 }));
  return center.enqueueWhatsApp({ ...args, body: { customer_id: args.customerId, template_id: args.body?.template_id, mode: 'MANUAL' } });
}));
