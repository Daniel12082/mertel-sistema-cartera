# MERTEL — modo simulación y cartera temporal

Fecha de revisión: 8 de octubre de 2026. Implementación local, pendiente de revisión del usuario. Sin commit ni push.

## 1. Arquitectura

La aplicación conserva sus rutas y pantallas. `SimulationProvider` selecciona la fuente de datos y conserva los permisos existentes. El cliente Axios compartido cambia su transporte por un adaptador local mientras la simulación está activa. No se genera un JWT, usuario, empresa, tenant o rol nuevo.

La clasificación de cobranza utiliza `evaluateCollectionCase`, `compareCollectionCustomers`, `collectionStageCatalog` y el cálculo de cartera existentes. El redondeo comercial al peso continúa en las funciones originales, sin modificaciones.

## 2. Activación y salida

- Iniciar sesión normalmente y pulsar **Activar simulación** en el encabezado.
- El badge **MODO SIMULACIÓN** permanece visible y reemplaza la identidad presentada por una identidad ficticia.
- **Reiniciar simulación** descarta toda la cartera cargada y las operaciones locales; restaura los datos demo iniciales.
- **Salir de simulación** requiere confirmación, elimina la cartera temporal y vuelve al modo real. Solo después se reanuda la autenticación normal.
- Recargar la página mantiene el modo simulación, pero elimina el archivo y sus modificaciones y restaura el dataset ficticio.

## 3. Ubicación y duración de los datos

Clientes, facturas, pagos, asignaciones, promesas, gestiones, mensajes e historial viven exclusivamente en variables JavaScript de la pestaña. El archivo se lee con `File.arrayBuffer()` y nunca se escribe a disco, IndexedDB, localStorage o sessionStorage por esta implementación.

SessionStorage conserva únicamente el indicador de modo y una identidad de presentación ficticia con los nombres de los roles y permisos existentes. No conserva tokens, nombres reales, archivos ni datos financieros. La simulación no se sincroniza entre pestañas.

## 4. Aislamiento de MySQL

- El interceptor de Axios aplica la selección al despachar cada solicitud, incluso cuando el llamador proporciona su propio adaptador.
- En simulación se eliminan Authorization/Cookie y se desactivan las credenciales del transporte.
- Ninguna ruta desconocida vuelve al transporte HTTP: falla con un error controlado.
- Autenticación, importación al servidor y proveedores externos permanecen bloqueados.
- Cada cambio de fuente incrementa una revisión: respuestas anteriores se descartan. No se permite activar simulación mientras una escritura real esté pendiente.
- El backend rechaza solicitudes `/api` que incluyan `X-Mertel-Simulation: true`, `1` o `simulation`, antes de autenticación, auditoría y consultas SQL. La respuesta es 409 `SIMULATION_LOCAL_ONLY`. OPTIONS mantiene el comportamiento CORS.
- Los subárboles de las pantallas se remontan al entrar, cargar otra cartera, reiniciar y salir, para descartar listas y modales anteriores.

La protección del backend requiere ejecutar la versión actualizada del servidor. El aislamiento primario no depende de ese servidor: el archivo y las operaciones simuladas se procesan localmente.

## 5. Operaciones demostrables

Dashboard, clientes, facturas, cartera, pipeline y detalle de cobranza, gestiones, promesas, pagos parciales/totales y asignaciones locales, pagos reportados y su revisión, historial, plantillas, etapas configurables, Centro Administrativo y WhatsApp MOCK. Los resultados y balances temporales se reflejan al volver a consultar las pantallas.

Las operaciones financieras de demostración usan un libro exclusivamente local y las funciones monetarias existentes. No reemplazan las validaciones transaccionales de producción. No se duplicó el motor de etapas ni se alteró ningún servicio financiero operacional.

## 6. Operaciones bloqueadas

Importación, conciliación y pipeline de archivos por HTTP; autenticación durante la simulación; creación/edición de cuentas; credenciales de proveedores; envíos reales; rutas sin una implementación local explícita. Cualquier acción bloqueada conserva el aislamiento y muestra un error. La consulta de roles conserva el catálogo existente.

## 7. Cargar una cartera propia temporalmente

1. Activar simulación.
2. Abrir **Administración → Importar cartera**.
3. Seleccionar un XLSX MERTEL o CSV UTF-8 con las mismas columnas, máximo 2 MiB.
4. Pulsar **Analizar archivo localmente** y revisar la vista previa.
5. Pulsar **Cargar cartera temporal**. Se reemplaza toda la cartera y las operaciones de la simulación actual.
6. Usar Dashboard, clientes, facturas, cartera, cobranza y pagos. Todos los cambios serán locales.

El XLSX requiere la hoja `cartera de clientes NIIF0`. El CSV utiliza el lector de comas existente, incluido su soporte de comillas y UTF-8. Se reutiliza exactamente la clasificación del importador MERTEL; únicamente se separó el análisis del workbook de la lectura Node del archivo.

**Los datos personales de tu archivo serán visibles en la interfaz mientras simulas.** El encabezado informa que se está usando cartera del archivo. No se mezclan clientes del archivo con datos demo ni con MySQL. Teléfonos, celulares y correos no se habilitan como destinos de envío.

El saldo de cada factura se toma de la suma de las columnas `Corriente`, `1-30 días`, `30-45 días`, `45-60 días`, `60-90 días` y `+90 días`, validado con centavos enteros. No se asume que el valor original del documento es el saldo pendiente. Saldo ausente, negativo, inválido, documentos duplicados, fechas inválidas o columnas faltantes impiden la carga completa; la cartera anterior se conserva.

Devoluciones y notas débito no se aplican como pagos o asignaciones y se informa cuántos documentos quedaron sin aplicar. No se infiere una base de descuento desde el valor del documento: si el motor necesita esa base, el beneficio requiere revisión. No se intenta conciliar la identidad con clientes de MySQL.

## 8. Archivos de esta implementación

Nuevos:

- `frontend/src/simulation/`: store, dataset, vistas, adaptador, contexto, provider, controles, reportes y lector/UI de cartera temporal.
- `frontend/test/simulation.test.js`, `simulationControls.test.jsx`, `temporaryPortfolio.test.js`.
- `frontend/test/e2e/simulation.spec.js`.
- `backend/src/middleware/rejectSimulationRequests.js` y `backend/test/simulationGuard.test.js`.
- `backend/src/services/mertelPortfolioWorkbookParser.js`, `portfolioCsvParser.js`: separación de lectores puros existentes, sin consultas SQL.
- Este documento.

Modificados para integrar la simulación:

- `frontend/src/services/api.js`, `main.jsx`, `App.jsx`, `layouts/MainLayout.jsx`.
- `frontend/src/pages/Administracion/PortfolioImport.jsx`.
- `frontend/src/pages/Cobranza/CollectionPaymentForm.jsx`, `ManagementResults.jsx`: mensajes explícitos de operación temporal.
- `frontend/src/pages/Dashboard/Dashboard.jsx`: etiquetas de origen temporal, conservando el Dashboard anterior.
- `frontend/package.json`, `package-lock.json`: ExcelJS 4.4.0, la misma versión usada por el backend; carga dinámica solo al analizar archivos.
- `backend/src/app.js`: middleware de aislamiento y cabecera CORS.
- `backend/src/services/mertelPortfolioXlsxParser.js`, `portfolioImport.service.js`: delegación a los lectores puros compartidos. El flujo normal de importación conserva sus validaciones y persistencia existentes.

El workspace contiene otros cambios locales anteriores y concurrentes. No forman parte de esta entrega, no se revirtieron ni se incluyeron en un commit. Se conservaron los cambios previos de usuarios en App y los archivos protegidos del usuario. No se editaron reglas financieras, autenticación, permisos, migraciones ni las pruebas financieras originales.

## 9. Pruebas nuevas

- Transporte normal y local, bloqueo de rutas desconocidas y adaptadores personalizados.
- Respuestas antiguas, escritura real en curso, reset y salida.
- Etapas del motor, dashboard, gestiones, promesas, pagos locales e idempotencia.
- WhatsApp MOCK y rechazo de credenciales.
- XLSX y CSV locales, saldo desde antigüedad, vista previa sin efectos, rechazo atómico, permisos y limpieza.
- Badge, identidad de presentación y confirmación de salida.
- Backend: 33 comprobaciones de aislamiento con un espía que prohíbe cualquier SQL.
- Browser: pantallas existentes, pagos demo, WhatsApp, resolución, reportes, desktop/móvil, recarga y cartera propia con pago temporal. Se comprueba **cero solicitudes `/api` durante la simulación**.

## 10. Regresión existente

- Backend `npm test`: **313 aprobadas**, incluidas finanzas, autenticación, permisos, importación, parser, cobranza, conciliación y WhatsApp.
- Frontend `npm test -- --maxWorkers=2`: **198 aprobadas** en 26 archivos, incluyendo las nuevas. Una ejecución inicial paralela tuvo un timeout de una prueba de Dashboard; las ejecuciones con dos workers aprobaron sin modificar esa prueba.

Las pruebas que necesitan MySQL crean esquemas de prueba independientes, según sus fixtures existentes; no insertan fixtures en la base operativa configurada.

## 11. Lint

`frontend npm run lint`: aprobado.

## 12. Build y E2E

`frontend npm run build`: aprobado. Vite advierte chunks mayores de 500 kB: aplicación principal y ExcelJS. ExcelJS se carga dinámicamente al analizar un archivo; no se carga al entrar al modo normal.

`frontend npm run test:e2e -- --workers=2`: **71 aprobadas**, incluidas las cinco pruebas nuevas de simulación y la regresión del modo normal.

## 13. Datos reales

Comparación de lectura, antes y después, de cantidad de registros y SHA-256 del contenido ordenado en 15 tablas operativas: **coincidencia completa**. Tablas verificadas: companies, customers, invoices, payments, payment_allocations, collection_actions, payment_promises, audit_logs, messages, message_templates, settings, users, import_batches, import_errors y mertel_customer_resolution_rows.

No se ejecutaron migraciones ni escrituras en la base operativa como parte de esta implementación. No se modificaron saldos, pagos, asignaciones, auditoría o empresas reales. La migración inicial conserva el hash registrado al iniciar este trabajo.

## 14. Límites

- Sin persistencia o recuperación de una sesión de cartera: recargar elimina deliberadamente los datos.
- Formato MERTEL y límite 2 MiB; no hay mapeador de columnas arbitrarias.
- No aplica devoluciones/notas débito ni infiere bases comerciales de descuento.
- No integra proveedores ni credenciales reales.
- Nuevas rutas futuras requieren implementar un contrato local; se bloquearán hasta entonces.
- No crea cuentas reales ni permite gestionar contraseñas en demo.
- Sin commit, push, staging ni `git add .`.
