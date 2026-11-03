# MERTEL — Editor visual de plantillas WhatsApp

## Cambios

El editor se organiza en Información de la plantilla, Editor del mensaje y Vista previa. Nombre y descripción tienen etiquetas vinculadas a sus campos y espacio propio; inputs y selects comparten ancho, altura mínima de 46 px y estilos específicos. El textarea tiene un área mínima de 190 px, con herramientas de adjuntos debajo.

En escritorio amplio se muestran el editor y la vista previa en dos columnas. En tablet y móvil se apilan; en móvil los campos y acciones ocupan todo el ancho. Las variables existentes se presentan en una cuadrícula con scroll, manteniendo sus botones de inserción, nombres y catálogo.

La vista previa usa una burbuja de chat con el renderizado de ejemplos ya existente, claramente identificado como ficticio. El adjunto se muestra dentro de esa burbuja, con imagen, reproductor de video o audio y los metadatos existentes. La barra del compositor conserva el clip, reemplazo, retirada y límites provisionales. El clip se habilita al seleccionar un tipo multimedia y abre el selector con su lista MIME existente.

Los estilos añadidos están bajo `.template-whatsapp-editor`; no se añadieron reglas globales ni se modificó `WhatsAppMedia.css`, Conversaciones, los servicios de multimedia o el adaptador. El selector compartido tiene una opción `showPreview`, activada por defecto. Solo el editor la desactiva para trasladar la previsualización a la burbuja; el chat conserva su presentación anterior.

## Comportamiento conservado

- Creación, edición, cancelación y guardado de plantillas de texto con los contratos existentes.
- Multimedia temporal en memoria y aislamiento de simulación; ninguna solicitud HTTP durante la preparación local.
- Variables, comandos `/`, validaciones MIME, errores de lectura y límites anteriores.
- Guardado REAL de multimedia bloqueado antes de HTTP, conservando el borrador.
- Ningún envío desde este editor, integración Meta o almacenamiento persistente.
- Sin cambios en backend, finanzas, reglas comerciales, roles, empresas o automatizaciones.

## Archivos

Modificados:

- `frontend/src/pages/Administracion/MessageTemplates.jsx`
- `frontend/src/pages/Administracion/MessageTemplates.css`
- `frontend/src/pages/Administracion/WhatsAppMedia.jsx`

Añadidos:

- `frontend/test/e2e/whatsappTemplateEditor.spec.js`
- `docs/whatsapp-template-editor-validation.md`

Se conservaron copias de los tres archivos anteriores en `tmp/whatsapp-template-editor-baseline`, junto con el estado Git inicial y hashes de los módulos que debían permanecer intactos. Los hashes de `whatsappMedia.service.js`, `simulation/adapter.js`, `WhatsAppConversations.jsx` y `WhatsAppMedia.css` permanecen iguales. Se revisó el diff relativo a esas copias para conservar el trabajo local preexistente. No se realizó staging, commit ni push.

## Pruebas ejecutadas

- Vitest: `messageTemplatesAdmin.test.jsx` y `whatsappMedia.test.jsx`, **16 pruebas aprobadas**. Cubren creación/edición, variables, permisos, cada tipo multimedia, retirada/reemplazo, errores y bloqueo REAL.
- Playwright: `whatsappTemplateEditor.spec.js`, **5 pruebas aprobadas**, una para cada ancho: **390, 768, 1024, 1366 y 1920 px**. Verifican separación geométrica de descripción/label, tamaño y alineación de campos, clip real mediante `filechooser`, filtros MIME para imagen/video/audio, previsualización, retirada/reemplazo, guardado, edición y cancelación, renderizado de variables y ausencia de overflow horizontal. Ninguna solicitud HTTP después de activar simulación.
- Regresión Playwright: `messageTemplatesAdmin.spec.js`, `whatsappMedia.spec.js`, `whatsappConversations.spec.js`, `whatsappCenter.integration.spec.js` y `simulation.spec.js`, **26 pruebas aprobadas**. Incluyen la página independiente de plantillas, envío de texto con Express/MySQL aislado y MOCK, chat manual, respuestas rápidas, multimedia y otros formularios de simulación.
- `npm run lint`: sin errores ni avisos.
- `npm run build`: correcto; continúa el aviso previo de chunks mayores de 500 kB.
- `git diff --check`: correcto.

Capturas en `tmp/whatsapp-template-editor-{ancho}.png`. Se inspeccionaron visualmente móvil y escritorio. Las pruebas de automatizaciones preexistentes utilizan sus fixtures aislados; esta tarea no activa automatizaciones de la aplicación.
