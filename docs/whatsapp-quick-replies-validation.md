# MERTEL — Respuestas rápidas en Conversaciones

## Implementación

El compositor reconoce `/` al inicio del texto o después de un espacio, en la posición del cursor. No reconoce barras dentro de palabras ni URLs. Filtra por comando o nombre, permite flechas, Enter, Escape y selección con mouse. Enter solo selecciona una opción mientras hay resultados; no envía el formulario.

El catálogo se consulta mediante `getCollectionMessageTemplates`, con la fecha de Bogotá y el cliente seleccionado. Solo usa las plantillas autorizadas que devuelve el servicio existente. El comando se deriva de la primera palabra del nombre, omitiendo el prefijo MERTEL; las colisiones incluyen el ID existente. Los comandos se calculan en memoria y no se guardan en otro catálogo.

La selección solicita `/admin/whatsapp/preview`, igual que `WhatsAppManualSend`. Inserta el contenido renderizado en el cursor, conservando el texto anterior y posterior. El cliente y la plantilla de la respuesta se verifican antes de insertarla. Cambiar el borrador o la conversación descarta las respuestas pendientes. No se envía nada al seleccionar.

El menú usa un portal con posición fija, evita los contenedores con `overflow: hidden` y ajusta su posición al viewport, al scroll y al teclado móvil mediante `visualViewport`.

Las variables pendientes, no soportadas o malformadas se muestran y bloquean el envío. No se inventan datos ni se recalculan valores financieros.

En SIMULACIÓN, el borrador puede editarse y enviarse usando `sendConversationSimulation`, con el mismo adaptador y datos locales existentes; no hay HTTP ni escrituras en la base de datos real. Fuera de simulación se usa `sendManualWhatsApp`, con cliente, plantilla, conexión MOCK y las validaciones existentes del servidor.

**Límite del flujo actual:** el servidor manual solo admite el contenido renderizado de una plantilla y comprueba que siga correspondiendo al contexto del cliente antes de despachar. El compositor permite editar, pero fuera de simulación bloquea el envío de un texto distinto y explica que debe reinsertarse la plantilla. Se evita ignorar silenciosamente una edición o eludir esa validación. No se modificó el contrato del backend ni se añadió Meta.

## Archivos de esta implementación

Modificados:

- `frontend/src/pages/Administracion/WhatsAppConversations.jsx`: integra el compositor y conserva el botón de envío; valida el borrador y reutiliza el envío manual.
- `frontend/src/pages/Administracion/WhatsAppCenter.jsx`: pasa la configuración existente del canal a Conversaciones.
- `frontend/test/whatsappConversations.test.jsx`: completa la respuesta del catálogo en el fixture de recuperación REAL.
- `frontend/test/e2e/whatsappConversations.spec.js`: comprueba menú, teclado, inserción y posición en cinco tamaños.
- `frontend/test/e2e/whatsappCenter.integration.spec.js`: comprueba plantillas y ediciones bloqueadas contra Express/MySQL aislado, con checksums sin cambios.

Añadidos:

- `frontend/src/pages/Administracion/WhatsAppQuickReplies.jsx`: búsqueda, menú y preparación del contenido con los servicios existentes.
- `frontend/src/pages/Administracion/WhatsAppQuickReplies.css`: presentación del menú flotante y ajuste del compositor.
- `frontend/src/pages/Administracion/whatsappQuickReplies.commands.js`: comandos derivados, detección del token y avisos de variables pendientes.
- `frontend/test/whatsappQuickReplies.test.jsx`: ocho pruebas de comandos, navegación, inserción, datos, aislamiento local, REAL y respuestas tardías.
- `docs/whatsapp-quick-replies-validation.md`: este informe.

Se conservaron los cambios locales previos. Esta tarea no modificó servicios, adaptador, dataset, backend, tablas, endpoints, pagos, cartera, conciliación, reglas ni automatizaciones. No se realizó staging, commit ni push.

## Validación

- Frontend: `npm test -- --maxWorkers=2`, 246 pruebas.
- Lint: `npm run lint`, sin errores.
- Build: `npm run build`, correcto; conserva el aviso previo de chunks mayores de 500 kB.
- Navegador: 18 pruebas con un worker, incluyendo regresión de simulación, integración Express/MySQL aislada y tamaños 390, 768, 1024, 1366 y 1920 px. Capturas del menú en `tmp/whatsapp-quick-replies-{ancho}.png`; inspección visual móvil realizada.
- Backend: `npm run test:whatsapp`, 46 pruebas correctas al repetir. La primera ejecución obtuvo 45/46: la prueba preexistente de concurrencia asume que la segunda llamada es la duplicada (`sent[1].duplicate`), aunque el orden de adquisición del bloqueo no está garantizado. No se modificó esa prueba ni el código de automatización.
- Diff: `git diff --check` correcto; revisión de los archivos de esta tarea, incluyendo los archivos nuevos que Git aún considera untracked.
