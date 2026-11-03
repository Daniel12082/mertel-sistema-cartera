# Reparación del esquema local 006 y 008

Fecha: 8 de octubre de 2026. Base: `mertel_cartera`, MySQL local.

## Inspección y aplicación

Se leyeron completas las migraciones 006 y 008 y los servicios `portfolioImportMigration.service.js`, `portfolioImport.service.js` y `customerResolution.service.js` antes de ejecutar DDL. Se inspeccionaron tablas, columnas, índices y claves foráneas mediante `information_schema`.

Faltaban `mertel_customer_resolution_rows`, `import_errors`, `import_batches.file_sha256` e `idx_import_batches_company_sha256`. Las demás columnas, índices y claves foráneas de `import_batches` ya existían.

008 se aplicó con `applyCustomerResolutionMigration` sobre una conexión dedicada. Se creó exactamente la tabla original, con 16 columnas: `id`, `company_id`, `import_batch_id`, `identity_key`, `nit_normalized`, `source_rows`, `source_data`, `status`, `customer_id`, `differences`, `decision`, `decision_reason`, `updated_by`, `resolved_at`, `created_at`, `updated_at`. Se verificaron tipos, nulabilidad, valores predeterminados, timestamps, InnoDB y utf8mb4_unicode_ci.

Sus índices son `PRIMARY`, `uk_mertel_resolution_batch_identity (import_batch_id, identity_key)`, `idx_mertel_resolution_company_status (company_id, status)`, `idx_mertel_resolution_nit (company_id, nit_normalized)` y los índices de soporte de FK `fk_mertel_resolution_customer` y `fk_mertel_resolution_user`. Las cuatro FK son `fk_mertel_resolution_batch` y `fk_mertel_resolution_company` con DELETE CASCADE, y `fk_mertel_resolution_customer` y `fk_mertel_resolution_user` con DELETE SET NULL; UPDATE NO ACTION.

006 contiene únicamente ALTER TABLE: añade `file_sha256 CHAR(64) NULL`, el índice empresa/hash y `error_code VARCHAR(80) NULL`. **No contiene el CREATE TABLE de import_errors**. Su definición base pertenece a 001. Se extrajo únicamente ese CREATE TABLE del archivo original, citando `row_number` con backticks en la columna y su índice para MySQL 8.4. No se editó ni se ejecutó la migración 001 completa, ni sus seeds ni otras sentencias.

La tabla base creada contiene `id BIGINT UNSIGNED AUTO_INCREMENT`, `import_batch_id BIGINT UNSIGNED NOT NULL`, `row_number INT UNSIGNED NULL`, `field_name VARCHAR(100) NULL`, `field_value TEXT NULL`, `error_message TEXT NOT NULL`, `created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`, PRIMARY KEY, `idx_import_errors_batch`, `idx_import_errors_row` y `fk_import_errors_batch` hacia import_batches(id), DELETE/UPDATE CASCADE, InnoDB y utf8mb4_unicode_ci. Luego `applyPortfolioImportMigration` aplicó 006 sin modificar su SQL histórico.

Se verificaron todos esos elementos mediante `information_schema` y `SHOW CREATE TABLE`. Al repetir ambos servicios retornaron `applied: false`. El proyecto comprueba estructuras existentes; no se encontró una tabla de historial de migraciones en la base local y no se inventó ninguna ni se marcaron migraciones artificialmente.

## Integridad de datos locales

| Tabla | Antes | Después |
|---|---:|---:|
| companies | 1 | 1 |
| customers | 0 | 0 |
| invoices | 0 | 0 |
| payments | 0 | 0 |
| payment_allocations | 0 | 0 |
| collection_actions | 0 | 0 |
| payment_promises | 0 | 0 |

Además de los conteos, las huellas SHA-256 de todas las filas ordenadas por id coincidieron antes/después, incluso al terminar las pruebas. **No se modificaron datos financieros, balances, pagos, allocations, gestiones, promesas ni reglas de cobranza.** No se insertaron fixtures en la base local. Las suites existentes usan bases temporales aisladas y al finalizar no quedaron esquemas `mertel%test%`.

## HTTP e interfaz

Se verificó el servidor existente en localhost:3000 con un token temporal emitido en memoria por el servicio existente para un administrador activo. No se modificó autenticación, no se guardó el token ni se creó una sesión persistente para esta comprobación.

- GET `/api/admin/portfolio/imports/resolution/summary`: **200**, success=true, todos los conteos y pending=0, batches=[]. Ya no produce 500.
- GET `/api/admin/portfolio/imports`: **200**, success=true, data=[]. Ya no produce 503.

Se abrió localhost:5173 en el navegador de Codex. La instancia requiere iniciar sesión; la comprobación manual de Centro Administrativo → Clientes por resolver y del módulo de importaciones queda pendiente de una sesión del usuario. No se declara como realizada. Las pruebas automatizadas sí cubren importaciones y resolución con respuestas simuladas, y el centro administrativo con API/MySQL aislados.

## Pruebas ejecutadas

- Backend `npm test`: **280/280**, 0 fallidas y 0 omitidas. Incluye resolución de clientes, portfolio imports, dashboard administrativo y pruebas financieras existentes.
- Frontend `npm test`: **179/179**, 23 archivos aprobados, incluyendo customer resolution, portfolio imports y dashboard.
- Frontend `npm run lint`: **OK**. El primer intento falló por ENOENT al recrearse test-results durante Playwright; se repitió sin ejecución simultánea de E2E y pasó.
- Frontend `npm run build`: **OK**, aviso no bloqueante por chunk mayor a 500 kB.
- `npm run test:e2e -- test/e2e/portfolioImport.spec.js test/e2e/adminDashboard.integration.spec.js`: **10 aprobadas, 1 fallida**. Importaciones: 8/8 aprobadas. Dashboard: 2 aprobadas y 1 fallida, en `cards, API periods, refresh, direct customer, payments, promises and audit navigation`: esperaba recovery.payments_amount=10.00 y recibió 0.00 en su base aislada. No se alteraron reglas financieras para forzar el resultado.
- No existen scripts lint/build en backend/package.json.

## Git y límites

Se ejecutaron git status y git diff antes/después. No se hizo git add, commit, push ni se revirtieron cambios locales.

La única incorporación de este trabajo al repositorio es este informe. Los archivos SQL históricos 001, 006 y 008 mantuvieron sus huellas originales. También se preservaron todos los demás archivos presentes al inicio, salvo que se detectó una modificación concurrente externa en frontend/test/e2e/adminDashboard.integration.spec.js; este trabajo no editó ese archivo ni revirtió esa modificación. Los resultados E2E corresponden a la versión cargada cuando comenzó la ejecución.

El estado final conserva los cambios preexistentes en backend/package.json, backend/scripts/provision-mertel.js, backend/src/routes/admin.routes.js, backend/src/services/adminDashboard.service.js, backend/src/services/mertelCompany.service.js, backend/test/adminDashboard.test.js, backend/test/adminDashboard.unit.test.js, database/migrations/001_initial_schema.sql, frontend/package-lock.json, frontend/package.json, frontend/src/App.jsx, frontend/src/index.css, frontend/src/pages/Administracion/CollectionHistory.jsx, frontend/src/pages/Configuracion/Configuracion.jsx, frontend/src/pages/Dashboard/Dashboard.jsx, frontend/test/collectionDashboard.test.jsx, frontend/test/collectionHistory.test.jsx y frontend/test/e2e/adminDashboard.integration.spec.js; también conserva la eliminación previa de frontend/COBRANZA-4.7B.md y los archivos/carpetas no rastreados existentes. Se añadió únicamente docs/local-schema-repair-006-008.md.

Estado final literal (también apareció externamente frontend/test/usuarios.test.jsx durante la verificación):

```text
 M backend/package.json
 M backend/scripts/provision-mertel.js
 M backend/src/routes/admin.routes.js
 M backend/src/services/adminDashboard.service.js
 M backend/src/services/mertelCompany.service.js
 M backend/test/adminDashboard.test.js
 M backend/test/adminDashboard.unit.test.js
 M database/migrations/001_initial_schema.sql
 D frontend/COBRANZA-4.7B.md
 M frontend/package-lock.json
 M frontend/package.json
 M frontend/src/App.jsx
 M frontend/src/index.css
 M frontend/src/pages/Administracion/CollectionHistory.jsx
 M frontend/src/pages/Configuracion/Configuracion.jsx
 M frontend/src/pages/Dashboard/Dashboard.jsx
 M frontend/test/collectionDashboard.test.jsx
 M frontend/test/collectionHistory.test.jsx
 M frontend/test/e2e/adminDashboard.integration.spec.js
?? backend/src/services/userManagement.service.js
?? backend/test/mertelRulesProvisioning.test.js
?? backend/test/userManagement.test.js
?? docs/dashboard-bi-visual.md
?? docs/local-schema-repair-006-008.md
?? frontend/src/components/
?? frontend/src/pages/Configuracion/Usuarios.css
?? frontend/src/pages/Configuracion/Usuarios.jsx
?? frontend/src/pages/Dashboard/Dashboard.css
?? frontend/src/pages/Dashboard/DashboardCharts.jsx
?? frontend/src/services/userManagement.service.js
?? frontend/test/dashboardCharts.test.jsx
?? frontend/test/mainDashboard.test.jsx
?? frontend/test/usuarios.test.jsx
```
