# WhatsApp Cloud API de Meta — MERTEL

La integración usa únicamente variables del entorno del backend. El token, App Secret y Verify Token no se guardan en MySQL, no se devuelven por API y no deben aparecer en registros, pruebas ni archivos versionados.

## Configuración inicial

Definir en el entorno seguro las variables documentadas en `backend/.env.example`, con `WHATSAPP_PROVIDER=meta`, una versión de Graph API vigente validada, y `WHATSAPP_TEST_MODE=true`. Durante esta fase `WHATSAPP_TEST_ALLOWED_RECIPIENTS` debe ser exactamente `+573173697659`.

La pantalla Centro de WhatsApp permite validar la conexión y preparar hasta tres mensajes manuales de prueba por día (hora de Bogotá). La validación y el endpoint vuelven a comprobar en el backend que el destinatario es el autorizado, que es un flujo manual y que no se seleccionó un cliente, campaña, archivo o automatización. Nunca se debe probar contra un cliente de cartera.

Al rotar el token, cambiar solo `WHATSAPP_ACCESS_TOKEN` en el gestor de secretos y reiniciar el backend de forma controlada. Usar “Probar conexión Meta” para comprobarlo; un error de autenticación queda como error de conexión sin exponer el token.

## Webhook

Configurar en Meta la URL HTTPS pública:

`https://<dominio-api>/api/whatsapp/webhook`

Suscribir el campo `messages`. El GET verifica `hub.verify_token`; el POST valida `X-Hub-Signature-256` con `WHATSAPP_APP_SECRET` sobre los bytes originales. Los eventos se deduplican por `provider_message_id`; la aceptación HTTP de Meta se registra como `SENT`, mientras que `DELIVERED`, `READ` y `FAILED` se actualizan exclusivamente por webhook.

El endpoint de medios no se activa aún: la carga/previsualización de SIMULACIÓN no implica compatibilidad ni envío real a Meta. Las plantillas oficiales pueden consultarse desde Meta y permanecen separadas del catálogo interno de MERTEL; no se considera aprobada una plantilla interna por existir en la base de datos.
