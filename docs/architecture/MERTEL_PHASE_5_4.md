# Fase 5.4 — Centro operativo del cobrador

Fecha: 06/10/2026.

## Objetivo y flujo

La pantalla Cobranza concentra el trabajo diario: pipeline de clientes, búsqueda y filtro por etapa, detalle, facturas, historial de gestiones, promesas y preparación de WhatsApp. Se reutiliza el motor existente como autoridad para la etapa, prioridad, factura principal, motivo y fechas relativas. Cada cliente aparece una vez en el pipeline y conserva todas sus facturas en el detalle.

Las tarjetas muestran saldo total, cantidad de facturas, factura principal, vencimiento, días de mora o días para vencimiento cuando el backend los entrega, e indicador de la promesa pendiente más reciente que exista. Cuando un dato no está disponible se presenta como no disponible o «—»; no se deriva una regla comercial en frontend. La búsqueda filtra nombre, identificación y números de factura presentes en la respuesta completa actual de `/api/collection`; el endpoint no pagina, así que no se descartan resultados paginados.

El detalle organiza resumen, facturas, gestiones, promesas e historial, y WhatsApp. La gestión y promesa reutilizan sus endpoints existentes; WhatsApp conserva selección de plantilla, vista previa y preparación. No hay envío real ni escritura de mensaje enviado. Las promesas mantienen el estado existente `pending`; no se calculan incumplimientos ni automatizaciones.

## Endpoints y permisos

No se crearon endpoints nuevos ni se modificaron contratos existentes. Se reutilizan:

- `GET /api/collection` para pipeline, filtros backend y fechas calculadas.
- `GET|POST /api/collection/customers/:customerId/actions` para historial y registro de gestión.
- `GET|POST /api/collection/customers/:customerId/promises` para historial y registro de promesa.
- `GET /api/collection/customers/:customerId/message-templates`, `POST .../messages/preview` y `POST .../messages/prepare` para la preparación sin envío.
- `GET /api/admin/companies` permite al administrador global escoger una empresa activa como contexto técnico.

Se conservan `collection.view` y `collection.manage` y los permisos administrativos existentes. El backend deriva el actor autenticado y valida ownership y `companyScope` en las operaciones. Para administración global, la pantalla espera que se seleccione una empresa y propaga `company_id` como contexto de consulta; esto no sustituye las verificaciones del backend. Las empresas no activas no se ofrecen para seleccionar.

## Datos y límites

La consulta principal obtiene promesas pendientes en una consulta agrupada, dentro de la misma transacción de lectura y con filtro empresarial; no realiza una consulta por cliente. Solo se muestra la promesa más reciente con estado ya existente `pending`. La consulta no muta datos.

No se añadieron migraciones. No se modificaron facturas, pagos, allocations, saldos o descuentos. No se insertaron datos en la DB configurada, no se creó empresa, cliente, factura, promesa, gestión ni plantilla real. La inspección anterior reportó cero empresas y cero lotes de importación; no se altera ese estado. La importación operativa de cartera sigue pendiente de recibir y certificar el archivo fuente MERTEL.

La mensajería sigue siendo una preparación manual sin proveedor ni envío. No se implementan SaaS, automatización de cobranza, incumplimiento/escalamiento de promesas, cambios de etapa automáticos, dashboard administrativo ni la fase siguiente.

## Decisiones pendientes y limitaciones

Continúan pendientes las decisiones de negocio registradas en `MERTEL_DECISIONS_PENDING.md`, las reglas de importación real, proveedor y autorización de envío WhatsApp, ciclo de vida de promesas y definición de métricas. Esta fase no resuelve esas decisiones. La búsqueda es local sobre la respuesta completa actual porque no existe paginación en ese contrato; si se añade paginación en el futuro, la búsqueda deberá trasladarse al backend para conservar resultados completos.

## Verificación

Verificación ejecutada: backend `npm test` 231/231; frontend `npm test` 115/115; Playwright `npm run test:e2e` 39/39, con escenario de HTTP real contra esquema MySQL desechable y recorridos responsivos de 1440, 1024, 768, 390 y 320 px; `npm run lint` correcto; `npm run build` correcto. Las pruebas de base de datos usan esquemas generados y eliminados por la suite, no la base de negocio.

La migración `database/migrations/001_initial_schema.sql` queda fuera del cambio y conserva el diff local preexistente (eliminación previa de un seed legacy y newline final); no fue editada durante esta fase ni se incluirá en el commit.
