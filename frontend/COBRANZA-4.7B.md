# FASE 4.7B — FRONTEND COBRANZA MERTEL

## Estado y alcance

Implementada `/cobranza` sobre el React existente, dentro de MainLayout. Consulta exclusivamente: no cambia facturas, pagos, reglas, etapas, prioridades ni balances. No incluye mensajería, gestiones, promesas o automatización.

## Archivos

- Modificados: `src/App.jsx`, `src/pages/Cobranza/Cobranza.jsx`.
- Creados: `src/pages/Cobranza/Cobranza.css`, `src/pages/Cobranza/collection.presentation.js`, `src/services/collection.service.js`.
- Pruebas: `test/collection.fixture.js`, `test/collection.test.jsx`, `test/collection.service.test.js`, `test/e2e/collection.spec.js`.
- Documentación: este archivo.

## Componentes y diseño

Cobranza aplica el permiso existente y CollectionView realiza la consulta. State, StageBadge, DetailValue y CustomerDetail presentan estados, etapas y detalle de consulta. Se reutilizan las clases de Cartera para cards, tablas, filtros, botones y modal; MainLayout conserva sidebar y header. El modal permite Escape, captura Tab y devuelve el foco al control que lo abrió.

## Servicio y contrato real de 4.7A

El servicio y los componentes consumen el contrato real de `backend/src/services/collection.service.js` y `backend/src/controllers/collection.controller.js`, sin modificar esos archivos. El servicio únicamente extrae `data` del sobre HTTP y valida la estructura; conserva todos los campos y decisiones del servidor.

Solicitud: `GET /api/collection?reference_date=YYYY-MM-DD`, mediante el cliente Axios autenticado existente. Respuesta: `{ success: true, data: { reference_date, status, rules_configured, summary, customers } }`.

- `summary.stages[stage].customers`: contadores por etapa principal de cliente.
- `customers[]`: `customer`, `stage`, `priority`, `reason`, `total_balance`, `eligible_balance`, `main_invoice`, `invoices`.
- `main_invoice`: clasificación cuya propiedad `invoice` contiene la factura seleccionada por el motor.
- `invoices[]`: `invoice`, `stage`, `priority`, `reason`, `eligible`, `stage_candidates`; incluye facturas pendientes no elegibles para distinguir ambos saldos.
- `customer.id`: identidad única. Respuestas duplicadas o incompatibles muestran error, sin seleccionar otra factura o combinar decisiones del motor.
- Los componentes utilizan directamente `customer.id`, `main_invoice.invoice`, `invoices`, `rules_configured`, `reference_date`, `status` y `summary`, sin contratos ni aliases alternativos.
- Los montos no se suman ni se recalculan en React. Datos ausentes se presentan como «—».
- `rules_configured: false`: estado específico sin reglas, sin tarjetas de cero clientes.

El backend actual no devuelve etiquetas comerciales. La capa de presentación traduce las claves conceptuales conocidas (`prompt_payment`, `days_before_due`, `due_today`, `overdue`) y conserva claves adicionales del servidor como filtros y tarjetas. No presume cuántos días ni descuentos, ni espera campos hipotéticos de etiquetas.

## Funcionalidades y contadores

Un cliente aparece una sola vez con nombre, NIT, etapa principal, saldo total, factura principal, vencimiento y cantidad de facturas pendientes. El detalle añade teléfono, saldo elegible, prioridad, motivo y clasificación de cada factura, incluida su prioridad, elegibilidad explícita y candidatos de etapa recibidos.

La búsqueda controlada es local por nombre (sin distinguir acentos), NIT o número de cualquier factura del cliente. El endpoint actual soporta filtros `customer_id` y `stage`, pero no búsqueda: esta pantalla carga el conjunto de la fecha una vez y aplica búsqueda y etapa localmente. No hay llamadas por tecla. Los contadores vienen del resumen del backend y permanecen independientes de búsqueda y filtros; la tabla muestra cuántos clientes del total coinciden. Para un volumen elevado quedaría pendiente paginación/búsqueda del servidor.

La fecha se construye con componentes de calendario locales y se envía intacta. Cambiarla invalida los datos anteriores, cancela la solicitud anterior y recarga resumen, clientes y detalle abierto, si ese cliente sigue presente. Una fecha vacía no genera solicitudes.

## Estados, responsive y permisos

Carga con spinner del proyecto; error seguro y reintento; vacío de fecha; vacío por filtros; falta de reglas; endpoint ausente; contrato incompatible; 403 sin datos del cliente. Los errores internos no se muestran ni se imprimen respuestas sensibles.

Se exige `collection.view` del AuthProvider existente antes de montar la consulta. El backend 4.7A aplica su permiso y companyScope; la UI no sustituye esa autorización. Una cuenta global sin empresa recibe un mensaje específico: usar una cuenta asignada a MERTEL. No se inventa un company_id ni se añade un selector multiempresa.

En desktop se usa tabla; hasta 760px se apilan las celdas con sus etiquetas. Las cards, filtros y detalle se ajustan a móvil; el modal mantiene altura limitada y desplazamiento interior.

## Verificación

- `npm test`: 51 pruebas aprobadas, incluidas 26 de cobranza y las existentes de login/API.
- `npm run lint`: aprobado.
- `npm run build`: aprobado.
- `npm run test:e2e`: 12 pruebas aprobadas, incluidas 6 de cobranza y 6 existentes de login.
- Responsive en navegador: desktop 1440px, laptop 1024px, tablet 768px, móvil 390px y 320px; sin desbordamiento del documento; modal dentro del viewport y cierre con recuperación del foco.
- Las fixtures sintéticas se utilizan exclusivamente en pruebas. La aplicación consume el servicio real.

## Git e integración

La orden definitiva autoriza staging selectivo, commit y push de 4.7A + 4.7B, con la modificación preexistente de database/migrations/001_initial_schema.sql excluida e intacta. Las correcciones de configuración local y sus pruebas forman parte del cierre autorizado. Consultar VALIDACION-4.7.md para el inventario completo y la evidencia técnica.

La vista consume el contrato real local. La única validación no disponible es la consulta autenticada contra datos reales de MERTEL: la base configurada no tiene compañías ni reglas, y no se creó información sintética para aparentarla. La última orden permite el cierre técnico bajo esa salvedad. La publicación y los hashes se verifican en el reporte final del chat.
