import { collectionOperation } from "../services/collectionOperations.service.js";

export function collectionOperationController(kind, writing = false) {
  return async (req, res) => {
    try {
      const data = await collectionOperation({ kind, customerId: req.params.customerId, invoiceId: req.query.invoice_id,
        ...(writing ? { body: req.body ?? null } : {}), scope: req.companyScope });
      return res.status(writing ? 201 : 200).json({ success: true, data });
    } catch (error) {
      const status = [400, 403, 404, 409].includes(error.status) ? error.status : 500;
      return res.status(status).json({ success: false, message: status === 500 ? "No fue posible procesar la operación de cobranza." : error.message });
    }
  };
}
