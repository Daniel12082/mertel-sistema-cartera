# FASE 5.1A — Administrador de plantillas WhatsApp MERTEL

Fecha: 05/10/2026. Producto exclusivo: MERTEL Importaciones. Se reutiliza `message_templates` y el contrato de preparación de Fase 5.1. Sin tablas nuevas, migraciones, envío de WhatsApp ni funcionalidades SaaS.

## Resultado

El menú de administración ofrece **Plantillas WhatsApp** a usuarios con el nuevo permiso `message_templates.manage`. Permite consultar, buscar, filtrar, crear, editar, activar y desactivar plantillas. Muestra canal, etapa, estado y fecha de actualización. Las plantillas inactivas permanecen almacenadas y fuera del selector del cobrador. Las plantillas de otros canales no entran en esta pantalla.

El editor ofrece el catálogo backend de variables, inserta el token exacto en el cursor y muestra una vista previa con ejemplos simulados. La vista los identifica como ficticios y no los guarda. La representación es texto escapado y no evalúa código. Los errores, vacíos, carga y guardado tienen estados visibles; la presentación responde a escritorio y anchos de 390 y 320 píxeles.

## Esquema y endpoints

El esquema existente soporta `company_id`, `name`, `channel`, `content`, `stage` nullable, `status`, `created_by`, `created_at` y `updated_at`. No requiere migración. El backend limita el canal administrado a `whatsapp`, valida longitud/contenido/variables/etapa y actualiza solo filas dentro del scope autenticado. El body no admite `company_id`, actor, estado de otra operación ni campos no reconocidos.

Todas las rutas de administración usan JWT, `companyScope`, `collection.view` y `message_templates.manage`. El permiso nuevo se concede al rol `admin`; `supervisor` y `collector` no lo reciben. El permiso previo `collection.manage` sigue habilitando las gestiones/promesas y la preparación de mensajes manual, sin otorgar administración de plantillas. Para un administrador global, `companyScope` exige una empresa explícita y la lista disponible procede del endpoint administrativo existente.

| Método | Endpoint | Función |
|---|---|---|
| GET | `/api/collection/message-templates` | Lista plantillas WhatsApp de la empresa, etapas activas y catálogo backend de variables. |
| POST | `/api/collection/message-templates` | Crea plantilla WhatsApp con etapa opcional y estado inicial. |
| PUT | `/api/collection/message-templates/:id` | Edita nombre, canal, contenido y etapa dentro de la empresa. |
| POST | `/api/collection/message-templates/:id/activate` | Activa la plantilla dentro del scope. |
| POST | `/api/collection/message-templates/:id/deactivate` | Desactiva la plantilla sin borrarla. |

La gestión no altera las rutas ya usadas por Cobranza: `GET /api/collection/customers/:customerId/message-templates?reference_date=...`, `POST .../messages/preview` y `POST .../messages/prepare`. La consulta normal del cobrador revalida empresa/canal/etapa y solo ofrece plantillas activas.

## Variables permitidas

El catálogo se define una sola vez en `backend/src/utils/messageTemplate.js`. El administrador lo obtiene por API y usa sus mismas entradas para insertar tokens, validar y presentar valores de ejemplo. El reemplazo continúa siendo literal y no recursivo.

| Variable | Fuente disponible en backend |
|---|---|
| `{{nombre_cliente}}` | `customers.name` |
| `{{identificacion_cliente}}` | `customers.nit` |
| `{{telefono_cliente}}` | `customers.phone`, sin normalización |
| `{{numero_factura}}` | Factura principal `main_invoice.invoice_number` seleccionada por el backend |
| `{{fecha_factura}}` | `main_invoice.issue_date` |
| `{{fecha_vencimiento}}` | `main_invoice.due_date` |
| `{{valor_factura}}` | `main_invoice.document_value` |
| `{{saldo_pendiente}}` | Saldo total pendiente del cliente, sin descuento |
| `{{dias_mora}}` | Diferencia de calendario entre vencimiento y referencia, truncada a cero antes del vencimiento |
| `{{dias_para_vencimiento}}` | Días positivos hasta vencimiento; cero para una factura vencida |
| `{{etapa_cobranza}}` | Etiqueta de etapa producida por reglas backend |
| `{{motivo_cobranza}}` | Motivo calculado por el motor backend |

Se conservan por compatibilidad las variables de Fase 5.1 `{{cliente}}`, `{{factura}}` y `{{saldo}}`; `{{fecha_vencimiento}}` y `{{dias_mora}}` conservan el mismo nombre y comportamiento previo. Los valores de factura que no existan en el contexto se dejan sin resolver y bloquean la preparación.

Estas variables solicitadas no aparecen en el catálogo porque 5.1 no provee aún una fuente de mensaje estable para ellas: `{{porcentaje_pronto_pago}}`, `{{fecha_limite_pronto_pago}}`, `{{valor_descuento_pronto_pago}}` y `{{porcentaje_descuento_condicionado}}`. Aunque existen reglas/evaluaciones de beneficios, su elegibilidad por producto, tratamiento financiero o coexistencia no es un valor de mensaje confirmado para todas las facturas; la base del 10% continúa pendiente. No se inventan cálculos ni textos para suplir esos datos.

## Pruebas y base configurada

- Backend completo: **221/221**, sin fallos ni omisiones. Incluye HTTP/MySQL en esquema desechable: permisos, scope A/B, administrador global, validaciones, CRUD, estado, y exclusión de plantillas inactivas en Cobranza. Prueba la resolución de variables nuevas y antiguas.
- Frontend: **102/102** en 11 archivos de prueba.
- E2E Playwright: **29/29** Chromium, incluye alta, vista previa, activación, acceso denegado al cobrador, error seguro y responsive a 1440, 390 y 320 px.
- Lint: aprobado. Build de producción con `VITE_API_URL=https://api.mertelimportaciones.com`: aprobado.
- La inspección de solo lectura de la base configurada encontró **0 empresas y 0 plantillas**. No se insertaron datos en ella; todos los fixtures de integración usaron esquemas temporales desechables.

No se llama a WhatsApp, no se crea una fila en `messages` al previsualizar/administrar y no se presenta estado de entrega. No se construye SaaS, no se cambia ninguna regla financiera/comercial y no se modifica `database/migrations/001_initial_schema.sql`; esa migración local preexistente permanece fuera del trabajo.
