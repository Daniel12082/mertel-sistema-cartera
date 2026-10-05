# Fase 4.9 — Gestión operativa manual MERTEL

Fecha: 05/10/2026. Implementada y validada en el alcance autorizado. Base: `main`, `41f1d96ff6de1e756ff327ae84871b19bd93c400`. La comprobación con contexto real MERTEL está pendiente; los resultados técnicos proceden de pruebas aisladas. No se inicia 5.0 ni se declara resuelto un pendiente comercial.

## Backend y contrato

Se preserva íntegro `GET /api/collection?reference_date=YYYY-MM-DD` de consulta. El resumen operativo reutiliza su cliente, etapa, facturas y saldos; no necesita otra ruta de resumen.

| Método y ruta | Permiso | Contrato |
|---|---|---|
| GET `/api/collection/customers/:customerId/actions` | collection.view | Historial de gestiones; invoice_id opcional |
| POST `/api/collection/customers/:customerId/actions` | collection.view + collection.manage | action_type y description requeridos; invoice_id opcional |
| GET `/api/collection/customers/:customerId/promises` | collection.view | Historial de promesas; invoice_id opcional |
| POST `/api/collection/customers/:customerId/promises` | collection.view + collection.manage | promised_date y promised_amount requeridos; notes e invoice_id opcionales |

Todos requieren JWT y companyScope existentes. company_id en query solo selecciona alcance para administrador global, que necesita compañía explícita; usuarios vinculados conservan su propia compañía. No se acepta company_id, usuario ni status desde el body. IDs unsigned BIGINT se validan sin conversión numérica con pérdida. Factura debe pertenecer al cliente y compañía; cliente/factura inexistente o ajeno devuelve 404. Cliente inactivo rechaza creación con 409. Validaciones devuelven 400, falta de sesión 401 y permiso 403; errores internos son genéricos.

POST devuelve 201 `{success:true,data:registro}`; GET devuelve 200 `{success:true,data:[registros]}`. Registro común: id, customer_id, invoice_id, user_id, user_name, invoice_number, status y created_at ISO. Gestión añade action_type, description y action_date ISO UTC. Promesa añade promised_date YYYY-MM-DD, promised_amount decimal exacto y notes. Historias ordenadas por created_at descendente y luego id. No se exponen datos de credenciales/contacto del autor ni objetos SQL.

Tipos de gestión: texto libre extensible de 1–50 caracteres, explícitamente sin catálogo oficial. Descripción requerida y notas opcionales hasta 4000 caracteres. Promesa: fecha de calendario válida y cantidad decimal positiva con hasta 13 dígitos enteros y dos decimales, insertada como DECIMAL(15,2). No se inventa restricción de fecha futura, límite contra saldo ni unicidad de promesa; no se implementa política de múltiples promesas ni edición/cancelación.

## Modelo y transacción

Reutiliza collection_actions, payment_promises y audit_logs existentes; messages/message_templates ya existen y no reciben escrituras. Sin migración nueva ni modificación de schema. Gestiones nacen `completed` y promesas `pending`, estados ya presentes en el esquema. Autor y compañía proceden del alcance autenticado; hora de gestión procede del servidor. No hay endpoint para cambiar estado.

POST bloquea el cliente y, si se indicó, su factura; inserta el hecho y la auditoría con actor, compañía y referencias en la misma transacción. Un fallo de auditoría revierte el registro. GET usa transacción de solo lectura. Los joins comprueban compañía de registro/cliente/factura, y no muestran registros históricos que referencien una factura ajena. Autor global con company_id NULL puede mostrarse en su operación autorizada. El historial operativo procede de sus tablas, no de audit_logs.

Solo se activa el permiso existente collection.manage para admin, supervisor y collector, cuyos grants ya estaban previstos. No se crean roles ni permisos, ni se habilitan administración de reglas, messages.send o el módulo futuro history.view. Historial del cliente se protege con collection.view. JWT, refresh, CORS, cookies y configuración de producción no se modifican.

## Interfaz

Dentro del detalle existente de /cobranza: cliente, etapa, facturas/saldos, formularios manuales y dos historiales con filtro por factura. Servicios usan el cliente HTTP autenticado existente y cantidades/fechas conservan sus cadenas. Historial con loading/error/empty/reintento; creación preserva texto ante error y evita doble clic mientras está pendiente. Usuarios sin collection.manage consultan historial sin botones de registro.

Preparar mensaje permite escribir y ver contenido en memoria del componente. Al cerrar el detalle se descarta. No hay POST, envío, proveedor, token, webhook, persistencia ni marcado de enviado. La interfaz conserva Escape, cierre, foco inicial, contención del foco con textarea, retorno al disparador y viewport responsive del modal existente.

## Decisiones y efectos preservados

D08 (catálogo), D07/D23/D31/D32 (prioridad, cumplimiento, corte, múltiples promesas), D35 (política definitiva de roles), calendario/límites/exclusiones/mixtas/redondeo de Pronto Pago, 10% y combinación con 3%, clientes sin etapa y mensajería siguen pendientes. No se modifica su estado por implementar registro técnico.

Sin activación comercial de Pronto Pago, aplicación de descuento, cálculo de cumplimiento, pausa/reanudación, prioridad automática, cambio de etapa, envío, importación ni funcionalidades SaaS. Registrar gestión/promesa no cambia invoices.balance, pagos, allocations, mensajes ni resultado del motor.

## Validación ejecutada

- Backend npm test: **176/176**, cero fallos u omisiones. Incluye integración HTTP/MySQL con login real en esquemas desechables, permisos, alcance global, cruces entre compañías y clientes, referencias inválidas, validaciones, historias/filtro y rollback forzado de auditoría para ambas creaciones. Compara balances/estados/pagos/allocations/mensajes y respuesta íntegra de collection antes/después.
- Frontend npm test: **68/68**. Formularios/payload, historial, permisos, loading/error/empty/reintento, doble clic y borrador sin POST; pruebas previas preservadas.
- npm run lint y npm run build: **OK**.
- npm run test:e2e: **15/15**. Login y sesión; cobranza responsive desktop/laptop/tablet/móvil/320px; fecha/filtro; registro manual de gestión y promesa, foco, borrador sin envío y cierre Escape en escritorio/móvil. E2E usa API interceptada de fixtures; no sustituye integración HTTP/MySQL del backend ni acredita datos MERTEL reales.
- Inspección visual de capturas desktop/móvil y login con agent-browser sin errores JavaScript. Backend local escuchó en puerto efímero: health y health/db 200; los cuatro endpoints operativos sin sesión 401.
- Inspección de negocio exclusivamente SELECT: **0 compañías, 1 cliente previo, 0 facturas, 0 gestiones, 0 promesas, 0 mensajes**. No hay contexto autorizado de empresa MERTEL para validación funcional real. No se insertan fixtures en esa base. Las reglas residen en settings; no existe tabla collection_rules independiente.
- Producción mantiene validaciones existentes de variables explícitas, HTTPS/origen exacto y cookies; sus regresiones siguen aprobadas. .env/.env.local ignorados y no incluidos.

## Inventario de esta fase

Backend nuevos: src/controllers/collectionOperations.controller.js; src/models/collectionOperations.model.js; src/services/collectionOperations.service.js; src/services/collectionOperations.validation.js; test/collectionOperations.test.js. Modificados: src/routes/collection.routes.js; src/config/permissions.js; test/authorization.unit.test.js.

Frontend nuevos: src/pages/Cobranza/CollectionOperations.jsx; src/services/collectionOperations.service.js; test/collectionOperations.test.jsx; test/collectionOperations.service.test.js. Modificados: src/pages/Cobranza/Cobranza.jsx; src/pages/Cobranza/Cobranza.css; test/collection.test.jsx; test/e2e/collection.spec.js.

Documentación: este informe, docs/MASTER_PLAN.md, docs/business/MERTEL_DECISIONS_PENDING.md, docs/business/MERTEL_COBRANZA_RULES.md, docs/architecture/MERTEL_COLLECTION_ARCHITECTURE.md, docs/roadmap/MERTEL_ROADMAP.md y actualización de matriz histórica con nota 4.9.

Archivo protegido: database/migrations/001_initial_schema.sql conserva su modificación previa byte por byte (git hash-object `e2f0b2c49c979991914a187dc9531d9c5d2117ce`), excluida del staging y commit. No se editan pagos, allocations, motor, auth ni variables. Publicación solo mediante staging selectivo después de validar; hash/push/status se verifican y reportan al finalizar, sin afirmar despliegue.
