# MERTEL — Multimedia en plantillas y chat manual

Fecha: 14 de octubre de 2026.

## Alcance implementado

Las plantillas internas existentes admiten, en SIMULACIÓN, texto, imagen, video o audio, con texto opcional en los tres tipos multimedia. El editor permite adjuntar, reemplazar, previsualizar y retirar el archivo. El listado muestra su tipo y si tiene adjunto. No hay otro catálogo.

Conversaciones permite seleccionar un archivo del dispositivo, revisar nombre, MIME y tamaño, editar el texto y retirar o reemplazar el archivo antes de preparar el mensaje. Los borradores y adjuntos pertenecen a su conversación. Una lectura que termina después de cambiar de cliente se descarta. Seleccionar un archivo o una respuesta rápida nunca envía nada.

Los comandos `/` conservan su filtrado, colisiones y navegación. La selección multimedia usa la vista previa existente, con variables del cliente y sus facturas, e inserta texto y adjunto en el compositor. Las variables pendientes continúan bloqueando el envío. El panel de envío manual también previsualiza las plantillas multimedia.

La preparación de multimedia en SIMULACIÓN usa el mismo adaptador, catálogo e historial locales. El registro tiene `attachment`, `content_type` y `media_simulated`; el archivo no se almacena dentro del texto. Los mensajes multimedia se etiquetan «sin entrega real», incluso cuando el flujo local MOCK alcanza el estado SENT.

**Fuera de SIMULACIÓN:** se permite seleccionar y previsualizar un archivo temporal, pero guardar una plantilla multimedia o enviarlo se bloquea, conservando el borrador. El proveedor actual MOCK no transporta archivos y no hay almacenamiento seguro persistente configurado. Los servicios rechazan estas operaciones antes de HTTP. El envío manual de plantillas de texto conserva su contrato, proveedor, permisos y validaciones anteriores. La modificación de texto fuera de simulación conserva el límite ya existente del flujo manual validado.

## Inspección y decisión de almacenamiento

Se inspeccionaron Centro de WhatsApp, Conversaciones, MessageTemplates, comandos rápidos, WhatsAppManualSend, servicios frontend, adaptador/dataset/vistas de simulación, modelos `message_templates` y `messages`, servicios de plantillas y mensajes, auditoría y MockWhatsAppProvider.

El esquema actual solo tiene contenido de texto y referencias de cliente/plantilla/proveedor. No existe un almacén de archivos para este módulo. Añadir URLs públicas, rutas del disco o binarios al contenido de esas tablas sería incompatible con este alcance.

Se añadió la abstracción `temporaryWhatsAppMedia` con `put/get/remove/clear`. Conserva `File` y URL `blob:` en un Map de memoria; los registros existentes contienen únicamente ID temporal, tipo, MIME, nombre y tamaño. No se escribe en localStorage, sessionStorage, IndexedDB, disco ni base de datos para guardar adjuntos. No se convierten a base64. Las lecturas completas usan ArrayBuffer temporal acotado por los límites de interfaz.

Al reiniciar, salir de simulación o cambiar la fuente de datos se revocan las URLs, se vacía el almacén y se cancelan las lecturas pendientes. Cancelar/reemplazar un borrador libera su archivo cuando no está referenciado por una plantilla o un mensaje locales guardados. Los archivos de esos registros permanecen disponibles durante la sesión. Los borradores no enviados se liberan al desmontar su pantalla.

**Adaptación persistente futura propuesta, no aplicada:** conectar la abstracción a un almacén privado del servidor y añadir metadatos/referencia del objeto a las mismas tablas de plantillas y mensajes mediante una migración revisada. Usar una clave opaca del almacén, autorización por empresa/cliente y acceso autenticado o enlaces firmados de corta duración. Mantener el texto interno, configuración multimedia y correspondencia Meta como campos separados. No añadir un catálogo ni un historial paralelo.

Antes de habilitar esa persistencia o el envío real, el servidor deberá validar tamaño efectivo, MIME mediante contenido/firma, contenedor/códecs, alcance del objeto y pertenencia a empresa/cliente. La validación del navegador no acredita seguridad ni compatibilidad con Meta. El backend actual no recibe archivos y continúa rechazando campos multimedia en sus contratos de producción.

## Límites provisionales de interfaz

Son configurables en bytes con variables públicas de Vite, sin secretos. Requieren reconstruir el frontend al cambiar la configuración.

| Variable | Valor predeterminado |
| --- | --- |
| `VITE_WHATSAPP_MEDIA_IMAGE_MAX_BYTES` | 5 × 1024² bytes |
| `VITE_WHATSAPP_MEDIA_VIDEO_MAX_BYTES` | 10 × 1024² bytes |
| `VITE_WHATSAPP_MEDIA_AUDIO_MAX_BYTES` | 5 × 1024² bytes |
| `VITE_WHATSAPP_MEDIA_SESSION_MAX_BYTES` | 40 × 1024² bytes acumulados |

La interfaz identifica los límites como provisionales. Rechaza archivos vacíos, MIME no permitido, tipo incompatible y errores de lectura completa. Un reemplazo inválido conserva el archivo y texto anteriores.

Lista local de preparación: imágenes JPEG/PNG/WebP; videos MP4/WebM; audios MPEG/MP4/AAC/OGG/WAV/WebM. SVG, HTML, ejecutables y tipos desconocidos no se admiten. Esta lista es para previsualización local, no una promesa de compatibilidad con WhatsApp. La reproducción depende también del navegador y del códec; un error de previsualización se muestra explícitamente.

## Dependencias pendientes de Meta

El `content` pertenece a la plantilla interna MERTEL; `content_type`/`attachment` describen la multimedia; `meta_template` permanece nulo en las nuevas configuraciones de simulación. No se declara ninguna aprobación, ID o idioma de plantilla Meta.

La futura integración deberá distinguir mensajes multimedia libres y componentes de plantillas aprobadas, validar los formatos/códecs y límites de la versión elegida de Cloud API, subir el archivo al proveedor y gestionar sus IDs privados. El texto opcional junto al audio en la simulación es contenido interno; no implica que pueda enviarse como caption de audio o cabecera de una plantilla Meta. No se ha decidido dividirlo en varios mensajes reales.

Como referencia técnica histórica, el SDK oficial archivado de Meta enumera JPEG/PNG para imágenes, MP4/3GP para video y AAC/MP4/MPEG/AMR/OGG para audio, con restricciones adicionales para OGG. Debe verificarse contra la Cloud API vigente al integrar el proveedor; WebP, WAV y WebM locales no acreditan soporte real. Fuentes: [imágenes](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/messages/image/), [video](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/messages/video/), [audio](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/messages/audio/). La referencia actual de medios de developers.facebook.com devolvió HTTP 429 durante esta revisión, por lo que no se fijaron sus límites como definitivos.

La política vigente permite responder sin plantilla dentro de las 24 horas posteriores al último mensaje del usuario; fuera de esa ventana exige plantillas aprobadas. La futura implementación debe consultar la ventana real, el estado de aprobación y las políticas aplicables; las plantillas internas y los comandos `/` no son esa aprobación. Fuente: [política oficial de WhatsApp Business, sección 2](https://whatsappbusiness.com/policy/).

## Archivos de esta tarea

Modificados:

- `frontend/src/pages/Administracion/MessageTemplates.jsx`
- `frontend/src/pages/Administracion/WhatsAppConversations.jsx`
- `frontend/src/pages/Administracion/WhatsAppQuickReplies.jsx`
- `frontend/src/pages/Administracion/WhatsAppManualSend.jsx`
- `frontend/src/services/messageTemplatesAdmin.service.js`
- `frontend/src/services/whatsappCenter.service.js`
- `frontend/src/simulation/adapter.js`

Añadidos:

- `frontend/src/services/whatsappMedia.service.js`
- `frontend/src/pages/Administracion/WhatsAppMedia.jsx`
- `frontend/src/pages/Administracion/WhatsAppMedia.css`
- `frontend/test/whatsappMedia.test.jsx`
- `frontend/test/e2e/whatsappMedia.spec.js`
- `docs/whatsapp-multimedia-validation.md`

Las copias previas de los siete archivos modificados y los hashes de backend/migraciones se conservaron en `tmp/whatsapp-media-baseline`. Los hashes confirman que esta tarea no cambió backend ni esquema. No se modificaron dataset ni cálculos/vistas financieras, roles, empresas, pagos, facturas, saldos, descuentos ni etapas. No se activaron automatizaciones de la aplicación ni se implementó Meta. Las pruebas de regresión previas de automatizaciones se ejecutan exclusivamente con fixtures aislados/locales.

## Verificación

- Diez pruebas nuevas: creación/edición de imagen/video/audio, multimedia sin texto, reemplazo/eliminación, comandos `/`, separación por cliente, lectura tardía, MIME/tamaño/lectura, referencias inválidas, limpieza y bloqueo REAL antes de HTTP.
- Suite frontend completa: 256 pruebas.
- Navegador: 21 pruebas, incluyendo tres escenarios multimedia en 390, 1366 y 1920 px, siete escenarios previos de Conversaciones (cinco tamaños), regresión de simulación y Express/MySQL aislado para texto/MOCK.
- Lint sin errores ni avisos; build correcto con el aviso previo de chunks mayores de 500 kB; `git diff --check` correcto.
- Capturas en `tmp/whatsapp-media-{ancho}.png`, revisadas visualmente en móvil y escritorio. Las pruebas verifican previsualización, ausencia de overflow horizontal, contenido renderizado, ninguna petición HTTP en simulación y limpieza al confirmar la salida.
- La primera corrida de navegador coincidió con modificaciones del código y una recarga de Vite, con un 401 en el fixture REAL; se repitió con el código estable. La nueva prueba de salida se corrigió para aceptar el diálogo de confirmación existente. Una corrida frontend con tareas concurrentes agotó el timeout de un test de Dashboard sin relación con multimedia; se repitió con un worker.
- Se revisó el diff contra las copias previas, conservando los cambios locales existentes. No se ejecutó staging, commit ni push.
