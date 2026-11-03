# WhatsApp MERTEL: envío manual y validación

Fecha: 8 de octubre de 2026.

## Resultado

El Centro de WhatsApp abre en **Envío manual**: seleccionar cliente → seleccionar plantilla → revisar vista previa → pulsar **Enviar mensaje por WhatsApp** → ver el resultado. Ya no se exige preparar ni guardar en cola como pasos de la interfaz. La cola existente sigue siendo el almacenamiento del canal; no se creó una arquitectura paralela.

La vista previa se genera al seleccionar ambos datos y puede actualizarse con **Vista previa**. Se muestran cliente, teléfono, catálogo activo autorizado y mensaje con variables. No se crean plantillas operativas. Hay estados vacíos, carga, errores recuperables, bloqueo por teléfono/contexto incompleto, bloqueo de doble clic, cancelación de previews anteriores y foco visible.

La pestaña **Mensajes** conserva la cola e historial existentes. **Automatización de mensajes** muestra **Configuración automática**, horarios, días, intervalos, límites, plantillas por las cuatro etapas y estados. Todos los controles futuros están deshabilitados y marcados **Próximamente**. No hay botones de activación ni generación automática en este centro.

## Causa del error de id

El backend `enqueueWhatsApp` devuelve `{ message, duplicate }`. El adaptador de simulación devolvía directamente la fila del mensaje. `CollectionMessages.queue` lee `result.message.id`: en simulación `result.message` era `undefined`, produciendo exactamente `Cannot read properties of undefined (reading 'id')`.

Se corrigió el contrato local de `/queue` y `/whatsapp/customers/:id/queue` a `{ message, duplicate }`, y el de `/mock-send` a `{ message, simulated }`, igual que el backend. El servicio valida la presencia del mensaje y su ID antes de continuar. La prueba de regresión usa el adaptador real de simulación, sin simular esta respuesta con un mock.

También se encontraron riesgos adicionales: fallback `data.templates[0].id` con catálogo vacío; identificación de factura principal usando `.id` aunque el motor prioriza `invoice_id`; contexto simulado que inventaba valores faltantes y siempre declaraba `can_prepare: true`. Se eliminaron esos comportamientos. La vista usa el identificador canónico del motor y valida que exista la factura clasificada correspondiente. Cliente y plantilla se resuelven por su ID real; el selector inicia vacío. La vista previa valida que los IDs de la respuesta coincidan con la selección. No se ocultó el desajuste con optional chaining.

El fallo de cola está demostrado por los contratos y la lectura del componente. No se afirma que ese mismo fallo ocurriera al cambiar el selector: ese recorrido se cubrió aparte con pruebas de selección y preview.

## Servicios y límites preservados

Se reutilizan `/admin/whatsapp/preview`, `/queue` y `/messages/:id/mock-send`, así como modelos, permisos, auditoría y proveedor MOCK existentes. No se añadieron endpoints, tablas, persistencia de configuración futura ni workers.

Fuera de Modo Simulación el único proveedor disponible sigue siendo MOCK. El envío manual conserva conexión validada, reglas MANUAL existentes, horarios, límites, idempotencia y revalidación del contexto. Una respuesta `PENDING` o `FAILED` se informa como pendiente o fallo, nunca como enviada. Un duplicado que ya fue enviado no se despacha otra vez. Si el canal no tiene una regla manual compatible, el backend lo rechaza de forma controlada; esta fase no crea reglas automáticamente ni cambia el motor.

En Modo Simulación las mismas llamadas usan el adaptador local de `api.js`. El flujo modifica exclusivamente mensajes/eventos en memoria y no instancia ni llama al proveedor del backend. La confirmación es: **Mensaje simulado enviado correctamente. No se realizó ningún envío real.** La aclaración de simulación se muestra fuera del contenido del mensaje. El catálogo DEMO ya existente usa las variables del catálogo compartido del sistema; no se insertó en la base operativa.

No se modificaron archivos del backend, reglas de cobranza, permisos ni lógica financiera por este trabajo. Los cambios locales previos se preservaron. No se hizo commit, push, reset, checkout destructivo ni `git add .`.

## Validaciones

| Prueba requerida | Resultado |
|---|---|
| Seleccionar cliente | Aprobada: nombre, NIT y teléfono del cliente autorizado |
| Seleccionar plantilla | Aprobada: ID del catálogo real, selección inicial vacía |
| Vista previa | Aprobada: automática y botón explícito; desktop y móvil |
| Variables | Aprobada: cliente, factura FV-DEMO-001 y saldo $1.800.000; faltantes/desconocidas bloquean envío |
| Envío manual en simulación | Aprobada: un clic produce SENT local y confirmación clara; doble clic no duplica |
| Ausencia de envío real | Aprobada: cero llamadas al adaptador de red en pruebas de simulación y cero solicitudes de API tras activar simulación en navegador |
| Datos financieros intactos | Aprobada: igualdad completa de facturas, pagos, asignaciones, clientes y reglas locales; CHECKSUM MySQL de invoices/payments/payment_allocations sin cambios en esquema aislado |
| Error undefined.id | Aprobada: respuesta de cola compatible y validación previa de IDs; sin pageerror en los recorridos de navegador |
| Plantilla inexistente/selección vacía | Aprobada: mensaje controlado, botón deshabilitado; catálogo vacío no lee templates[0].id |
| Cliente sin teléfono | Aprobada: aviso y botón deshabilitado |
| Error de backend | Aprobada: error recuperable, botón Reintentar, sin mostrar excepciones JavaScript |
| Responsive | Aprobada: 1440 y 390 px, sin desbordamiento horizontal; capturas inspeccionadas |
| Automatización futura | Aprobada: controles deshabilitados; ningún request de activación desde esa sección |
| Duplicados, respuesta malformada y programación | Aprobada: duplicado SENT no se reenvía; respuesta sin mensaje no despacha; PENDING no se anuncia enviado |

Comandos: `npm test -- --maxWorkers=4`, `npm run lint`, `npm run build` en frontend; `npm run test:whatsapp` en backend; Playwright con `simulation.spec.js` y `whatsappCenter.integration.spec.js`; `git diff --check`.

Resultados finales: 224 pruebas frontend; 16 pruebas backend WhatsApp; 7 E2E aprobadas, sin omitidas. Lint, build y diff check aprobados. El build conserva el aviso de chunks mayores de 500 kB.

La primera corrida general con 29 workers tuvo dos timeouts por carga y dos expectativas antiguas de la pestaña inicial. Se actualizaron las expectativas para entrar a Conexión y la suite completa pasó con cuatro workers. En navegador se corrigieron etiquetas explícitas de selectores, espera de fuentes para medir el layout y uso de la sesión existente para configurar fixtures en el esquema aislado.

## Archivos editados o creados en este trabajo

- `frontend/src/pages/Administracion/WhatsAppCenter.jsx`
- `frontend/src/pages/Administracion/WhatsAppCenter.css`
- `frontend/src/pages/Administracion/WhatsAppManualSend.jsx` (nuevo)
- `frontend/src/pages/Administracion/WhatsAppAutomationPreview.jsx` (nuevo)
- `frontend/src/services/whatsappCenter.service.js`
- `frontend/src/simulation/adapter.js`
- `frontend/src/simulation/dataset.js`
- `frontend/src/simulation/views.js`
- `frontend/test/whatsappCenter.test.jsx`
- `frontend/test/whatsappManualSend.test.jsx` (nuevo)
- `frontend/test/simulation.test.js`
- `frontend/test/settingsCenter.test.jsx`
- `frontend/test/e2e/simulation.spec.js`
- `frontend/test/e2e/whatsappCenter.integration.spec.js`
- `docs/whatsapp-manual-validation.md` (nuevo)
- `docs/whatsapp-center.md` (nota del nuevo flujo)

Capturas: `tmp/whatsapp-manual-desktop.png` y `tmp/whatsapp-manual-mobile.png`.

**No se implementó ni activó el envío automático. Modo Simulación no toca la base operativa ni envía WhatsApp real.**
