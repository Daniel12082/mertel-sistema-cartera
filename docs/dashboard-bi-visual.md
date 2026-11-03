# Dashboard principal MERTEL — diseño BI

## Alcance y criterio visual

Se rediseña la portada `/`, conservando la navegación y autenticación existentes. Se usa la composición de la referencia (KPIs, paneles analíticos, gráficos y rankings), con fondo gris claro, superficies blancas, azul oscuro y rojo MERTEL. No se copia la marca, contenido, paleta ni datos de la imagen. No se añaden pantallas administrativas, empresas, roles ni reglas comerciales.

Referencias de criterio: [Frontend Design de Anthropic](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md) y [Web Interface Guidelines de Vercel](https://github.com/vercel-labs/web-interface-guidelines). Se aplican jerarquía deliberada, alineación, cifras tabulares, foco visible, estados completos, targets táctiles y reducción de movimiento.

La portada tiene seis KPIs en escritorio, filas 60/40 y 50/50, rankings y actividad. Tablet adapta los KPIs y paneles; móvil usa una columna y transforma la tabla de ranking en fichas con etiquetas. No se requieren scroll horizontal del documento ni nuevas páginas.

## Dependencias

- `recharts@3.10.1`: única biblioteca de gráficos, para donut, barras y línea. Se carga mediante importación dinámica, separada del bundle inicial.
- `react-is@19.3.0`: peer de Recharts, alineado con React 19.3.0 ya instalado. Sustituye la versión transitiva 17.0.2 anterior.

Se revisaron package.json y package-lock.json antes de instalar. React 19.3.0, Vite 8.3.1 y todas las dependencias existentes ajenas conservan su versión. No se instala Tremor, una segunda biblioteca de gráficos ni otro framework de estilos.

Se evaluó shadcn/ui. El proyecto utiliza CSS propio y no tiene Tailwind ni componentes Radix/Base UI. Para no convertir este rediseño en una migración del frontend, se mantiene el stack visual existente con cinco primitivas nativas reutilizables: Panel, StatCard, Badge, EmptyState y DashboardSkeleton.

## Pantallas y componentes

Dashboard es la única pantalla con una composición completa nueva. Los tokens de borde/sombra, foco de teclado, cifras tabulares y ajustes táctiles se comparten con el resto del frontend por index.css. Las otras pantallas no cambian sus componentes, flujos ni contratos. El menú móvil conserva los mismos enlaces y permisos, en una fila desplazable; solo cambia su presentación para evitar que el grupo administrativo lo haga excesivamente alto.

Los dos archivos aprobados de Historial se preservan byte por byte. No hay dependencia que obligue a modificarlos.

## API y fuentes

Una llamada: `GET /api/admin/dashboard?period=month`, usando el wrapper existente. Permisos: settings.manage para métricas globales; autenticación y requireCompanyScope permanecen. No se crea otro endpoint, motor de clasificación, catálogo comercial ni fuente financiera.

Las ampliaciones son aditivas: `summary.unclassified_balance`, `top_customers[].invoices_count`, `activity_trend` y el estado disponible de los eventos recientes. No cambian nombres, parámetros ni significado de los campos previos. Las consultas participan en START TRANSACTION READ ONLY y mantienen una cantidad fija de consultas, sin consultas por cliente.

| Sección | Información visible | Fuente |
|---|---|---|
| KPIs | Clientes con cartera, facturas pendientes, documentos vencidos, saldo total por cobrar, valor facturado, mensajes enviados del mes | overview existente, invoices/document_value/balance, motor y messages.sent_at saliente |
| Estado de cartera | Pronto pago, Faltan 5 días, Vence hoy, En mora; clientes, documentos, saldo y participación | readCompanyCollection y catálogo/clasificación vigente |
| Distribución | Donut: saldo por etapa, porcentaje y leyenda | Balances del backend; denominador total_balance |
| Saldo por etapa | Barras en COP | Saldos clasificados por el motor |
| Análisis de clientes | Total, con saldo, por resolver y barras de clientes por etapa | overview, resumen de resolución existente y motor |
| Mayor cartera | Hasta diez clientes, NIT, saldo, facturas, etapa y prioridad | Consulta financiera agregada existente, con COUNT de facturas; metadatos del motor |
| Prioritarios | Cliente, etapa, documento principal, vencimiento y saldo | Orden exacto ya producido por el motor; no se reordena en frontend |
| Actividad de cobranza | Clientes gestionados, gestiones, promesas pendientes/cumplidas, pagos e importe registrado | collection_actions, payment_promises y payments confirmados |
| Pagos | Confirmados del mes y su valor, reportes pendientes actuales y valor informado | recovery y reported_payments existentes |
| Tendencia | Conteos diarios de gestiones, pagos registrados y promesas creadas | Consulta agregada de las tres fuentes existentes, en el mismo período y Bogotá |
| Actividad reciente | Hasta veinte eventos, tipo, cliente, fecha/hora, actor y estado cuando consta | audit_logs existente, proyectando campos explícitos |

El valor facturado disponible incluye documentos persistentes saldados de clientes activos; no incluye Excel temporal. Los pagos/gestiones son actividad del mes; cartera y pendientes son estado actual. La fecha de referencia procede del backend y se entrega explícitamente al motor. No hay porcentajes de crecimiento ni atribución comercial de recuperación a cobradores.

Si hay saldo persistente fuera de las cuatro etapas, el donut presenta “Fuera de etapas”. El importe lo calcula el backend con centavos BigInt, a partir del total financiero y los saldos clasificados, sin alterar balances. Es una categoría de presentación para conciliar la gráfica, no una etapa comercial nueva.

El frontend convierte importes a números solo para geometría/porcentajes de gráficos. Nunca reconstruye balances financieros. Los valores monetarios visibles provienen del backend.

## Histórico y datos vacíos

La tendencia usa action_date para gestiones y created_at para payments/promesas, con límites del período en UTC y agrupación por Bogotá. Solo devuelve fechas con registros; no inventa días ni observaciones. Con menos de dos fechas no muestra una línea y explica que falta histórico suficiente.

Con cartera vacía, los KPIs muestran ceros reales con contexto, el donut y barras muestran estados vacíos, y rankings/actividad explican la ausencia de registros. No hay datos de demostración en la base operativa. Las fixtures utilizadas en tests son bases aisladas eliminadas al finalizar.

Errores parciales se indican en el panel afectado y ofrecen Reintentar. No se convierten en cero. Loading conserva la composición mediante skeletons. El botón Actualizar vuelve a consultar el backend; no altera cifras localmente.

## Accesibilidad y rendimiento

- Gráficas con nombres accesibles, tablas de datos equivalentes y leyendas escritas.
- Estados comunicados por texto/badge además de color.
- Foco visible comprobado por teclado y targets táctiles de 44 px.
- Se respetan zoom y prefers-reduced-motion; gráficos sin animación automática.
- Charts con contenedores de altura explícita, sin dimensiones cero ni errores de consola del Dashboard.
- Importación dinámica de DashboardCharts y bundle separado de Recharts.
- No se instalan librerías solapadas para tarjetas/estados.

## Archivos de esta fase

- backend/src/services/adminDashboard.service.js
- backend/test/adminDashboard.test.js
- backend/test/adminDashboard.unit.test.js
- frontend/package.json y frontend/package-lock.json
- frontend/src/index.css
- frontend/src/components/ui/dashboard-ui.jsx y dashboard-ui.css
- frontend/src/pages/Dashboard/Dashboard.jsx, Dashboard.css y DashboardCharts.jsx
- frontend/test/mainDashboard.test.jsx y dashboardCharts.test.jsx
- frontend/test/e2e/adminDashboard.integration.spec.js
- docs/dashboard-bi-visual.md

Los cambios previos de provisioning, package.json backend, migración 001, pruebas de resolución e Historial se preservan. La eliminación previa de frontend/COBRANZA-4.7B.md tampoco se revierte. No hay staging, commit ni push.

## Validación

Backend completo: 274 pruebas aprobadas. Frontend completo: 172 pruebas, 22 archivos. E2E completo: 64 pruebas. Lint, build y diff check aprobados. Responsive comprobado en 390, 768, 1024, 1366 y 1920 px, con gráficos visibles, foco de teclado y ausencia de desbordamiento del documento.

La E2E principal compara API real con registros MySQL persistidos en una base aislada, comprueba rankings, porcentajes, tendencia de dos fechas, tamaños de SVG, consola y snapshots financieros sin cambios. La apertura de login sin cookie genera el 401 esperado de refresh; la comprobación de consola del Dashboard empieza tras autenticación y no oculta errores de la pantalla.

Warnings: el bundle inicial sigue superando el aviso de 500 kB; Charts se entrega separado (~410 kB). npm audit reporta una vulnerabilidad alta preexistente de source-map-js 1.2.1, dependencia de desarrollo; no se ejecuta npm audit fix ni se actualiza tooling ajeno. También hay avisos de FORCE_COLOR/NO_COLOR y LF/CRLF.
