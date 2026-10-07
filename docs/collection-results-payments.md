# Resultados de gestión y pagos desde el Pipeline MERTEL

## Auditoría previa y reutilización

1. `payments` ya registra monto, fecha, método, referencia, observación, estado y creador. POST `/api/payments` usa `addPayment`.
2. `payment_allocations` ya permite asignar un pago a varias facturas, con baja lógica, reversión y unicidad de una asignación activa por pareja pago/factura. POST `/api/payments/:id/allocations` usa `addPaymentAllocation`.
3. El núcleo financiero bloquea pago/cliente/factura, comprueba pertenencia, pago confirmado, disponible del pago y saldo de factura. `reduceInvoiceBalance` descuenta con DECIMAL y condición `balance >= amount`; la reversión restaura el saldo. No se reemplazó esa regla.
4. Antes de esta fase, creación de pago y asignación eran dos solicitudes/transacciones. Faltaba componerlas en una transacción única, exigir resumen de confirmación y evitar duplicados entre reintentos.
5. `collection_actions`, `payment_promises` y `audit_logs` ya sirven como registro operativo, promesas e historial. Se ampliaron los registros existentes, sin crear un segundo historial ni un segundo sistema financiero.
6. El motor de cobranza clasifica documentos y selecciona factura principal. Cobranza persistente lee `invoices.balance`; el Pipeline importado usa originalmente documentos temporales/buckets del Excel. La fase de resolución de clientes permite IDs de cliente persistentes, pero eso no convierte automáticamente los documentos del Excel en facturas financieras.

Se conserva MERTEL como único contexto. No se agregaron empresas, planes, SaaS, roles, selectores de etapa ni WhatsApp real. No se modifica el Excel ni se interpreta la desaparición de un documento como prueba de pago.

## Núcleo financiero y transacción

`payment.service.js` ahora expone `applyPaymentAllocationInTransaction`, extraído del servicio existente sin cambiar sus validaciones financieras. Tanto `addPaymentAllocation` como la nueva composición `addPaymentWithAllocations` utilizan esa misma operación.

`addPaymentWithAllocations` crea el pago confirmado, asigna manualmente los montos elegidos y descuenta los saldos dentro de una sola conexión/transacción. Las facturas se bloquean en orden de ID. Si falla una asignación, gestión o auditoría, el rollback elimina el pago/asignaciones nuevas y restaura los saldos. Nunca se deja un pago sin las asignaciones exigidas por este flujo.

El nuevo módulo utiliza la composición desde `collectionResults.service.js`; no duplica operaciones financieras en otro servicio. Los endpoints financieros anteriores siguen disponibles con sus contratos y soporte de reversión/baja lógica existentes.

Montos DECIMAL(15,2), validados sin redondeo silencioso, con aritmética en centavos BigInt para validar/resumir. Se rechazan valores negativos, cero, más de dos decimales, facturas repetidas, inexistentes, ajenas al cliente, dadas de baja, ya pagadas o con estado no aplicable. La suma de asignaciones no puede superar lo recibido y ninguna asignación supera el saldo de su factura.

El modelo existente admite dinero recibido que queda disponible sin asignar. La pantalla lo muestra explícitamente; no distribuye automáticamente ese remanente ni inventa una regla de reparto. Pago TOTAL/PARTIAL selecciona una factura y MULTIPLE admite hasta 50 asignaciones manuales.

## Confirmación e idempotencia

Primero el backend prepara el resumen: cliente, factura, saldo actual, monto asignado y saldo resultante. Devuelve un token HMAC firmado con la clave de servidor existente `JWT_SECRET`, válido durante 15 minutos y vinculado a empresa, cliente, usuario, datos normalizados y clave de operación.

Al confirmar se vuelve a validar firma, alcance y contenido. El servicio bloquea las facturas y compara los saldos actuales con los del resumen. Un saldo cambiado exige generar un resumen nuevo. El frontend no puede enviar `new_balance`, una etapa manual ni un estado financiero como autoridad.

El formulario conserva un UUID v4 por intento operativo, con bloqueo inmediato frente a doble clic. El backend deriva una clave SHA-256 de contexto MERTEL, cliente, tipo de operación y UUID normalizado. `payments.operation_key` tiene un UNIQUE y se verifica `operation_payload_hash`: repetir la misma solicitud devuelve el pago/asignaciones existentes; reutilizar la clave con otros datos se rechaza. No se usa solamente un timestamp. Las revisiones de reportes además usan una clave estable ligada al ID del reporte.

Un movimiento nuevo con otra clave y un nuevo resumen constituye una nueva operación explícita. No se impuso unicidad comercial de referencias bancarias que el modelo anterior no contemplaba.

## Flujo operativo

Las tarjetas de Cobranza y del Pipeline importado ofrecen **Gestionar**. El detalle permite **Gestionar cliente** y muestra el catálogo que devuelve el servidor:

- Contacté al cliente.
- Envié WhatsApp.
- Promesa de pago.
- Cliente pagó.
- Pago parcial.
- Reportar pago.
- Cliente no responde.
- Cliente reporta inconsistencia.
- Número incorrecto.
- Otra gestión.

“Cliente pagó” abre pago total; “Pago parcial” abre un monto editable. Ambos consultan facturas persistentes, muestran datos actuales y exigen **Revisar pago → Confirmar pago**, con el aviso: “Esta acción modificará el registro financiero y el saldo de la factura.” No se crea un movimiento financiero por seleccionar un resultado.

Los demás resultados se registran en `collection_actions` con cliente, factura opcional, usuario, fecha y auditoría. El resultado WhatsApp registra lo informado por el cobrador; no simula un envío real, ni convierte una gestión manual en SENT/DELIVERED/READ del proveedor.

Las promesas reutilizan `collectionOperation` y `payment_promises`, con fecha/monto/estado e historial. Se conserva el esquema pending/fulfilled y `fulfilled_at`. Después de un pago se cumple una promesa vinculada a factura únicamente cuando esa factura queda en cero; una promesa del cliente se cumple cuando ya no tiene deuda pendiente. No se infiere cumplimiento por interpretar mensajes ni se añade una regla comercial de suspensión.

## Pago reportado y revisión administrativa

Reportar pago guarda factura, monto/fecha informados, observación y usuario como `collection_actions.action_type = PAYMENT_REPORTED`, estado **PENDING_REVIEW**. No crea `payments`, no crea asignaciones y no cambia `invoice.balance`. El detalle y la tarjeta muestran **Pago reportado · Pendiente de conciliación**.

**Administración → Pagos reportados** lista cliente, NIT, factura, saldo actual, monto/fecha informados, usuario, fecha de reporte y estado. Tiene filtros de estado y paginación.

Para confirmar, el administrador verifica el soporte e introduce método/referencia/observación si corresponden. Pasa por el mismo resumen firmado y la misma composición financiera transaccional. La confirmación y sus eventos quedan dentro de la transacción junto con payment/allocation/balance. El estado pasa a **CONFIRMED** y conserva `confirmed_payment_id`.

Si el monto, fecha o factura informados son incorrectos, se rechaza con motivo y se registra un reporte corregido. No se modifica silenciosamente lo que informó el cobrador. Un reporte que supera el saldo actual no puede confirmarse con una asignación que sobrepague la factura.

Rechazar exige motivo, guarda quién/cuándo revisó y cambia a **REJECTED**, sin modificar el núcleo financiero. Un reporte revisado no puede confirmarse o rechazarse nuevamente en sentido contrario. Repetir la misma revisión no crea otro pago.

## Pipeline e importación

Después de una operación, el servidor vuelve a ejecutar `readCompanyCollection`, que reutiliza el motor y catálogo existentes. Cobranza vuelve a consultar su resultado y el Pipeline importado solicita un contexto financiero actualizado. La interfaz no decide qué etapa corresponde ni oculta una tarjeta simplemente por pulsar “pagó”.

Saldo cero y ausencia de otras facturas elegibles eliminan al cliente del resultado del motor. Si quedan otras facturas, se selecciona nuevamente la principal y se devuelve la etapa que corresponde. Los documentos no vencidos sin etapa activa conservan su grupo operativo existente.

Para el Pipeline importado se valida el token firmado de origen, el NIT del cliente persistente y una correspondencia única entre documentos del archivo y facturas de ese cliente. Cuando todos los documentos tienen correspondencia, las tarjetas reflejan el motor y saldos financieros reales. Cuando falta una correspondencia o es ambigua, se conserva el contexto del archivo con un aviso; **no se crea una factura ni un pago ficticio**. La gestión financiera ofrece únicamente facturas que realmente existen en el registro financiero, no los IDs `xlsx:row:...`.

La actualización se hace en una lectura consistente por lote. El archivo original no cambia. La próxima conciliación compara contra la fuente oficial de MERTEL y sigue distinguiendo documentos desaparecidos, modificados o inconsistentes; esta fase no los interpreta automáticamente como pagos.

El cliente divide carteras grandes en solicitudes por debajo del límite JSON existente y conserva todos los tokens de origen. No se aumentó el límite global de la API ni se omitió la validación de documentos para reducir el tamaño.

## Historial, auditoría y permisos

El historial existente incorpora resultados, pago reportado, pago registrado, pago confirmado/rechazado y pagos parciales con monto, factura, actor y fecha. Se reutilizan gestiones/auditoría; no se añade una tabla de historial.

El cobrador conserva el alcance de sus gestiones y promesas; también puede ver los eventos financieros del cliente que están respaldados por sus permisos existentes de consulta de pagos. Esto permite ver la confirmación administrativa de su reporte sin ampliar el alcance de observaciones operativas ajenas. El historial administrativo mantiene sus filtros existentes.

Se auditan resultado, promesa, movimiento financiero, revisión y cancelaciones de mensajes derivadas del estado financiero. No se devuelven SQL ni errores internos de este módulo al usuario.

La auditoría utiliza `correlation_id` (`report:<id>` o `payment:<id>`) y relaciones explícitas a cliente, factura, payment y allocation. Registra confirmación aceptada, movimiento financiero, asignación, saldo anterior/nuevo, factura saldada, recálculo, salida del pipeline y bloqueo de nueva cobranza automática. El reporte conserva su usuario original y la confirmación identifica al administrador que lo revisó.

Las acciones autorizadas por una persona llevan `actor_type=USER` y su `user_id`. El cálculo de saldo, cumplimiento derivado de promesas, reevaluación del motor y cancelación/bloqueo automáticos llevan `actor_type=SYSTEM`, `user_id=NULL` y `triggered_by` con el usuario causante. No se crea un usuario ni un rol SYSTEM. El historial del cliente muestra estos eventos como “Sistema”, con filtro de movimientos financieros, pago/asignación y descripción del cambio.

La prueba de reconstrucción recorre gestión → reporte → confirmación → payment → allocation → balance → factura saldada → recálculo → salida → bloqueo; comprueba orden de auditoría, actores, IDs y valores. Repetir la confirmación no duplica ni el ledger ni esta secuencia. Si la transacción falla, también se revierten sus eventos de auditoría.

Permisos reutilizados:

- `collection.view`: contexto y nueva evaluación del pipeline.
- `collection.manage`: resultados y reporte de pagos.
- `payments.create` + `payment_allocations.create` + gestión: resumen y registro financiero.
- `history.view`: reportes/historial autorizado del cliente.
- `settings.manage`: listado global y revisión administrativa; confirmar además exige permisos financieros.

No se crearon roles. Todas las comprobaciones están en backend y el frontend deshabilita los pagos cuando el usuario no tiene los permisos financieros.

## WhatsApp

Un pago total que deja saldo cero cancela los mensajes automáticos PENDING/FAILED de ese cliente y los audita. No se añade un botón “Desactivar cliente”. El motor financiero determina la elegibilidad y la generación automática no encuentra una regla aplicable después de saldar la deuda, incluso con MOCK conectado y automatizaciones activas.

Con pago parcial se reevalúa el contexto y el preview usa el saldo actualizado. Los mensajes previamente preparados no pueden enviarse si su contenido/contexto financiero ya cambió: se conserva la revalidación del Centro de WhatsApp. Un nuevo mensaje válido puede continuar según horarios, límites e intervalos actuales.

Se corrigió la programación inmediata a la precisión de segundos de DATETIME para impedir que MySQL redondee un mensaje listo al segundo siguiente y posponga su primer intento. La interfaz espera la actualización de la cola antes de habilitar otra acción.

Un pago reportado no equivale a deuda saldada. Se expone el contexto operativo pendiente de revisión; no se introdujo una suspensión comercial automática que las reglas existentes no contemplaban. No se implementó proveedor real, webhook público, IA ni negociación automática.

## Endpoints y archivos

Todos los endpoints nuevos están bajo `/api/collection/results`:

| Método | Ruta | Función |
|---|---|---|
| GET | `/customers/:id/context` | Cliente, facturas persistentes, etapas, catálogo y reportes |
| POST | `/pipeline/refresh` | Reevaluación por lote, con tokens de origen opcionales |
| POST | `/customers/:id/result` | Gestión, promesa o reporte sin confirmar |
| POST | `/customers/:id/payment-preview` | Resumen financiero firmado |
| POST | `/customers/:id/payments` | Pago/asignaciones/gestión atómicos |
| GET | `/customers/:id/reports` | Reportes del cliente autorizado |
| GET | `/reports` | Revisión administrativa global |
| POST | `/reports/:id/payment-preview` | Resumen de un reporte por revisar |
| POST | `/reports/:id/review` | Confirmación o rechazo con trazabilidad |

Servicios nuevos: `collectionResults.service.js`, `collectionResults.validation.js`, `collectionResultsMigration.service.js`. Los cambios en `payment.service.js`, `collectionOperations.service.js`, `collectionHistory.service.js` y la exportación del verificador del contexto del Pipeline permiten reutilización transaccional, historial y validación de origen.

Frontend: `ManagementResults`, `CollectionPaymentForm`, `ReportedPayments`, cliente `collectionResults.service.js` e integración limitada en tarjetas/detalle de Cobranza y `PortfolioPipelineView`. Se conservan los formularios y rutas anteriores.

## Migración y pruebas

La migración **009_collection_results_payments.sql** amplía `payments` con idempotencia y `collection_actions` con datos/revisión/vínculo financiero de reportes. Incluye índices únicos y claves foráneas al pago confirmado y al revisor. No crea nuevas tablas financieras, de promesas ni de historial. Se numera después de la migración 008 de resolución de clientes.

Ejecutar en backend: `npm run migrate:collection-results`. El script usa conexión dedicada y bloqueo por base; reconoce los bloques ya aplicados y rechaza un bloque incompleto. No ejecuta 001. La fase presupone el Centro de WhatsApp/migración 007 existente.

`collectionResults.test.js` utiliza un esquema MySQL aislado y verifica antes/después de cada test invoices/payments/allocations. Prueba pago total, salida/permanencia en motor, pago parcial, múltiples facturas, crédito sin asignar, validaciones, concurrencia, duplicados, firma/alcance/saldos obsoletos, reportes, revisión/rechazo, historial, promesas, permisos, rollback, contexto importado y WhatsApp MOCK activo. `collectionResults.validation.test.js` verifica precisión monetaria, ausencia de new_balance, UUID y resumen firmado.

`collectionResults.test.jsx` cubre Gestionar, catálogo, selección de facturas, pago total/parcial/múltiple, resumen y confirmación, ausencia de escritura financiera al reportar, errores, permisos, revisión/rechazo y actualización del pipeline basada en el resultado del servidor.

`collectionResults.integration.spec.js` recorre el Pipeline con contexto firmado → API Express real → MySQL aislado. Verifica pago completo y balances, reporte sin cambios financieros seguido de confirmación administrativa, pago parcial móvil, historial, asignaciones, actualización del motor y ausencia de nueva cobranza automática con configuración MOCK activa.

Validación: `npm test` backend; `npm run test:financial`; `npm test`, `npm run test:e2e`, `npm run lint`, `npm run build` frontend; `git diff --check`. Los resultados finales, commit y estado Git se entregan en el reporte de cierre.

Validación final: **264 pruebas backend**, **37 de integridad financiera** (suite específica incluida también en backend), **158 frontend** y **61 E2E** aprobadas, sin pruebas omitidas. E2E completo ejecutado con dos workers. Lint y build aprobados; diff check sin errores. El build conserva un aviso no bloqueante por el bundle de aproximadamente 563 kB, superior a 500 kB. Playwright también informa el aviso de entorno NO_COLOR/FORCE_COLOR, sin afectar las pruebas.

La migración 009 se aplicó en la base local configurada y se volvió a ejecutar para comprobar idempotencia. La comparación de registros de invoices, payments y payment_allocations confirmó que no cambió los datos financieros operativos. Las pruebas de pagos y de auditoría se realizaron exclusivamente en esquemas aislados y eliminados al finalizar.

No se cargaron pagos ni fixtures en la base operativa. La migración nueva solo cambia estructura; `001_initial_schema.sql` conserva su modificación local preexistente y queda excluida del commit. Otros cambios locales ajenos se preservan.
