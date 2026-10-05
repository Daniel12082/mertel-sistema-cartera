# Fase 5 — reglas comerciales confirmadas de MERTEL

Fecha: 05/10/2026. Base publicada: 2db4e231835319b1348542fc2e60d4951c5c4cd9. Autorización: orden Fase 5 y aclaración posterior del usuario que exige redondeo al peso colombiano entero. Alcance exclusivo MERTEL, sin Fase 6.

## Reglas y configuración

La configuración oficial está en [backend/config/mertel-collection-rules.json](../../backend/config/mertel-collection-rules.json). Usa el mismo objeto version 2 de settings.collection_rules; añade commercial_policy=mertel_phase_5, exclusiones descriptivas, redondeo COP y conditional_discount. No crea otro sistema de configuración, editor administrativo, catálogo ni migración. La marca de política oficial impide sustituir calendario/límites, orden comercial y los cinco días por variantes técnicas. Las configuraciones técnicas legacy conservan compatibilidad y sus pendientes explícitos; no son la política oficial ni fallback global.

No se inserta este JSON en la base local: no existe una empresa MERTEL autorizada. Para activarlo con datos reales se necesita el contexto empresarial verdadero y persistir exactamente este objeto como setting collection_rules de esa compañía mediante un procedimiento autorizado. El endpoint continúa devolviendo no_rules_configured para una empresa sin reglas; no carga automáticamente el JSON como configuración global.

- Pronto Pago: fecha de factura issue_date + 10 días calendario, días 0–10 incluidos. Factura 2026-10-05 → último día 2026-10-15. No depende de vencimiento ni de fines de semana.
- 3% sobre base_value antes de IVA. Cálculo exacto con BigInt: base en centavos × 3, denominador 10000 para pesos; mitad hacia arriba sumando 5000 antes de dividir. 48 COP → 1,44 → 1 COP; 50 COP → 1,50 → 2 COP. Resultado entero expresado como string, metadatos currency=COP/decimal_places=0; sin toFixed ni redondeo comercial a centavos.
- Faltan 5 días: evento exacto cinco días calendario antes de due_date, dentro del catálogo configurable.
- Exclusiones confirmadas: PROMO 18; alternadores/arranques/motoventiladores para carros; set piñón y kit piñón-cadenas para motos.
- 10% condicionado: elegibilidad temporal del día 60 al 70 desde issue_date, ambos incluidos. Sin base ni fórmula matemática inferida.
- Jerarquía En mora > Vence hoy > Faltan 5 días > Pronto Pago. Una tarjeta de pipeline por cliente; vencida más antigua determina factura principal. Comparador técnico 4.8 y orden de clientes preservados en backend.

## Datos de productos y finanzas

La consulta SQL lee promo_18 de la factura real. Un valor positivo identifica PROMO 18 y excluye el beneficio; NULL o cero no prueban elegibilidad. No existen líneas/productos/SKU suficientes conectados a la consulta. Por eso las otras exclusiones pueden evaluarse únicamente mediante evidencia descriptiva explícita en el evaluador puro y fixtures aislados; la consulta empresarial real permanece en revisión manual por productos desconocidos.

El evaluador acepta evidencia interna completa con descriptions, vehicle_type car/motorcycle (contexto descriptivo, sin categorías/IDs almacenados) y evaluación positiva explícita. Una descripción que no coincide con la lista nunca basta para declarar elegibilidad. Evidencia mixta/incompleta o producto desconocido → manual_review, sin cálculo parcial. Las cadenas eligible/not_eligible anteriores conservan compatibilidad como entrada interna confiable; no hay endpoint/body que permita conceder el beneficio. Fuente real, verificación y revisión persistida siguen pendientes.

Se separan ventana, producto y elegibilidad global. La etapa temporal Pronto Pago puede requerir revisión manual del beneficio; invoices[].eligible siempre significa candidata a cobranza. Una exclusión confirmada impide Pronto Pago como candidata, aun dentro de la ventana. El importe preview_amount solo aparece con elegibilidad positiva explícita y base informada. discount.amount=null y status=not_applied permanecen intactos. No se tocan balance, payments ni payment_allocations.

## Beneficios independientes y punto comercial pendiente

prompt_payment y conditional_discount tienen percentage, eligibility, window, fecha de evaluación y discount independientes. benefits preserva ambos y una combinación con combined_percentage=null/combined_amount=null y pending_financial_specification.

Los intervalos 0–10 y 60–70 no se solapan en una misma fecha. La orden confirma que pueden combinarse pero exige pago temprano para el 3%; no define si existe conservación de un beneficio, otro hecho de pago o fechas distintas para aplicar ambos. Se pidió aclaración al usuario. Mientras no exista especificación, la evaluación automática no marca ambos elegibles a la vez desde una sola reference_date ni conserva un beneficio como hecho financiero. La prueba de coexistencia preserva dos evaluaciones independientes elegibles con fechas diferentes, de la misma factura, sin inferir una operación conjunta ni 13%. D26 mantiene este punto pendiente.

La base del 10%, secuencia/base de combinación, contabilidad y operación de aplicación también siguen pendientes. No hay aplicación ficticia ni modificación de saldo.

## API y presentación

GET /api/collection mantiene reference_date, status, rules_configured, summary, customers, stage_catalog, priority_basis, configuration_warnings, stage_label y prompt_payment. Añade conditional_discount/benefits a evaluaciones y non_overdue_pending como agrupación operativa:

- label, total_invoices, total_customers, total_balance: resumen previo a filtros, consistente con el resumen existente.
- invoices: facturas con saldo positivo, vencimiento futuro y sin etapa activa, con cliente y evaluación.
- customers: clientes que solo tienen esas facturas, para detalle/operaciones sin main_invoice comercial inventada. No se duplican las tarjetas de clientes que ya tienen etapa activa.

Las facturas futuras no clasificadas de un cliente activo también aparecen en la sección por factura y en su detalle. No hay quinta etapa ni categoría En revisión. Facturas sin vencimiento siguen no_eligible en el detalle; no se inventa fecha ni una clasificación no vencida. stage/customer_id siguen siendo filtros de lectura. Los filtros de etapa omiten la agrupación operativa, que no es una etapa.

Frontend muestra catálogo y selección del servidor, Facturas no vencidas, estados y razones de beneficios, 3%/base/último día, preview en pesos cuando existe, 10%/ventana 60–70 y aplicación pendiente. No calcula descuentos ni reclasifica facturas. Preserva las gestiones, promesas e historial de 4.9 y el borrador sin envío.

## Seguridad e invariantes

Se conservan autenticación, permisos collection.view/collection.manage y companyScope. Consultas SQL parametrizadas, ámbito para factura y cliente y transacción READ ONLY. No se habilitan rutas nuevas de configuración, mensajes ni productos. La política se carga solo desde el setting de empresa autorizada, sin heredar NULL global.

Pruebas HTTP usan MySQL desechable con empresas/usuarios/documentos aislados. Comparan estado de invoices/payments/allocations antes y después de evaluaciones, incluyen aislamiento y acceso 401/403. Suite de gestiones/promesas vigente preservada. No se crean datos de negocio ficticios en la base configurada.

La inspección local actual difiere del reporte anterior: 0 compañías, 8 clientes, 42 facturas, 2 pagos y 16 asignaciones históricos. No se certifican como datos reales MERTEL ni se reasignan. La comparación de hashes de estos registros durante la verificación local resultó idéntica. El contexto real empresarial sigue pendiente.

## Validación

- Backend completo: 210/210, sin omisiones; incluye auth, permisos, finanzas, cartera, cobranza y operaciones 4.9.
- Frontend: 71/71. Lint y build aprobados.
- E2E: 17/17; login/sesión/permiso, responsive 320–1440 px, nuevos beneficios y grupo operativo, gestiones/promesas/borradores de 4.9.
- agent-browser: /cobranza sin sesión redirige a login; contenido visible, sin overlay ni errores JS observados. Capturas E2E inspeccionadas para escritorio y móvil con respuesta calculada por el builder real del backend sobre fixtures.
- git diff --check sin errores; la conversión LF/CRLF reportada por Git no es un cambio comercial.
- Migración 001 protegida: SHA256 1400D18E64598B24FBEDBF6EF9EC45D02026FA15A29DAA296A099EC1F86E6761, idéntico al inicio. Nunca staging/commit.

No se acredita validación empresarial real ni activación de settings en producción. Commit/push se verifican después de publicar y se reportan al usuario; este documento no inventa un hash futuro.

## Inventario de implementación

Backend: config/mertel-collection-rules.json; src/models/collection.model.js; src/services/collection.service.js, collectionEngine.service.js, collectionPolicy.js, promptPayment.service.js, collectionMoney.js, collectionBenefits.service.js; test/collection5.test.js, collection48.test.js, multiCompany.test.js.

Frontend: src/pages/Cobranza/Cobranza.jsx, Cobranza.css, CollectionBenefits.jsx; test/collection5.test.jsx y test/e2e/collection.spec.js.

Documentación: docs/MASTER_PLAN.md, docs/business/MERTEL_COBRANZA_RULES.md, docs/business/MERTEL_DECISIONS_PENDING.md y este informe. Las expectativas antiguas de redondeo pendiente/PROMO independiente se actualizan únicamente por las decisiones nuevas de Fase 5.

## Pendientes reales

Contexto MERTEL y setting real (T01), fuente completa de productos (D02), responsable/decisión de mezcla (D03), coexistencia temporal/base/fórmula/aplicación financiera (D24–D26). Mensajería, automatización, cumplimiento/prioridad de promesas, métricas finales y Fase 6 no se implementan con esta orden.
