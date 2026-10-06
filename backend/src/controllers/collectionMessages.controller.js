import { collectionMessage } from "../services/collectionMessages.service.js";

export function collectionMessageController(step) {
  return async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      if (step !== "templates" && (!req.body || typeof req.body !== "object" || Array.isArray(req.body) ||
          Object.keys(req.body).some(key => !["template_id", "reference_date"].includes(key)))) {
        return res.status(400).json({ success: false, message: "Campos de mensaje no válidos." });
      }
      const data = await collectionMessage({ step, customerId: req.params.customerId, scope: req.companyScope,
        referenceDate: step === "templates" ? req.query.reference_date : req.body.reference_date, templateId: req.body?.template_id });
      return res.json({ success: true, data });
    } catch (error) {
      const status = [400, 403, 404, 409].includes(error.status) ? error.status : 500;
      return res.status(status).json({ success: false, message: status === 500 ? "No fue posible preparar el mensaje." : error.message });
    }
  };
}
