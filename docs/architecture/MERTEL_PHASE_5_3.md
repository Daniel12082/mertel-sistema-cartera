# FASE 5.3 — Infraestructura de importación y validación de cartera

Fecha: 06/10/2026. Producto: MERTEL Importaciones. Esta fase implementa análisis estructural preliminar de CSV, lotes auditables y una pantalla administrativa por empresa.

**Esta fase NO habilita todavía la importación operativa de cartera MERTEL porque el formato fuente real aún no ha sido certificado.** El resultado exitoso significa únicamente que se pudo analizar la estructura; no valida contenido comercial ni aplica filas.

## Flujo y formatos

Administración → Importar cartera permite elegir un archivo CSV UTF-8 de hasta 2 MiB, enviarlo como contenido crudo al backend, detectar encabezados y filas, revisar una muestra de hasta diez filas y consultar los errores/advertencias estructurales. El backend no escribe archivos temporales ni conserva el contenido original. No hay soporte XLS/XLSX, ejecución de fórmulas/macros, mapping de columnas ni endpoint de confirmación/aplicación. Se rechazan MIME/extensiones incompatibles, cuerpo vacío, UTF-8 inválido, CSV mal formado, columnas/filas por encima de límites y nombres de archivo con control/path fuera de su basename. La vista muestra el estado «Formato no configurado» y explica que no se realizaron cambios; no presenta una acción «Importar».

Los errores guardan código genérico, fila, columna y mensaje. `field_value` siempre queda NULL, para no persistir valores de cartera. La vista previa se limita a diez filas y trunca cada celda a 300 caracteres. El SHA-256 se calcula sobre los bytes exactos. Un lock de MySQL por empresa serializa la detección del mismo archivo y la creación de lote; una coincidencia devuelve advertencia y referencia el lote existente, sin crear otro. No se procesa ningún lote simultáneamente ni se implementa rollback de negocio porque no existe aplicación en esta fase.

## API, permiso y aislamiento

| Método | Endpoint | Operación |
|---|---|---|
| POST | `/api/admin/portfolio/imports/analyze?file_name=...` | Analiza bytes CSV (`Content-Type: text/csv`); admin global requiere además `company_id` explícito en query. |
| GET | `/api/admin/portfolio/imports` | Lista hasta 50 lotes de la empresa autorizada; admin global requiere `company_id`. |

Ambas rutas requieren JWT, `portfolio.import` y `requireCompanyScope`. El permiso implementado se incluye en el rol `admin` por el mecanismo existente. `supervisor` y `collector` no lo reciben. El ámbito de usuarios de empresa procede de la identidad autenticada; la empresa del body/header no puede reemplazarlo. El servicio vuelve a exigir empresa explícita y activa, incluyendo para administración global.

Se reutilizan `import_batches`, `import_errors` y `audit_logs`. La nueva migración `006_portfolio_import_analysis.sql` añade `file_sha256` más índice empresa/hash y `error_code`; campos previos mantienen su significado. `analyzed_unconfigured` representa que terminó el análisis sin aplicar datos. El endpoint registra análisis o intento de duplicado con empresa, actor, lote, hash y resumen; no incluye celdas. El script `npm run migrate:portfolio-import` instala únicamente 006 y no ejecuta 001. Las pruebas aplican la migración solo en schema temporal. Esta orden no ejecutó la migración en la DB configurada.

## Límites comerciales pendientes

No se definieron encabezados, mapeo, esquema real de MERTEL, identificación/matching de clientes o facturas, reglas para filas nuevas/existentes ni productos/SKU. No se modifica `customers`, `invoices`, `invoices.balance`, `payments` ni `payment_allocations`. No se transforma ausencia/reaparición de factura en pago o saldo cero. `invoices.balance` sigue siendo fuente de verdad; conciliar saldos externos con pagos posteriores, diferencias y snapshots sigue pendiente (D10–D15/D33). Sin archivo real certificado tampoco es posible determinar hojas, columnas, tipos de fecha/moneda, claves idempotentes de negocio, comportamiento de omisiones ni cómo reconciliar cargas semanales. Estos puntos requieren revisión del archivo y decisiones comerciales antes de una fase futura.

No se creó empresa, cliente, factura, pago, asignación, plantilla o configuración empresarial ficticia en la base real. Los fixtures de integración viven en un schema aleatorio con prefijo `mertel_portfolio_import_test_` y se eliminan al terminar.

## Pruebas y verificación

La suite backend cubre parser/UTF-8/CSV inválido, permisos y roles, límites de filas/columnas, migración idempotente, análisis HTTP, errores estructurados, límite/tipo/extensión, duplicados, companyScope, empresa global explícita, historial y snapshots de datos financieros: **230/230**. Frontend: **110/110**; ESLint y build: **OK**; Playwright: **39/39**, incluyendo 1440/390/320. La DB configurada `mertel_cartera` se verificó en solo lectura: **0 empresas y 0 lotes**. Al final no quedó schema temporal `mertel_portfolio_import_test_*`. No se aplicó migración a la DB configurada ni se insertaron datos reales/ficticios en ella.
