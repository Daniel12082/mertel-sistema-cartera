# Fase 4.8 — auditoría previa y contrato

Estado técnico: CERRADA, con configuración pendiente de Pronto Pago representada sin activación comercial. Publicación verificada en el reporte final. Base: 8fca506e3feef8c309a9a945bfd083b3e26d0345. Autorización: orden 4.8 del usuario. No se implementan fases posteriores.

| Regla | Implementación actual | Comportamiento esperado | Cambio necesario | Archivo |
|---|---|---|---|---|
| Factura principal | Proximidad absoluta, saldo e ID | Vencida más antigua; ID técnico para empate | Cambiar comparador y orden de clientes | collectionEngine.service.js, collection.service.js |
| Jerarquía | Prioridades numéricas arbitrarias | Orden configurable, rangos ordinales técnicos | Normalizar configuración en backend | collectionPolicy.js, companyCollection.service.js |
| Pronto Pago | days_before_due | Ventana desde issue_date, diez días, calendario/límites pendientes | Evaluador independiente, sin fallback comercial | promptPayment.service.js, collectionEngine.service.js |
| Descuento | Helper genérico Number/toFixed | 3% de base_value sin IVA y sin aplicar saldo | Función exacta separada; redondeo pendiente si hay subcentavos | promptPayment.service.js |
| Productos | Sin fuente | Desconocidos/mixtos requieren revisión manual | Representar estado, sin SKU ni invoice_items | promptPayment.service.js |
| UI | Catálogo estático y orden inverso | Catálogo/orden del backend, advertencias de configuración | Metadatos aditivos y lectura, sin clasificación React | collection.service.js, Cobranza.jsx |

No se modifican pagos, allocations, roles, auth ni la migración 001. El setting de empresa collection_rules será la única entrada de política; settings legacy NULL no se heredan. El contrato GET existente se conserva y se amplía de forma aditiva. Los detalles y resultados se actualizan después de validar.

## Implementación comprobable

- Una tarjeta por cliente. Entre candidatas vencidas se elige la de vencimiento más antiguo, independientemente del saldo y de proximidad a referencia. Una vencida prevalece sobre una no vencida. Para fechas iguales y para futuras de igual rango se usa ID técnico estable, sin favorecer saldo o inventar antigüedad futura. Orden de clientes determinado en backend por la misma política, con desempate por identidad.
- Jerarquía central oficial: overdue, due_today, days_before_due, prompt_payment. priority expresa rango ordinal (4/3/2/1 con ese orden), no puntuación comercial. Las reglas legacy conservan sus claves y condiciones aprobadas/configuradas, pero no sus magnitudes numéricas como autoridad de orden. Un objeto versionado admite stage_order explícito. Desactivar/cambiar reglas sigue requiriendo configuración autorizada; no se escribieron settings reales.
- Pronto Pago se reconoce por days_since_issue o clave prompt_payment, nunca por days_before_due. Legacy prompt_payment/days_before_due=10 deja de producir un resultado falso: requiere configuración nueva y genera advertencia.
- Evaluador independiente de ventana desde issue_date. Se soporta configuración explícita calendario/hábil; hábil requiere weekdays y holidays aportados, sin calendario ficticio. Pendiente o falta de límites/calendario impide asignar Pronto Pago. Se muestra estado pending_configuration; falta de emisión produce missing_issue_date. El usuario autorizó representar el tipo de día pendiente sin elegirlo.
- Productos: unknown/mixed → manual_review; evaluación externa explícita eligible/not_eligible puede representarse. No existe integración ficticia de SKU, lista de exclusiones, revisión persistida ni invoice_items.
- Cálculo matemático puro calculatePromptPaymentDiscount(baseValue): 3% exacto sobre base antes de IVA usando enteros. Si requiere redondear subcentavos retorna exact_amount y pending_rounding/amount=null. No elige una regla de redondeo y no aplica descuento; la respuesta de clasificación siempre conserva discount.amount=null/not_applied. Descuento condicionado 10% y promo_18 no participan.
- Modelo SQL devuelve fechas DATE en YYYY-MM-DD y base_value; evita conversiones de timezone al leer emisión/vencimiento. No hay cambios de esquema ni migraciones.
- Frontend presenta catálogo/orden y etiquetas backend. No tiene catálogo comercial estático ni selecciona/sortea main_invoice. Conserva búsqueda local, permisos, responsive y foco de modal; separa elegibilidad de cobranza de revisión de Pronto Pago.

## Configuración central y compatibilidad

Única entrada: settings.collection_rules de compañía autorizada. Se acepta el arreglo legacy por compatibilidad y un objeto version 2. La política confirmada (orden por defecto, 3%, base_value y diez días) está centralizada en collectionPolicy.js. Los settings legacy NULL de descuento/días nunca se leen como configuración MERTEL y no se migraron ni borraron.

Ejemplo de **forma de configuración**, sin insertarlo en la base:

```json
{
  "version": 2,
  "stage_order": ["overdue", "due_today", "days_before_due", "prompt_payment"],
  "rules": [
    {"key": "overdue", "active": true},
    {"key": "due_today", "active": true},
    {"key": "five_days_before_due", "active": true, "days_before_due": 5},
    {"key": "prompt_payment", "active": true, "condition": "days_since_issue"}
  ],
  "prompt_payment": {
    "percentage": "3", "base_calculation": "base_value", "days": 10,
    "window": {"day_type": "pending", "include_issue_date": null, "include_day_ten": null}
  }
}
```

stage_order contiene las cuatro categorías sin duplicados; los rangos se derivan de posición. day_type admite pending/calendar/business. include_issue_date determina inclusión del instante de referencia igual a emisión; include_day_ten determina inclusión de distancia diez. Distancia: días transcurridos desde emisión, o días del calendario explícito posteriores a emisión. Null expresa decisión pendiente. Para business se necesita window.calendar con working_weekdays (0 domingo a 6 sábado) y holidays YYYY-MM-DD. Este esquema define parámetros técnicos, **no aprueba sus valores de negocio**.

No se admite sustituir el 3%, base_value o diez días por valores distintos como regla Pronto Pago MERTEL. El 10% sigue fuera. Los ejemplos con calendario y límites explícitos en tests son fixtures aisladas; no certifican decisiones MERTEL ni configuran la base real.

## Extensión aditiva de GET /api/collection

Se preservan endpoint, query, success/data, reference_date, status, rules_configured, summary, customers y campos de 4.7. Se agregan:

- data.stage_catalog: key, label, category, priority; orden y etiquetas del servidor.
- data.priority_basis = stage_order_ordinal.
- data.configuration_warnings: decisiones faltantes que bloquean Pronto Pago; no esconderlas detrás de cero clientes.
- customers[].stage_label y clasificación de factura stage_label.
- invoices[].prompt_payment y main_invoice.prompt_payment: percentage, base_calculation, window, eligibility y discount.

status sigue ready/no_rules_configured por compatibilidad; ready indica disponibilidad de consulta, **no aprobación de todas las decisiones**. Las advertencias informan la limitación. eligible de cada factura continúa siendo de clasificación de cobranza, no elegibilidad de descuento. Las no elegibles permanecen en invoices del cliente seleccionado y no aumentan eligible_balance. Clientes sin ninguna candidata siguen fuera de la consulta como en 4.7; D29 permanece pendiente, sin inventar quinta etapa.

## Validación y límites

Las pruebas específicas cubren cliente único, vencidas con diferentes saldos, vencida/futura, empates, cliente único con una factura, jerarquía/configuración, emisión vs vencimiento, calendario pendiente/explícito, 3% antes de IVA, no uso de promo_18/10%, revisión de productos, no redondeo/aplicación y no mutación financiera. La prueba HTTP usa MySQL y login reales **en un esquema desechable de pruebas**, con estados financieros antes/después. No se crearon datos de negocio para simular MERTEL.

Pendientes comerciales preservados: D01–D06 (productos/calendario), D24–D27 (límites, redondeo/contabilidad, modalidad 10%, persistencia), y parte de D28/D29. No se implementan revisión manual persistida, aplicación financiera, actualización de pagos ni fases posteriores. La condición pendiente de calendario está implementada como abstención explícita permitida por la orden, no como días calendario supuestos.

Inspección local actual: cero compañías y cero collection_rules; **Validación contra datos reales MERTEL no disponible.** Health 200 y cobranza 401 sin autenticación verificados con el backend actual. authenticate/companyScope/collection.view/CORS/cookies permanecen intactos. SQL de cobranza sigue SELECT en transacción READ ONLY.

Resultados finales: backend 165/165 sin omisiones, frontend 53/53, lint/build OK y E2E 13/13. Verificación agent-browser: login local carga, sin overlay ni errores JS observados. El cierre técnico usa la representación pending expresamente autorizada; no declara beneficio comercial activado ni respuestas de negocio aprobadas. No se toca la migración 001 (hash preexistente e2f0b2c49c979991914a187dc9531d9c5d2117ce), .env, pagos, allocations ni secretos.

## Inventario para commit selectivo

Backend:
- backend/src/models/collection.model.js
- backend/src/services/collection.service.js
- backend/src/services/collectionEngine.service.js
- backend/src/services/companyCollection.service.js
- backend/src/services/collectionPolicy.js
- backend/src/services/promptPayment.service.js
- backend/test/collection.service.test.js
- backend/test/collectionEngine.test.js
- backend/test/multiCompany.test.js
- backend/test/collection48.test.js

Frontend:
- frontend/src/pages/Cobranza/Cobranza.jsx
- frontend/src/pages/Cobranza/collection.presentation.js
- frontend/src/services/collection.service.js
- frontend/test/collection.fixture.js
- frontend/test/collection.test.jsx
- frontend/test/e2e/collection.spec.js

Documentación:
- docs/MASTER_PLAN.md
- docs/business/MERTEL_COBRANZA_RULES.md
- docs/business/MERTEL_DECISIONS_PENDING.md
- docs/architecture/MERTEL_AUDIT_POST_4_7.md
- docs/architecture/MERTEL_COLLECTION_ARCHITECTURE.md
- docs/architecture/MERTEL_PHASE_4_8.md
- docs/roadmap/MERTEL_ROADMAP.md

Excluidos: database/migrations/001_initial_schema.sql (intacta), .env/.env.local, node_modules, dist y tmp/capturas. Mensaje autorizado: feat: implementar reglas reales de cobranza MERTEL. El hash de commit y comprobación real de push/HEAD/origin/main se entregan en el reporte final después de ejecutarlos; este documento no fabrica un resultado de publicación.
