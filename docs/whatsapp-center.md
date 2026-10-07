# Centro de WhatsApp MERTEL

Ruta: **Administración → WhatsApp** (`/administracion/whatsapp`). MERTEL sigue siendo el único contexto operativo. No se añadieron empresas, planes, campañas, IA ni respuestas automáticas.

## Arquitectura

El motor existente determina etapa, saldo, documento principal y elegibilidad. `collectionMessage` sigue siendo el adaptador para plantillas y variables. El centro llama a ese adaptador dentro de su transacción al generar o procesar una cola; no calcula categorías de cobranza.

Flujo: motor → etapa → regla → plantilla existente → variables → preview → `messages` → proveedor → estado → `audit_logs` / historial del cliente.

Se reutilizan `message_templates`, `messages`, `settings`, `audit_logs`, `collection_actions` y `payment_promises`. No existe un segundo catálogo, historial persistente ni sistema de promesas. El historial del cliente incorpora eventos de mensajes desde la misma auditoría, junto a gestiones y promesas existentes. La prioridad de promesas vencidas sigue perteneciendo al motor.

La migración **007_whatsapp_center.sql** amplía únicamente `messages`: etapa, dirección, modo, idempotencia, programación, fecha de reserva de límites, intentos y recepción. La migración 001 y los archivos del pipeline no se modificaron por esta fase.

## Proveedor y MOCK

`WhatsAppProvider` define `sendMessage`, `sendTemplateMessage`, `getConnectionStatus`, `validateConnection`, `handleIncomingWebhook` y `handleDeliveryStatus`. La única implementación registrada es `MockWhatsAppProvider`. No hay fetch/axios/HTTP contra Meta ni otro proveedor.

MOCK simula conexión exitosa/fallida, envío exitoso/fallido, entrega, lectura y respuesta entrante. Los IDs comienzan con `mock:`. **CONNECTED con MOCK es una conexión simulada; no confirma conexión con WhatsApp real**. Los botones lo indican expresamente.

Estados de conexión: `NOT_CONFIGURED`, `CONFIGURED`, `CONNECTED`, `DISCONNECTED`, `ERROR`. Guardar proveedor o actualizar credenciales deja `CONFIGURED`, desactiva automatizaciones y exige validación. Desconectar o fallar la conexión desactiva el interruptor global.

## Configuración y seguridad

La configuración y las reglas viven en `settings.whatsapp_center`. Se prepara proveedor, número, phone number ID, business account ID y credenciales. Cambios de configuración nunca establecen CONNECTED directamente desde el cuerpo HTTP.

El límite global inicial reutiliza `daily_message_limit` del contexto MERTEL cuando existe. No se heredan configuraciones comerciales globales con company_id NULL. Los demás límites, horarios e intervalos deben definirse explícitamente.

Los secretos requieren `WHATSAPP_ENCRYPTION_KEY`: clave de 32 bytes representada como 64 caracteres hexadecimales, administrada solo en el servidor. Se guardan con AES-256-GCM, IV aleatorio y autenticación. Sin clave, la actualización se rechaza. La API devuelve únicamente `credentials_configured`; no devuelve ciphertext, IV, tag ni tokens. El frontend muestra una máscara y permite reemplazar las credenciales mediante campos password. La clave no debe perderse: es necesaria para descifrar lo guardado. No se generó ni guardó una clave real en esta fase.

`decryptCredentials` es una función de servidor para el futuro adaptador; no hay endpoint para consultar credenciales. La auditoría recibe configuración pública y nunca secretos. Las excepciones del centro se devuelven con mensajes controlados.

## Plantillas y variables

Se usan los endpoints existentes `/api/collection/message-templates`: listado, creación, edición y activación/desactivación. No se duplican bajo `/admin/whatsapp/templates`. El panel incrusta el editor actual y conserva su preview de ejemplos identificado como ficticio.

Cada plantilla conserva nombre, canal, etapa, estado y contenido. La descripción reutiliza `subject` (máximo 200 caracteres); el tipo actual es texto. `allowed_variables` y `required_variables` se derivan del contenido validado con el catálogo compartido. No se borran físicamente plantillas. Las nuevas plantillas son inactivas por defecto. No se sembraron mensajes comerciales; los fixtures de prueba se llaman DEMO / BORRADOR.

Se admiten los nombres solicitados: `cliente_nombre`, `nit`, `numero_factura`, `saldo`, `fecha_emision`, `fecha_vencimiento`, `dias_mora`, `dias_restantes`, `etapa`, `vendedor`, `cobrador`, `empresa`, además de nombres anteriores. Los alias preservan compatibilidad con las plantillas existentes.

La sustitución es literal: no evalúa código ni vuelve a expandir variables. Variables desconocidas, llaves mal formadas, contenido vacío y datos ausentes generan errores. **Vendedor y cobrador no se inventan**: como el adaptador actual no dispone de esas asignaciones, usar esas variables bloquea la preparación hasta disponer de datos autorizados. El preview muestra las variables y sus valores reales.

## Reglas, horarios y límites

Las etapas vienen del catálogo activo del motor: En mora, Vence hoy, Faltan 5 días y Pronto pago. Cada regla configura plantilla, habilitación, modo MANUAL/AUTOMATICO, inicio/fin, días ISO 1–7, máximo por etapa/día e intervalo mínimo en horas.

Habilitar una regla requiere conexión MOCK validada y plantilla activa y compatible. Activar el interruptor global exige límites global/cliente válidos y reglas automáticas con plantilla activa y configuración válida. Cada intento de procesamiento vuelve a validar conexión, regla, plantilla, motor, variables y teléfono. Si cambió el contexto que generó el mensaje, se bloquea el procesamiento para revisión.

Horario en `America/Bogota`; inicio inclusivo y fin exclusivo. Fuera de horario, el mensaje permanece `PENDING` con `scheduled_at` para la siguiente ventana. No se registra FAILED por horario. Los límites global, por cliente y por etapa reservan cupo en la fecha programada; al procesar se verifica nuevamente la fecha efectiva. Los mensajes entrantes no consumen límites y CANCELLED libera cupo. Los fallidos conservan su reserva.

No hay valores comerciales predeterminados. El máximo por etapa/día limita el total de esa etapa, y el límite por cliente aplica entre todas sus etapas. La interfaz solicita valores expresos.

## Cola, duplicados, estados y reintentos

Los mensajes manuales se preparan desde el preview del cobrador o desde el centro. El botón original “Preparar mensaje” conserva su comportamiento temporal; el nuevo “Guardar en cola WhatsApp” persiste un PENDING. El cobrador no puede solicitar AUTOMATICO ni ejecutar pruebas globales.

La generación automática se prepara mediante el servicio/endpoint de cola: solicita al motor el contexto actual y elige la regla aplicable. No existe un cron que genere comunicaciones continuamente en esta fase. El botón “Generar cola automática MOCK” permite probar ese recorrido.

Estados: `PENDING`, `PROCESSING`, `SENT`, `DELIVERED`, `READ`, `FAILED`, `CANCELLED`. SENT no supone entrega ni lectura. PROCESSING es una transición transaccional en MOCK; el resultado se confirma al finalizar. Los estados de entrega se registran como eventos separados y no retroceden. La cancelación se admite para pendientes y fallidos.

La idempotencia usa SHA-256 de contexto MERTEL, cliente, etapa del motor, plantilla, fecha programada y modo. Existe un índice UNIQUE en MySQL y un bloqueo de fila de empresa que serializa generación, reservas y claims entre procesos. Además se controla el intervalo de la regla. Requests concurrentes devuelven el mismo mensaje con `duplicate: true`, sin insertar copias. La clave permanece reservada incluso después de cancelar: no se regenera la misma combinación en esa fecha.

Política técnica de reintentos: **máximo 3 intentos totales, 15 minutos entre intentos**. FAILED guarda código/mensaje de error, attempts, last_attempt_at y next_attempt_at. El tercer fallo queda sin próximo reintento. No se crea un bucle automático ni un envío externo.

El listado incluye cliente, plantilla, etapa, canal, dirección, contenido, proveedor/ID, estado, fechas, error e intentos. Hay filtros por cliente, plantilla, etapa, estado y fechas, con páginas de 50 registros. Los errores de esquema indican que falta aplicar la migración 007.

## Recepción y auditoría

El DTO entrante contiene teléfono, contenido, provider_message_id y received_at. El proveedor normaliza números colombianos al formato internacional. Se exige una coincidencia única con un cliente MERTEL activo; teléfonos ambiguos o sin correspondencia se rechazan para revisión. Un UNIQUE del proveedor/ID y el bloqueo transaccional evitan almacenar el mismo evento dos veces.

`/mock-incoming` es una simulación autenticada y exclusiva del administrador, **no un webhook público**. La respuesta se guarda como inbound y aparece en `messages` y en la línea de tiempo del cliente. No se interpreta su contenido, no se genera una promesa y no se responde automáticamente.

Se auditan configuración, desconexión, pruebas de conexión, reglas (incluidos horarios y límites), plantillas, cola, cancelación, envío, entrega, lectura, fallo y recepción. La sección Historial consulta los últimos 100 eventos de `audit_logs` relevantes. Los cambios de horarios/límites quedan en snapshots de configuración pública.

Permisos existentes: administrador con `settings.manage` configura el centro y consulta historial global; `message_templates.manage` administra plantillas. Cobrador con `collection.view`/`collection.manage` usa preview y cola manual; con `history.view` consulta el historial autorizado del cliente. No se añadieron roles ni un selector de empresa.

## Instalación y validación

En backend: `npm run migrate:whatsapp`. El script usa una conexión dedicada y bloqueo de migración; es repetible y detecta un esquema parcial. No ejecuta la migración 001. No carga secretos ni datos de prueba en el entorno operativo.

Pruebas: `npm test` en backend; `npm test`, `npm run test:e2e`, `npm run lint`, `npm run build` en frontend; `git diff --check`.

Validación final de esta fase: **245 pruebas backend, 136 frontend y 58 E2E aprobadas**, sin pruebas omitidas. Lint frontend, build y diff check aprobados. El build mantiene un aviso no bloqueante de bundle mayor de 500 kB. La migración 007 también se aplicó al entorno local configurado y se verificó que los CHECKSUM financieros no cambiaran. Los fixtures de pruebas se ejecutaron en esquemas aislados.

`backend/test/whatsappPolicy.test.js`: configuración por defecto, cifrado/descifrado, redacción, variables, horarios Bogotá, días, idempotencia, backoff, estados y proveedor sin IO externo.

`backend/test/whatsappCenter.test.js`: HTTP/MySQL aislados, permisos, conexión/configuración, plantillas existentes, preview, concurrencia, cola, límites global/cliente/etapa, horarios, automatización, fallos/reintentos, recepción, auditoría, filtros e integridad financiera. La migración se prueba dos veces para comprobar repetibilidad.

`frontend/test/whatsappCenter.test.jsx`: pantalla/permisos, conexión, configuración, reglas, horarios/días/límites, preview inválido, fallos, filtros, plantillas reutilizadas y auditoría. Las suites existentes cubren el editor, variables y el preview del cobrador.

`frontend/test/e2e/whatsappCenter.integration.spec.js`: navegador → API Express real → MySQL aislado. Configura MOCK, crea plantilla DEMO, guarda regla, genera preview/cola, simula SENT/DELIVERED/READ/FAILED y consulta auditoría. Comprueba CHECKSUM de invoices/payments/payment_allocations y ausencia de requests a proveedores externos. También verifica responsive en móvil. Los fixtures se eliminan al finalizar.

## Próxima integración real

Queda pendiente implementar y registrar el adaptador real, leer las credenciales cifradas en servidor, validar la conexión real, verificar firmas/tokens de webhooks y traducir sus payloads al contrato normalizado. Después se habilita explícitamente el despacho real, se conecta el worker a la cola y el disparador automático al motor, y se prueban envío/recepción/estados con el proveedor elegido. Actualmente los endpoints de procesamiento/recepción son deliberadamente exclusivos de MOCK.

No se necesitan nuevas tablas de plantillas, promesas, cola ni historial. La integración real deberá mantener los controles de permisos, horarios, límites, idempotencia, revalidación y auditoría, además de resolver claims y recuperación tras caídas del worker externo; MOCK no realiza IO fuera de su transacción.

**El centro de WhatsApp quedó preparado sin realizar envíos reales y sin modificar datos financieros.**
