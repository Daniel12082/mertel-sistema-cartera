# FASE 5.1 — Panel operativo y preparación de mensajes WhatsApp MERTEL

Fecha: 05/10/2026. Producto exclusivo: MERTEL Importaciones. Base: `75cd3d0a43897d6844ca6c00635ca503752757ba`. No se construye SaaS ni se avanza a 5.2.

## Objetivo y panel operativo

`/cobranza` reúne pipeline → cliente → detalle operativo → acción. Cada cliente mantiene una tarjeta con nombre, identificación, etapa del servidor, saldo, factura principal, prioridad, cantidad de facturas y acciones. «Enviar mensaje a WhatsApp» está visible en cada tarjeta y en el detalle; abre la preparación, no un envío. El permiso faltante deshabilita esa acción.

Se reutilizan MainLayout, auth, Axios, estilos de cartera/cobranza, modal y operaciones existentes. El detalle ofrece navegación a Resumen, Facturas, Gestiones, Promesas y WhatsApp. Escape, cierre por botón/fondo, captura de Tab/Shift+Tab entre controles visibles habilitados y retorno al disparador se conservan. El cuerpo del modal es desplazable sin salir del viewport.

## Cliente, facturas y beneficios

El detalle muestra nombre, NIT, teléfono, etapa/etiqueta, prioridad/motivo, saldo total y saldo elegible informado. Dato faltante: «—» o «No registrado», nunca un cero inventado.

La factura principal siempre es `main_invoice` del backend; React no la selecciona, ordena ni recalcula reglas comerciales. Se mantienen la factura vencida más antigua y el orden vigente de clientes. Por factura se muestran número, emisión, vencimiento, valor, saldo, etapa, motivo, prioridad, elegibilidad, candidatos y beneficios. El backend añade `days_since_issue` y `days_until_due` como diferencias de fechas de calendario para presentación, con NULL cuando no hay información válida; no altera clasificación ni finanzas.

Pronto Pago y beneficio condicionado siguen procediendo del servidor: 3%, diez días calendario con día 10 incluido y base antes de IVA/exclusiones; 10% independiente en 60–70 días. Se reutiliza CollectionBenefits, distinguiendo elegibilidad/revisión de aplicación; no se suma 13% ni se modifica balance. La falta de productos continúa requiriendo revisión manual conforme a Fase 5.

«Facturas no vencidas» permanece como agrupación operativa fuera del catálogo de cuatro etapas. Sus clientes pendientes tienen tarjeta y detalle; las facturas no vencidas de un cliente ya clasificado se consultan en su tarjeta principal, evitando duplicar clientes.

## Gestiones y promesas

Se reutilizan, sin duplicación:

- GET/POST `/api/collection/customers/:customerId/actions`.
- GET/POST `/api/collection/customers/:customerId/promises`.

El historial muestra fecha, autor, tipo, factura si existe y observación; las promesas muestran fecha prometida, monto, estado, observación y autor. Solo confirmar «Guardar registro» crea una gestión o promesa. La promesa se registra pendiente con la implementación 4.9. Abrir/seleccionar/previsualizar/preparar un mensaje no crea operaciones, no aumenta prioridad ni pausa, cumple o incumple promesas.

## Plantillas y flujo de mensaje

Se reutiliza `message_templates`: id, empresa, nombre, canal, contenido, etapa nullable y estado. No se añade tabla ni migración, campo de orden o catálogo ficticio. Las variables se extraen del contenido; el orden existente es por id. Solo se consultan plantillas activas, canal whatsapp, empresa autorizada y etapa coincidente; etapa NULL permite plantilla común. No se heredan plantillas legacy sin empresa. El loader existente conserva su contrato por defecto; la nueva API solicita IDs como strings para preservar BIGINT.

Endpoints nuevos, todos con JWT, companyScope, collection.view y collection.manage:

| Método | Ruta | Resultado |
|---|---|---|
| GET | `/api/collection/customers/:customerId/message-templates?reference_date=YYYY-MM-DD` | Plantillas disponibles para ese cliente/contexto. |
| POST | `/api/collection/customers/:customerId/messages/preview` | Vista previa, datos asociados, variables y faltantes. |
| POST | `/api/collection/customers/:customerId/messages/prepare` | Revalidación y contenido preparado temporalmente. |

Los POST aceptan únicamente `template_id` y `reference_date`; no contenido, teléfono, actor, saldo, empresa o factura suministrados como autoridad. El paso se decide en la ruta. Las consultas usan una transacción READ ONLY y `Cache-Control: no-store`; la misma lectura interna del pipeline proporciona el contexto y la factura principal. No son endpoints de envío.

Flujo: botón en tarjeta/detalle → selector del cliente ya asociado → seleccionar plantilla → «Ver vista previa» → «Preparar mensaje». Se muestran cliente, teléfono original, plantilla, texto final, variables y advertencia de que no se ha enviado. La preparación vuelve a comprobar plantilla activa y datos actuales; una plantilla desactivada entre pasos se rechaza. El resultado preparado permanece únicamente en memoria del panel y se descarta al cerrarlo/cambiar contexto; no es una cola durable.

El borrador libre temporal de 4.9 se sustituye por este único flujo de plantillas. No queda un segundo sistema de mensajes ni se inventan textos comerciales. Sin plantillas: **«No hay mensajes configurados»**.

## Variables y teléfono

Solo se admiten estas variables; todas las usadas por la plantilla requieren información:

| Variable | Fuente del backend |
|---|---|
| `{{cliente}}` | Nombre del cliente autorizado. |
| `{{factura}}` | Número de `main_invoice`; no se escoge una alternativa. |
| `{{saldo}}` | Saldo total pendiente del cliente, representado en COP sin conversión monetaria ni descuento. |
| `{{fecha_vencimiento}}` | Vencimiento de `main_invoice`, YYYY-MM-DD. |
| `{{dias_mora}}` | Días calendario de mora de `main_invoice` a la referencia; cero si todavía no está en mora, NULL si falta la fecha/factura. |

El reemplazo es literal, no recursivo, sin eval ni interpretación HTML. React presenta el texto escapado. Variables desconocidas, formato inválido, contenido vacío o valores faltantes se informan en la vista previa y bloquean preparación (también en backend). En clientes pendientes sin `main_invoice`, las variables de factura quedan faltantes; no se inventa una factura principal. Reabrir WhatsApp recarga el selector y descarta la preparación anterior, evitando estados de carga atascados.

Se usa `customers.phone` exactamente como está almacenado, sin añadir prefijos, normalizar, cambiar números o crear contactos. Sin teléfono se muestra **«Este cliente no tiene un número de WhatsApp registrado.»** y se bloquea preparación. No se verifica que ese teléfono tenga una cuenta WhatsApp: eso depende de la integración futura.

## Seguridad y ausencia de envío

No se modifican auth, roles ni políticas de permisos. Se reutiliza collection.manage, que ya protegía la preparación manual de 4.9; messages.view/manage permanecen pendientes. Cliente y plantilla ajenos producen 404; empresa inactiva, usuario sin permiso/inactivo y contexto global no seleccionado se rechazan. Los errores SQL no se exponen al cliente.

No se insertan filas en messages, gestiones, promesas o auditoría al preparar. Tampoco se escriben customers, invoices, payments o payment_allocations. No existe status de delivery, sent_at, proveedor, cola ni llamada a Meta/Cloud API/wa.me. El frontend solo llama al API propio; las fuentes Google existentes del proyecto no constituyen mensajería y se conservaron.

## Pruebas y evidencia

- Baseline: backend 210/210; frontend 71/71.
- Backend final: **218/218**, sin fallos ni omisiones; incluye sustitución literal, datos faltantes, autorización/IDOR, aislamiento empresarial, plantillas inactivas/ajenas/NULL/canal/etapa, teléfono, revalidación y errores de DB. CHECKSUM demuestra que preview/prepare no escribe registros operativos/financieros/mensajes.
- Frontend final: **93/93** en nueve archivos; incluye apertura/reapertura desde tarjeta, asociación de cliente, estados vacíos/errores, variables/teléfono/contenido vacío, permisos, foco, abortado de respuestas tardías y rutas/payloads.
- Lint y build de producción con `VITE_API_URL=https://api.mertelimportaciones.com`: aprobados.
- E2E: **24/24 Chromium**, sin omisiones. Incluye login existente, operaciones previas, beneficios y seis pruebas del nuevo flujo/errores. Una prueba adicional usa navegador → proxy transparente de tests → Express real → MySQL temporal: login/me, cookie HttpOnly, gestión, promesa, preparación, invariancia de registros, recarga, logout/revocación y storage vacío.
- Responsive comprobado a **1440, 1024, 768, 390 y 320 px**: sin overflow de documento/cuerpo del modal, límites de viewport, botones accesibles y cierre/foco por teclado. Facturas se presentan como fichas mediante estilos sobre la tabla existente.
- Capturas de tests en tmp/collection51-pipeline-*.png, tmp/collection51-message-*.png y tmp/collection51-integrated.png (ignoradas por Git). La verificación visual agent-browser confirmó carga del login del dev server; las capturas contienen exclusivamente fixtures aislados.

Las fixtures y plantillas de prueba viven exclusivamente en esquemas generados o mocks dentro de tests. Cada esquema temporal se elimina con validación de prefijo y exclusión de DB_NAME real. No se prueban credenciales del propietario ni se crean datos comerciales en su base.

## Límites reales y cierre

La lectura de la base real confirma **cero empresas y cero plantillas**; no hay contexto empresarial operativo MERTEL disponible para el administrador global. El software está validado con fixtures aislados; no se declara validación con cartera/plantillas reales ni puesta en producción. Habilitar datos oficiales y una cuenta con empresa requiere un procedimiento posterior expresamente autorizado. El editor de plantillas no se implementa en esta fase.

WhatsApp real queda pendiente: proveedor/cuenta, plantillas oficiales, validación del destinatario y decisiones de frecuencia, horarios, consentimiento, cuotas, pausas, reintentos y delivery. No se activa ninguna de esas políticas ni Fase 5.2. La preparación no garantiza que el saldo o la plantilla continúen vigentes cuando exista un envío futuro; esa fase tendrá que revalidar.

Archivo protegido: database/migrations/001_initial_schema.sql conserva el cambio local previo y su hash `e2f0b2c49c979991914a187dc9531d9c5d2117ce`; queda fuera de staging/commit. Sin nuevas migraciones ni cambios de .env/secrets.

CHECKSUM de las quince tablas de aplicación antes y después de todas las pruebas: sin cambios, incluidos usuarios, settings, auditoría, mensajes, gestiones/promesas y tablas financieras. Cero esquemas temporales de estas pruebas permanecen al cerrar.

## Archivos de esta fase

Backend:

- backend/src/controllers/collectionMessages.controller.js
- backend/src/models/companyConfiguration.model.js
- backend/src/routes/collection.routes.js
- backend/src/services/collection.service.js
- backend/src/services/collectionMessages.service.js
- backend/src/utils/messageTemplate.js
- backend/test/collectionMessages.test.js

Frontend:

- frontend/src/pages/Cobranza/Cobranza.jsx
- frontend/src/pages/Cobranza/Cobranza.css
- frontend/src/pages/Cobranza/CollectionOperations.jsx
- frontend/src/pages/Cobranza/CollectionMessages.jsx
- frontend/src/services/collectionMessages.service.js
- frontend/test/collection.test.jsx
- frontend/test/collectionOperations.test.jsx
- frontend/test/collectionMessages.test.jsx
- frontend/test/collectionMessages.service.test.js
- frontend/test/e2e/collection.spec.js
- frontend/test/e2e/collectionMessages.spec.js
- frontend/test/e2e/collectionMessages.integration.spec.js

Documentación:

- docs/architecture/MERTEL_PHASE_5_1.md
- docs/MASTER_PLAN.md
- docs/roadmap/MERTEL_ROADMAP.md

Commit selectivo autorizado tras validación: `feat: mejorar panel operativo y preparar mensajes WhatsApp MERTEL`, en main y push a origin/main. El hash y resultado remoto se reportan en el chat tras ambas operaciones.
