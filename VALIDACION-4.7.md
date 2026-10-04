# CIERRE TÉCNICO 4.7 — MERTEL COBRANZA

Validaciones técnicas aprobadas el 03/10/2026 (America/Bogota). Cierre autorizado por la última orden del usuario aunque el contexto real de MERTEL no esté disponible. La creación/publicación del commit y sus hashes se verifican y entregan en el reporte final del chat.

## Resultado de validación

- UI de facturas corregida: prioridad recibida, Elegible Sí/No y candidatos de etapa con clave, prioridad y motivo. Se conserva el orden recibido. Null/dato ausente se presenta como «—» y un arreglo vacío como «Sin candidatos». No se recalcula ni reconstruye información del motor.
- Backend: 148/148 pruebas aprobadas, sin omisiones. Incluyen HTTP con MySQL en bases de prueba aisladas, permisos, companyScope, reglas, factura principal, saldos y ausencia de escrituras financieras/gestiones/promesas/mensajes.
- Frontend: 51/51 pruebas aprobadas; lint y build OK. La prueba nueva comprueba prioridad cero, elegibilidad falsa y candidatos arbitrarios recibidos sin ordenarlos ni inferirlos.
- E2E de login y cobranza: 12/12 aprobadas. Responsive verificado de 320px a 1440px; modal limitado al viewport, filas apiladas en móvil y recuperación del foco al cerrar. Las fixtures solo existen en pruebas.
- Backend local activo en http://localhost:3000; health 200. GET /api/collection?reference_date=2026-10-03 sin autenticación: 401.
- Frontend local activo en http://localhost:5173, HTTP 200, API http://localhost:3000.
- CORS conserva origen exacto y credentials. Cookies HttpOnly y Secure en producción; configuración explícita de producción obligatoria. Defaults localhost/Lax únicamente en desarrollo o NODE_ENV ausente. Test y producción no heredan esos defaults.
- Contrato real: success/data con reference_date, status, rules_configured, summary y customers; componentes consumen customer, stage, priority, reason, total_balance, eligible_balance, main_invoice e invoices; por factura presentan stage, priority, reason, eligible y stage_candidates. Se conserva una fila por customer.id y la factura principal del servidor.
- Endpoint read-only: SELECT, START TRANSACTION READ ONLY y COMMIT/ROLLBACK; sin INSERT/UPDATE/DELETE en la ruta de consulta. Pruebas aisladas comparan estado antes/después. No se modificaron datos de negocio de la base local real.
- No se introdujeron SaaS, WhatsApp, automatización, gestiones, promesas ni mensajes.

## Única validación no disponible

**NO DISPONIBLE: consulta autenticada contra datos reales de MERTEL.** La base indicada por la configuración local autorizada tiene cero compañías y cero registros de collection_rules. Solo existe un usuario activo admin con company_id=NULL. No hay contexto MERTEL que consultar y no se dispone de otra fuente autorizada en la configuración del proyecto. No se crearon datos ni tokens artificiales en esa base.

Por tanto, no se afirma haber observado rules_configured, saldos, etapas, companyScope ni cambios de fecha contra datos reales de MERTEL. Esos comportamientos se comprobaron mediante pruebas existentes en bases aisladas y fixtures de navegador. La última orden permite el commit/push si este es el único punto no disponible y el resto pasa.

## Inventario del commit de 4.7

Backend:
- backend/.env.example
- backend/src/app.js
- backend/src/config/auth.js
- backend/src/config/permissions.js
- backend/src/controllers/collection.controller.js
- backend/src/models/collection.model.js
- backend/src/routes/collection.routes.js
- backend/src/services/collection.service.js
- backend/test/auth.unit.test.js
- backend/test/authorization.test.js
- backend/test/authorization.unit.test.js
- backend/test/multiCompany.test.js
- backend/test/collection.service.test.js

Frontend:
- frontend/src/App.jsx
- frontend/src/pages/Cobranza/Cobranza.jsx
- frontend/src/pages/Cobranza/Cobranza.css
- frontend/src/pages/Cobranza/collection.presentation.js
- frontend/src/services/collection.service.js
- frontend/test/collection.fixture.js
- frontend/test/collection.service.test.js
- frontend/test/collection.test.jsx
- frontend/test/e2e/collection.spec.js

Documentación:
- frontend/COBRANZA-4.7B.md
- VALIDACION-4.7.md

## Exclusiones y controles de Git

Excluidos: database/migrations/001_initial_schema.sql, backend/.env, frontend/.env.local, node_modules, build/dist, capturas y temporales. .env permanece ignorado; solo se versiona el ejemplo sin secretos. La migración conserva su hash de contenido preexistente e2f0b2c49c979991914a187dc9531d9c5d2117ce.

Rama main. Staging por lista explícita de archivos; sin git add . ni git add ... Mensaje solicitado: feat: implementar cobranza MERTEL. Se exige diff --check, revisión de staging, exclusión de la migración y verificación de HEAD/origin/main después del push. Los avisos NO_COLOR/FORCE_COLOR y LF/CRLF son de entorno/formato; no hubo fallos funcionales.
