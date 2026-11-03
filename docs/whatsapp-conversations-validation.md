# MERTEL — Bandeja visual de conversaciones WhatsApp

Fecha: 13 de octubre de 2026.

## Alcance de esta fase

Se incorporó **Conversaciones** como sección inicial del Centro de WhatsApp. La bandeja ofrece lista, chat y ficha de cartera en escritorio; en móvil comienza con la lista y abre el chat al seleccionar una conversación, con acceso al panel de cliente y regreso a la lista.

Esta fase es visual y simulada. No se implementaron Meta, webhooks públicos, nuevos endpoints de producción, credenciales, envío masivo ni automatización. La infraestructura de automatización que ya estaba en el árbol de trabajo se preservó sin cambios.

## Componentes y datos reutilizados

- `WhatsAppCenter.jsx`: misma ruta y autorización `settings.manage`; conserva envío manual, timeline, conexión, plantillas, mensajes e historial.
- `whatsappCenter.service.js`: el envío libre simulado reutiliza la misma operación manual de cola → procesamiento y su validación del contrato `{ message, duplicate }` / `{ message, simulated }`.
- `messages`: único origen de conversaciones, historial y estados. No hay almacenamiento alternativo de chats.
- `message_templates` / `WhatsAppManualSend.jsx`: se conserva el envío por plantilla existente. Los mensajes de texto libre DEMO no crean plantillas.
- `customer.service.js`: listado autorizado de clientes existentes.
- `collectionResultsRequest('/customers/:id/context')`: identidad, saldo persistente, facturas y etapa. La interfaz no suma facturas ni reconstruye saldos.
- `whatsappRequest('/customers/:id/sequence')`: próxima acción existente y contacto previo cuando hay datos.
- Dataset, adaptador, vistas y ciclo de vida de simulación actuales. Se agregó un mensaje entrante DEMO al mismo arreglo `messages`, sin clientes nuevos ni datos operativos.
- Proveedor MOCK, permisos, `companyScope`, autenticación e historial aprobado: sin modificaciones en esta fase.

## Conversaciones y asociación

La búsqueda contempla nombre, NIT y teléfono. Hay filtros por cliente, existencia de mensajes recientes y estado del último mensaje disponible. Se muestran identidad, teléfono, texto y fecha conocidos. El historial mantiene paginación; hay carga adicional de conversaciones y mensajes anteriores.

Las asociaciones por `customer_id` existente se respetan. Cuando ese identificador no está disponible, se normaliza el teléfono y se compara con clientes autorizados. Una coincidencia única puede mostrarse vinculada; varias coincidencias generan **Asociación ambigua** y bloquean el envío. En simulación el operador puede seleccionar explícitamente uno de los clientes coincidentes. La asociación cambia únicamente los mensajes DEMO en memoria. Una conversación sin cliente coincidente queda pendiente; no se crea un cliente.

No se muestra contador de mensajes sin leer: el modelo actual no proporciona un dato fiable sobre lectura del operador. Los estados de entrega/lectura del mensaje se presentan según los registros existentes.

No hay botón de adjuntos, pues el flujo actual no soporta archivos. No hay controles que aparenten conexión con Meta.

## Envío, aislamiento y permanencia

La advertencia se muestra fuera de los mensajes: **SIMULACIÓN — No se enviará ningún mensaje real**.

El operador selecciona una conversación asociada a un cliente, escribe y pulsa **Simular envío**. Se valida cliente activo, teléfono, texto no vacío, longitud y respuesta con ID/estado antes de confirmar. Doble clic se bloquea. Los mensajes entrantes y salientes se diferencian visualmente; sus fechas y estados proceden del registro.

Confirmación: **Mensaje simulado enviado correctamente. No se realizó ningún envío real.** Solo se presenta cuando el estado devuelto es `SENT`; una respuesta pendiente no se anuncia enviada.

El texto libre usa el adaptador local existente directamente, con verificación de modo y época antes de cada operación. Incluso si el usuario sale de simulación mientras la importación o el envío está pendiente, no hay alternativa de transporte HTTP para ese cuerpo. La extensión de cola libre y `associate-local` existen exclusivamente en el adaptador, no en Express.

En Modo Simulación solo cambian `messages`, eventos de demostración y el contador local de IDs. La interfaz mantiene borradores por conversación; esos borradores son estado de React, no otro historial. Los mensajes sobreviven a cambios de sección mientras siga viva la sesión de demostración y desaparecen al reiniciar, salir o recargar según el contrato de memoria existente.

Fuera de simulación, la bandeja consulta los endpoints existentes y bloquea redacción, envío libre y asociación local. Muestra **Proveedor MOCK · Meta pendiente**. No modifica proveedor, configuración ni credenciales.

La ficha distingue errores de cartera de errores de historial; ofrece reintentos independientes. No sustituye un saldo ausente o una respuesta inválida por cero. Valida el cliente del contexto y acepta el contrato real de facturas, que utiliza `id` y no repite necesariamente `customer_id`.

## Validación

| Caso | Resultado |
|---|---|
| Selección explícita de cliente y cambio de conversación | Aprobado; sin mezcla de historial o borradores |
| Búsqueda y filtros | Aprobado por identidad y datos de conversación disponibles |
| Chat vacío | Aprobado; estado vacío controlado |
| Cliente sin teléfono | Aprobado; redacción/envío deshabilitados |
| Asociación ambigua | Aprobado; no se elige cliente automáticamente, asociación explícita local |
| Identidad explícita con teléfono compartido | Aprobado; se conserva `customer_id` real |
| Emisor desconocido | Aprobado; sin creación automática de clientes |
| Envío de texto libre y doble clic | Aprobado; un mensaje en el único arreglo local `messages` |
| Advertencia y confirmación | Aprobado; fuera del contenido del mensaje |
| Cambio de modo durante envío | Aprobado; no existe envío a producción ni solicitud HTTP |
| Persistencia DEMO y reinicio | Aprobado; conserva mensajes al navegar y los descarta al reiniciar |
| Contexto financiero y errores | Aprobado; saldo/facturas de la fuente existente, error recuperable y sin cero ficticio |
| Consulta fuera de simulación | Aprobado contra Express y MySQL aislados, redacción deshabilitada |
| Responsive | Aprobado a 390, 768, 1024, 1366 y 1920 px, sin desbordamiento horizontal |
| Finanzas, mensajes y configuración reales | Comparación de CHECKSUM sin cambios al consultar la bandeja en esquema aislado |
| Aislamiento de simulación | Cero solicitudes a la API después de activar simulación durante los escenarios de bandeja |

Resultados finales, sin pruebas omitidas:

- Frontend completo: **238/238**, con `npm test -- --maxWorkers=2`.
- Backend relacionado WhatsApp: **46/46**, con `npm run test:whatsapp`, usando MySQL aislado cuando corresponde.
- E2E relacionados: **18/18**, con `npx playwright test test/e2e/whatsappConversations.spec.js test/e2e/whatsappCenter.integration.spec.js test/e2e/simulation.spec.js --workers=1`.
- `npm run lint`: aprobado.
- `npm run build`: aprobado; conserva el aviso de bundles mayores de 500 kB.
- `git diff --check`: aprobado.

No quedan errores funcionales conocidos en esta fase. La primera corrida simultánea tuvo un timeout de arranque de la API aislada por carga; la corrida secuencial final pasó completa. Una prueba antigua que asumía que el día hábil 7 siempre cae antes del calendario 10 se volvió determinista fijando exclusivamente su dataset de prueba; no se cambió la regla comercial.

Evidencia guardada: `tmp/whatsapp-conversations-frontend-final.log`, `tmp/whatsapp-conversations-backend.log` y `tmp/whatsapp-conversations-e2e-final.log`. Las capturas se encuentran en `tmp/whatsapp-conversations-390.png`, `-768.png`, `-1024.png`, `-1366.png` y `-1920.png`.

Incidencias corregidas durante la validación: contraste de la conversación seleccionada, respuesta financiera que no repite `customer_id` en cada factura, paginación local coherente con el orden del backend, recarga al seleccionar de nuevo la misma conversación y recuperación independiente de cartera. Los fixtures de secuencia anteriores se fijaron en una fecha conocida para que los festivos y el avance del calendario no alteren sus expectativas. Los selectores E2E del historial usan el ID del mensaje, no la primera fila o botones que desaparecen al cambiar de estado. La comparación de auditoría se realiza después del login para separar la autenticación existente de la consulta de bandeja.

## Archivos de esta fase

Editados:
- `frontend/src/pages/Administracion/WhatsAppCenter.jsx`
- `frontend/src/services/whatsappCenter.service.js`
- `frontend/src/simulation/adapter.js`
- `frontend/src/simulation/dataset.js`
- `frontend/test/whatsappCenter.test.jsx`
- `frontend/test/whatsappAutomation.test.jsx` (fixture con fecha fija)
- `frontend/test/e2e/simulation.spec.js`
- `frontend/test/e2e/whatsappCenter.integration.spec.js` (fixture aislado y consulta de bandeja)

Creados:
- `frontend/src/pages/Administracion/WhatsAppConversations.jsx`
- `frontend/src/pages/Administracion/WhatsAppConversations.css`
- `frontend/src/pages/Administracion/whatsappConversation.presentation.js`
- `frontend/test/whatsappConversations.test.jsx`
- `frontend/test/e2e/whatsappConversations.spec.js`
- `docs/whatsapp-conversations-validation.md`

Las migraciones utilizadas en los E2E se ejecutan únicamente en sus esquemas desechables. No se aplicó ninguna migración a la base operativa en esta fase.

Se preservaron los cambios locales anteriores. La comparación de hashes al iniciar y finalizar esta fase confirma que no se tocaron `backend/src`, migraciones, lógica financiera, reglas, permisos, roles, autenticación ni personalización. No se hizo commit, push, reset, checkout destructivo ni `git add .`.

## Límites actuales

Meta sigue sin conectarse, y no se añadieron credenciales. La asociación manual y el texto libre solo están disponibles en simulación. Fuera de ella, se mantiene la consulta del proveedor MOCK existente. Adjuntos y lectura del operador requieren contratos futuros; no se presentan como capacidades disponibles.
