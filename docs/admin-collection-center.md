# Centro Administrativo de Cobranza MERTEL

## Auditoría previa y alcance

La aplicación ya dispone de dashboard general, dashboard de cobranza, Pipeline persistente e importado, motor de etapas, núcleo de pagos/allocations, resultados de gestión, pagos reportados, promesas, historial del cliente, historial administrativo, auditoría, importaciones, resolución de clientes, Centro de WhatsApp, plantillas y configuración de cobranza.

El dashboard anterior `/administracion/dashboard-cobranza` permanece disponible. Su endpoint `/api/admin/collection/dashboard` exige fechas explícitas y reúne cartera, etapas principales, promesas pendientes y cantidad de gestiones. No contiene recuperación financiera, pagos reportados, WhatsApp, actividad reciente ni rankings; por eso no satisface por sí solo este Centro.

Se agrega `/administracion`, con el enlace **Administración → Centro Administrativo**. No se crean sistemas de pagos, promesas, mensajería, historial, clasificación o resolución. No hay SaaS, planes, selector de empresas ni nuevas tablas. No es necesaria una migración posterior a 009. La migración 001 no se modifica.

## API y permisos

`GET /api/admin/dashboard` reutiliza autenticación y `requireCompanyScope` (MERTEL fijo) y exige `settings.manage`. No se modifican roles ni permisos existentes. Los cobradores sin este permiso reciben 403. `company_id` no permite cambiar a otra empresa.

Parámetros: `period=today|7|month|custom`. Personalizado requiere `from` y `to` en YYYY-MM-DD, fechas reales, ordenadas, máximo 366 días y sin fechas futuras. La fecha de referencia no es controlada por el navegador: el servidor fija el día actual en America/Bogota. Límites UTC: 05:00 del primer día hasta 05:00 del día siguiente al último, exclusivo.

Respuesta: `company`, `updated_at`, `period`, `definitions` y secciones `summary`, `collection`, `recovery`, `reported_payments`, `resolution`, `promises`, `whatsapp`, `recent_activity`, `top_customers`, `priority_customers`. Cada sección declara `status: ok|error`; un error parcial no se convierte en cero. Los mensajes de error son genéricos y no contienen SQL. Cache-Control: no-store.

## Fuentes y definiciones

| Métrica | Fuente / definición | Tiempo |
|---|---|---|
| Cartera total | `readCompanyCollection` → `invoices.balance`, documentos persistentes positivos de clientes activos/no eliminados del contexto | Estado actual |
| Clientes en cobranza | Clientes elegibles que devuelve el motor existente | Estado actual |
| En mora, vence hoy, faltan 5 días, pronto pago | Catálogo y clasificación por factura del motor existente; saldo de documentos elegibles en cada etapa | Estado actual |
| Clientes/documentos por etapa | Documentos elegibles y clientes distintos con al menos un documento en esa etapa; un cliente puede figurar en más de una | Estado actual |
| Mayor cartera pendiente | Una consulta SQL agregada sobre los mismos balances persistentes; diez clientes, saldo descendente, ID como desempate | Estado actual |
| Mayor prioridad | Primeros diez clientes en el orden ya emitido por el motor, con su factura principal, prioridad, etapa y fechas | Estado actual |
| Clientes gestionados | `COUNT(DISTINCT customer_id)` de `collection_actions` por `action_date` | Período |
| Gestiones realizadas | Cantidad de registros de `collection_actions` por `action_date`; incluye resultados financieros/reportes existentes | Período |
| Contactos exitosos (CONTACTED) | Resultados explícitos CONTACTED, cuyo catálogo existente dice “Contacté al cliente”; éxito de contacto operativo, no conversión ni venta | Período |
| Clientes sin respuesta | Clientes distintos con resultado NO_RESPONSE; puede coincidir con un cliente contactado en otro momento | Período |
| Pagos parciales / completos | Resultados PARTIAL_PAYMENT / PAID registrados; no se infieren de importes ni representan todos los pagos históricos | Período |
| Payments registrados / importe | Payments con `status=confirmed`, por `created_at`, independientemente de `payment_date` | Período |
| Allocations / importe | Allocations activas (`deleted_at IS NULL`), pago confirmed y factura del mismo contexto, por `allocation.created_at` | Período |
| Facturas saldadas | Facturas distintas con evento `invoice_settled` en `audit_logs`; no se cuenta una factura actual de saldo cero como saldada en un período arbitrario | Período |
| Pagos reportados pendientes / importe informado | `collection_actions`: PAYMENT_REPORTED, PENDING_REVIEW; suma de reported_amount, nunca dinero financiero recuperado | Estado actual |
| Pagos reportados confirmados | PAYMENT_REPORTED / CONFIRMED por `reviewed_at` | Período |
| Resolución | `getCustomerResolutionDashboard`, sin recalcular su pendiente: SEARCHING + NEW + AMBIGUOUS + INVALID | Estado actual |
| Encontrados / resueltos | FOUND se presenta como encontrados; PERSISTENT + RESOLVED como resueltos; conteos de estados devueltos por el módulo existente | Estado actual |
| Promesas activas | payment_promises pending cuya promised_date es hoy o posterior; no se altera status | Estado actual |
| Promesas vencidas | payment_promises pending cuya promised_date es anterior al día de referencia | Estado actual |
| Próximas a vencer | Promesas pending entre hoy y cinco días después, inclusive | Estado actual |
| Promesas cumplidas | Promesas fulfilled por fulfilled_at; mantiene invoice_id existente | Período |
| Conexión WhatsApp | Solo provider/connection_status de settings.whatsapp_center; configuración ausente usa defaultWhatsAppSettings existente | Estado actual |
| Mensajes pendientes/fallidos actuales | messages de canal whatsapp por estado actual; pendientes incluye PENDING/PROCESSING | Estado actual |
| Enviados/entregados/leídos/fallidos del período | Mensajes creados en el período (`created_at`), clasificados por su estado actual; no es un conteo de transiciones de entrega | Período |
| Actividad reciente | Últimos veinte audit_logs operativos del período; actor, tipo, acción, cliente/factura e importe cuando existen | Período |

El saldo de cada etapa se suma a partir de sus facturas clasificadas. No se atribuye todo el saldo del cliente a la etapa de su factura principal. No se agregan cifras de Excel temporal ni se aplican descuentos de pronto pago. Los avisos/configuraciones pendientes del motor se muestran al administrador.

**No disponible:** recuperación atribuida comercialmente a gestión y cobrador responsable de un cliente persistente. No existe una definición/autorización suficiente para deducirlos del usuario del último pago, de una gestión o de un campo temporal del Excel. No se crea una segunda fórmula de prioridad.

Las facturas saldadas históricas que carezcan de evento `invoice_settled` no pueden atribuirse retrospectivamente a un período; la tarjeta dice “eventos auditados”. Los resultados parciales/completos se identifican explícitamente como resultados de gestión. No se equiparan pagos registrados con recuperación comercial atribuible.

## Backend e integridad

`adminDashboard.service.js` agrega consultas de lectura y reutiliza `readCompanyCollection`, la política/fechas existentes, el resumen de resolución y los defaults de WhatsApp. El resumen de resolución admite una conexión opcional, conservando su API previa, para participar en la misma transacción.

El agregador utiliza **START TRANSACTION READ ONLY**, una conexión liberada al terminar y commit/rollback. No genera auditoría al consultar. No llama a operaciones de generación de mensajes, conciliación, asignación, revisión de pagos, actualización de promesas ni escritura de reglas. La ruta continúa usando la seguridad MERTEL existente.

Se agrupan métricas por fuente. No hay SQL por cliente ni factura; rankings y actividad se limitan a diez/veinte filas. La prueba de consultas verifica una cantidad fija menor de 25 llamadas, sin INSERT/UPDATE/DELETE/ALTER, independiente de las tarjetas. El motor existente se carga una sola vez.

No se devuelven objetos de settings completos, credenciales, ciphertext, contraseñas ni tokens. WhatsApp proyecta solo proveedor y estado de conexión. La auditoría proyecta campos explícitos en lugar de devolver new_values completo. SYSTEM se conserva cuando actor_type lo indica.

## Frontend y navegación

`AdminDashboard.jsx`, CSS propio y wrapper de API. Mantiene las tarjetas, tipografía, botones y colores existentes. Separa Estado actual y Actividad del período. Presenta loading, autorización, vacíos, errores parciales, Reintentar y Actualizar. Las solicitudes se cancelan al cambiar período o desmontar; no se mantienen cifras obsoletas como si correspondieran al período nuevo.

La nueva navegación administrativa ordena Centro, clientes por resolver, pagos reportados, auditoría, WhatsApp, plantillas, configuración e importación; conserva el dashboard anterior. El menú permite desplazamiento vertical en pantallas de poca altura.

Acciones rápidas navegan a módulos existentes con sus permisos actuales: importación, resolución, reportes, historial filtrado por promesas, cobranza/Pipeline, auditoría, WhatsApp y configuración. La nueva página no realiza operaciones financieras.

Los rankings abren el detalle existente de cobranza mediante `navigationState.customerId` y la fecha de referencia del servidor. El historial admite filtros iniciales de promesa/cliente desde navegación. Las páginas conservan su funcionamiento independiente del router; los adaptadores de ruta transmiten esos datos mediante props. Los eventos enlazan al cliente cuando hay ID y al historial existente cuando el usuario tiene permiso. Para clientes sin saldo que ya salieron de cobranza, el enlace general sigue disponible pero no fabrica una tarjeta de Pipeline.

Responsive: varias columnas en escritorio, dos según espacio y una en móvil; las tablas desplazan horizontalmente dentro de su contenedor y no desbordan el documento. Se comprobó visualmente el escritorio y se verificaron 390, 768 y 1366 px en navegador.

## Validación

Pruebas backend nuevas: fecha/UTC/períodos, cuatro etapas usando el motor, prioridad, autorización, rechazo de cambio de contexto, cartera y reportes/promesas reales, payments/allocations por período, auditoría SYSTEM, estado MOCK, secretos excluidos, consultas acotadas, fallo SQL parcial real y snapshots completos del núcleo financiero.

Pruebas frontend nuevas: carga, tarjetas, autorización sin consulta, vacíos, navegación, filtros/personalizado, actualización por API, fallo general y fallo parcial con reintento.

E2E nuevo: login administrativo real, Express real con MySQL aislado, todas las secciones disponibles, importes contrastados con fixtures persistentes, período, refresh, detalle de cliente, Pipeline, reportes, auditoría, filtro de promesas y responsive. El encaminamiento de peticiones solo dirige el navegador al Express aislado, sin respuestas backend simuladas.

Los snapshots comparan todas las columnas de invoices/payments/payment_allocations antes y después de consultar/actualizar/navegar. Las bases de prueba son temporales, separadas de la base operativa y se eliminan al finalizar. No se insertan pagos de prueba en la base operativa.

| Comprobación | Resultado |
|---|---|
| Backend completo | 271 pruebas aprobadas, sin skips |
| Frontend completo | 163 pruebas aprobadas, 20 archivos |
| E2E completo | 63 pruebas aprobadas, sin skips |
| Lint | Aprobado |
| Build | Aprobado |
| Diff check | Aprobado |
| Integridad financiera del dashboard | Snapshots sin cambios |

Warnings no bloqueantes: bundle de 576.02 kB supera el aviso de 500 kB; Playwright hereda FORCE_COLOR/NO_COLOR; Git advierte conversión LF/CRLF; Vitest sugiere optimización de sus entornos aislados jsdom. No se modifica arquitectura/bundling para ocultar el aviso.

## Exclusiones de Git

Preservados sin modificación, reversión ni staging: backend/package.json (script duplicado de resolución), database/migrations/001_initial_schema.sql (cambio local previo) y frontend/test/collectionDashboard.test.jsx (ajuste de la fase de resolución). Se compararon sus hashes con el cierre anterior. Capturas y resultados generados permanecen en ubicaciones ignoradas; no se incluyen secretos ni fixtures operativos.

Commit solicitado: `feat: implementar centro administrativo de cobranza MERTEL`. Staging selectivo por archivo; nunca git add .; push origin/main después de aprobar todas las comprobaciones.
