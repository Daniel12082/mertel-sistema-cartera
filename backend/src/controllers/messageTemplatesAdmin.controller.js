import { createMessageTemplate, listMessageTemplates, setMessageTemplateStatus, updateMessageTemplate } from "../services/messageTemplatesAdmin.service.js";

function respond(operation, status = 200) {
  return async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const data = await operation(req);
      return res.status(status).json({ success: true, data });
    } catch (error) {
      const code = [400, 403, 404, 409].includes(error.status) ? error.status : 500;
      return res.status(code).json({ success: false, message: code === 500 ? "No fue posible administrar las plantillas." : error.message });
    }
  };
}

export const listTemplates = respond(req => listMessageTemplates({ scope: req.companyScope }));
export const createTemplate = respond(req => createMessageTemplate({ scope: req.companyScope, actorId: req.user.id, body: req.body }), 201);
export const updateTemplate = respond(req => updateMessageTemplate({ scope: req.companyScope, actorId: req.user.id, templateId: req.params.templateId, body: req.body }));
export const activateTemplate = respond(req => setMessageTemplateStatus({ scope: req.companyScope, actorId: req.user.id, templateId: req.params.templateId, status: "active" }));
export const deactivateTemplate = respond(req => setMessageTemplateStatus({ scope: req.companyScope, actorId: req.user.id, templateId: req.params.templateId, status: "inactive" }));
