# FASE 4.5B — Integridad financiera

Fecha de revisión: 2 de octubre de 2026.

## Alcance y esquema inspeccionado

Se inspeccionaron las migraciones 001–003, modelos, servicios, controllers,
rutas, formularios y `information_schema.columns` de la base configurada.
Los datos de esa base se consultaron exclusivamente en modo lectura.

| Relación / tabla | Hallazgo real | Protección aplicada |
| --- | --- | --- |
| companies → customers/invoices/payments | `company_id` nullable; FK; companies tiene `deleted_at` | Comprobar existencia de empresa y compatibilidad cuando ambos lados la definen. Se mantiene NULL. |
| customers → invoices | Facturas y clientes tienen `deleted_at`; factura identifica cliente por FK | Bloquear baja de cliente con facturas activas y balance positivo. |
| customers → payments | Payments no tiene `deleted_at`; su FK impide borrado físico del cliente | Todos los pagos registrados se consideran historial relevante y bloquean la baja del cliente. No hay una política comercial para descartar pagos históricos. |
| payments/invoices → payment_allocations | FK a ambos padres; `deleted_at` para reversión; unicidad solo de parejas activas mediante columna generada de migración 003 | Bloquear baja de factura con aplicaciones activas; conservar todas las filas revertidas. Bloquear cambios de cliente/empresa con cualquier historial de aplicaciones. |
| customers/invoices → payment_promises | Tabla existente; cliente obligatorio, factura nullable; estado por defecto `pending`; sin baja lógica | Promesas `pending` bloquean bajas. Cualquier promesa registrada impide reasignar cliente/empresa de su factura. Las promesas cumplidas conservan relaciones al permitir una baja sin otras dependencias. |
| collection_actions / messages | Relaciones históricas al cliente/factura; sin saldo ni aplicaciones | No se añaden módulos ni bloqueos por estas tablas. La baja lógica conserva sus FK e historial. |
| import_batches / import_errors / audit_logs | Sin relaciones financieras directas de aplicación a factura/pago | Fuera de alcance. |

## Reglas implementadas

- DELETE clientes: HTTP 409 por deuda activa, pagos registrados, aplicaciones
  activas vinculadas por factura o pago, o promesas pendientes. Sin dependencias
  bloqueantes se conserva la baja lógica existente. Un ID inexistente da 404.
- DELETE facturas: HTTP 409 por `balance > 0`, aplicaciones activas o promesas
  pendientes. Una factura saldada sin esas dependencias se puede dar de baja
  lógicamente, conservando relaciones y aplicaciones revertidas.
- PUT facturas: bloquear cambio de `customer_id` o `company_id` si hay
  aplicaciones activas/revertidas o promesas registradas. Notas, fechas y otros
  campos seguros siguen editables si cumplen las validaciones existentes.
- Facturas: total estrictamente positivo; base/IVA y valores opcionales no
  negativos; fechas reales de calendario si se proporcionan. Las fechas NULL
  siguen permitidas porque el esquema y los datos históricos las admiten.
- `balance` nunca se toma del request. En creación equivale al total. Si cambia
  el total se mantiene el cálculo SQL contra aplicaciones activas y se rechaza
  un total inferior a ellas. Si el total no cambia se conserva el saldo real,
  incluso ante diferencias históricas, para que una edición de notas no lo
  sobrescriba. No se exige `base + IVA = total`.
- Pagos: monto positivo y fecha válida; cliente existente, activo y no
  eliminado; referencias existentes y empresa compatible. Se preserva la
  restricción previa que impide cambiar monto o cliente si hay historial de
  aplicaciones; se añade protección de empresa. Reducir el monto por debajo de
  las aplicaciones activas devuelve 409. Los campos seguros siguen editables.
- Solo `confirmed` es aplicable. Cualquier otro estado no puede recibir nuevas
  aplicaciones; un pago con aplicaciones activas no puede guardar un estado
  distinto de `confirmed`. Tras revertirlas todas puede cambiar de estado.
- POST aplicaciones: pago existente y confirmado, cliente activo, factura
  existente y no eliminada, mismo cliente, empresas compatibles si están
  definidas, monto positivo, disponible suficiente y saldo suficiente.
- Se preservan transacciones, locks de pago/factura/aplicación, aritmética
  DECIMAL, reversión lógica y reasignación de la misma pareja tras revertir.
  Se añade lock de cliente antes de crear/reasignar documentos para serializar
  estas escrituras con su baja. Edición y baja de facturas ahora son
  transaccionales y bloquean la factura.
- Datos inválidos: 400. Referencia/recurso inexistente: 404. Conflicto financiero
  o duplicidad: 409. Error inesperado: 500 con mensaje público genérico, sin SQL.
- Frontend: saldo solo visible en detalle/listado; no se envía en formulario.
  Estado de pago mediante select: `confirmed` y, en una edición histórica, su
  estado actual. Aplicar se deshabilita para pagos no confirmados. Se muestran
  los mensajes 409 del backend.

## Estados: decisión deliberada

La migración usa VARCHAR(30), default `confirmed`; los 2 pagos de la base están
en `confirmed`. Modelo/controller aceptaban texto libre y el frontend también.
No hay catálogo, transiciones ni datos que acrediten otros nombres comerciales.
Por ello **no se inventa un enum de cancelados/anulados/pendientes**. La API
conserva compatibilidad con textos de estado no vacíos de hasta 30 caracteres,
pero solo la coincidencia exacta `confirmed` permite aplicaciones. Las pruebas
usan `legacy_non_applicable` como fixture técnico; no es un estado comercial
nuevo. Un catálogo cerrado y una política de anulación quedan para decisión
del negocio. El formulario ya no ofrece entrada libre.

## Datos existentes que requieren decisión

Inventario observado: 8 clientes, 42 facturas, 2 pagos, 16 aplicaciones y
0 promesas. No se modificaron datos de la base configurada.

| Hallazgo | Resultado |
| --- | --- |
| Deuda oculta previamente por bajas lógicas | 39 facturas con saldo positivo están eliminadas; 17 de ellas también pertenecen a clientes eliminados. Saldo conjunto: 37.601.225,75. |
| Aplicaciones históricas entre clientes diferentes | IDs 1 y 2, ambas revertidas, del pago 1 a facturas 5 y 7: cliente del pago 2, cliente de las facturas 3. |
| Saldo distinto de total menos aplicaciones activas | Facturas 1, 3, 20, 21, 24 y 25. No se presume que el saldo esté errado ni se recalcula automáticamente. |
| Fechas ausentes | 16 facturas sin emisión y 21 sin vencimiento. Se conserva la posibilidad de NULL. |
| Base + IVA diferente de total | 0 en la base inspeccionada; no se convierte en restricción obligatoria. |
| Valores monetarios negativos / total no positivo | 0 en facturas inspeccionadas. |
| Aplicaciones activas de pagos no confirmados | 0. |
| Empresa de documentos incompatible con cliente | 0. |

Los dueños del negocio deben decidir la recuperación de deuda eliminada,
la conciliación de saldos y el tratamiento de las dos relaciones históricas.
No se restauraron registros, no se borraron datos y no se aplicaron ajustes.

Durante el montaje inicial de pruebas se detectó además que ejecutar toda la
migración 001 en este MySQL falla en el identificador `row_number` de
`import_errors`. No se cambió ese archivo. La suite crea solamente las 7 tablas
financieras necesarias a partir de sus definiciones reales y aplica 002/003.
La compatibilidad de una instalación completa desde 001 queda fuera de fase.

## Archivos de esta fase

- `backend/package.json`: comando de pruebas financieras.
- `backend/src/controllers/customer.controller.js`: conflictos de baja.
- `backend/src/controllers/invoice.controller.js`: total positivo y errores HTTP.
- `backend/src/controllers/payment.controller.js`: conflictos de aplicación y referencias.
- `backend/src/models/customer.model.js`: baja protegida y transaccional.
- `backend/src/models/invoice.model.js`: creación/edición/baja transaccionales y protegidas.
- `backend/src/models/payment.model.js`: estado/empresa en lectura bloqueada.
- `backend/src/models/paymentAllocation.model.js`: empresa en lectura bloqueada de factura.
- `backend/src/services/payment.service.js`: estados, referencias, empresa y creación transaccional.
- `backend/src/utils/financialIntegrity.js`: errores y comprobaciones comunes.
- `backend/test/financialIntegrity.test.js`: pruebas HTTP con MySQL real aislado.
- `frontend/src/pages/Factura/Facturas.jsx`: quitar edición/envío del saldo.
- `frontend/src/pages/Pagos/Pagos.jsx`: select de estado y aplicación según estado.
- `docs/FASE_4_5B_INTEGRIDAD_FINANCIERA.md`: este reporte.

No se creó ninguna migración. No se modificaron el motor puro de cobranza
FASE 4.3 ni sus pruebas. El cambio preexistente de
`database/migrations/001_initial_schema.sql` se conserva y se excluye del commit.

## Verificación

- `npm test` en backend: **56/56** aprobadas, sin skips; incluye las 19 pruebas
  preexistentes de cartera/cobranza y 37 nuevas de integridad.
- `npm run test:financial`: **37/37** aprobadas, sin skips.
- Se cubren todos los casos mínimos pedidos, estados no aplicables, bajas,
  referencias, valores/fechas inválidos, compatibilidad de empresas con NULL,
  historial, saldo manipulado, reversión y reasignación de la misma pareja.
- Seis casos de concurrencia: disponible de pago compartido, saldo de factura
  compartida, aplicación duplicada, doble reversión, baja de cliente contra
  creación de factura y edición de total contra aplicación.
- Fallo SQL inducido por trigger exclusivo de la base temporal: se verifica
  rollback del INSERT de aplicación y saldo intacto; HTTP 500 sin SQL público.
  El error que aparece en consola en ese caso es esperado.
- `npm run lint` en frontend: aprobado. Backend no tiene lint configurado.
- `npm run build` en frontend: aprobado.
- `git diff --check`: aprobado tras limpiar espacios finales.
- Revisados diff, stat, status y exclusiones antes de stage/commit.

Las pruebas crean una base `mertel_financial_test_<uuid>` exclusiva usando las
credenciales locales, instalan las tablas con sus FK e índices, sirven Express
en un puerto temporal y eliminan solo esa base al terminar. No escriben en la
base de la aplicación. Requieren permisos CREATE/DROP DATABASE y CREATE TRIGGER;
sin credenciales MySQL se omite explícitamente la suite de integración.

## Fuera de alcance y pendientes

No se implementaron autenticación, autorización, roles, aislamiento multiempresa,
WhatsApp, mensajes/templates, motor nuevo, pipeline, paginación, optimizaciones
ni reglas comerciales de pronto pago. No hay borrado físico ni reasignación
financiera transaccional a otro cliente/empresa.

Las inconsistencias históricas permanecen hasta una decisión explícita. Una
escritura SQL externa puede eludir estas comprobaciones de API. Si en la siguiente
fase se crean endpoints de promesas, deberán respetar los locks de padres usados
para bajas y reasignaciones. Los estados adicionales de promesas y pagos
necesitan catálogo del negocio antes de restringir datos históricos.

Commit solicitado: `feat: reforzar integridad financiera`, con push a
`origin/main`. Hash, resultado del push y estado final de Git se entregan en el
mensaje final para evitar una referencia circular en el propio commit.
