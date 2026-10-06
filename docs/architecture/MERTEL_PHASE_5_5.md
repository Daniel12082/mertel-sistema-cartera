# Fase 5.5 — Dashboard operativo de cobranza

Fecha: 06/10/2026. El dashboard administrativo es de solo lectura y agrega fuentes existentes. No se crearon migraciones, datos empresariales, reglas comerciales, pagos ni funcionalidades de mensajería.

## Endpoint, autorización y alcance

`GET /api/admin/collection/dashboard?reference_date=YYYY-MM-DD&activity_from=YYYY-MM-DD&activity_to=YYYY-MM-DD[&company_id=id]` requiere JWT y los permisos existentes `collection.view` y `settings.manage`. Esta combinación limita el dashboard a administradores; no se cambian los grants de roles. `requireCompanyScope` deriva la empresa de la identidad para usuarios de empresa. El administrador global debe enviar una empresa explícita, que el middleware valida contra empresas existentes. No se acepta alcance global sin empresa ni se permite que un usuario de empresa altere su scope con `company_id`. Las consultas tienen respuestas `no-store` y no generan auditorías por lectura.

## Definiciones y fuentes

| Métrica | Definición | Fuente |
|---|---|---|
| Saldo pendiente total | Suma monetaria de saldos positivos de facturas abiertas que consulta el motor, sin usar `document_value` | `invoices.balance`, `getCollectionOpenInvoices` y `collection.summary.total_balance` |
| Clientes en cobranza | Clientes únicos con alguna etapa elegible activa a la fecha de referencia | `collection.customers` y `collection.summary.total_customers` |
| Clientes por etapa | Conteo único agrupado por etapa principal elegida por el motor | `collection.customers[].stage` y catálogo devuelto por el motor |
| Saldo por etapa | Suma del saldo pendiente total de las facturas activas de cada cliente agrupado por su etapa principal; por eso una persona con varias facturas cuenta una vez | `collection.customers[].total_balance`, agregado backend con suma decimal exacta |
| Promesas pendientes | Filas existentes cuyo estado es exactamente `pending`, y suma de `promised_amount`; no se interpreta vencimiento ni cumplimiento | `payment_promises`, consulta agregada filtrada por `company_id` |
| Gestiones del período | Número de filas de gestión por `action_date` en el intervalo inclusivo de fechas locales; se cuenta cada gestión, no clientes únicos | `collection_actions.action_date`, consulta SQL agregada y filtrada por `company_id` |

El motor compartido se consulta mediante `readCompanyCollection` dentro de una transacción `READ ONLY`, junto con agregados de promesas y gestiones. La fecha de cartera es independiente del intervalo de actividad y se envía como fecha explícita; el backend aplica las reglas y la clasificación existentes. Las fechas de actividad representan días calendario de `America/Bogota` (UTC-5), con fin exclusivo al inicio del día siguiente.

## Límites explícitos

No se muestran dinero recuperado, clientes gestionados, promesas cumplidas/incumplidas, tasas, productividad, ROI, riesgo ni scoring. “Dinero recuperado” queda pendiente de definición operativa y una fuente atribuible. El esquema no establece cuándo una promesa es cumplida ni una definición estable de cliente gestionado. Las gestiones cuentan registros creados por `action_date`, sin inferir contacto efectivo. Advertencias de configuración se reutilizan desde la respuesta del motor; no bloquean saldos y promesas de la consulta.

## Interfaz y pruebas

La página Administración → Dashboard de cobranza separa fecha de referencia y período de actividad (hoy, últimos 7 o 30 días), exige selección empresarial al administrador global y presenta carga, error, vacío y advertencias. Etapas salen del catálogo backend. Estilos adaptan tarjetas/filtros a escritorio y móvil, con ancho mínimo de 320 px.

Backend: `backend/test/collectionDashboard.unit.test.js` cubre agregación por cliente/etapa y grants sin alterarlos. Frontend: `frontend/test/collectionDashboard.test.jsx` cubre métricas, filtros independientes, selección global, permiso, carga, error y vacío. La cobertura integrada HTTP/MySQL aislada debe ejecutarse con las suites del repositorio cuando haya servicio MySQL de pruebas disponible; la base real se mantiene sin escrituras.
