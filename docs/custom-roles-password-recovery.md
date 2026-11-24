# Roles personalizados y contraseñas

Configuración → Roles y permisos permite crear y editar roles propios, seleccionar
paneles y operaciones y desactivar el rol sin eliminar el historial. Los permisos
dependientes se muestran seleccionados y se validan nuevamente en el servidor.
Los roles de sistema y la clasificación exclusiva de simulación permanecen
protegidos. Las credenciales, hashes y tokens no se devuelven al administrador.

Configuración → Usuarios permite asignar roles, crear usuarios, editar sus datos,
cambiar su contraseña y activar o desactivar sus cuentas. Un administrador puede
comprobar la conexión del correo de recuperación. Las cuentas con privilegios
limitados no pueden asignar permisos que no tienen ni restablecer contraseñas de
cuentas superiores.

El login incluye Olvidé mi contraseña. El remitente predeterminado de esta
instalación es cartera@cobranzasmertelimportaciones.com, mediante Hostinger SMTP
465 con TLS. SMTP_PASSWORD se configura únicamente en el servidor. SMTP_HOST,
SMTP_PORT, SMTP_USER y SMTP_FROM permiten cambiar los valores predeterminados.
No se registran secretos de correo en la aplicación ni en sus auditorías.

El enlace de recuperación caduca en 30 minutos y solo puede consumirse una vez.
Su token viaja en el fragmento de la URL para evitar registrarlo en solicitudes
HTTP del navegador. La base almacena su hash SHA-256. Cambiar o restablecer una
contraseña invalida los enlaces y las sesiones refresh anteriores. La versión de
contraseña del usuario también invalida inmediatamente los access tokens previos.
La respuesta pública no distingue entre correos conocidos y desconocidos. Hay
límites de solicitudes por IP y por cuenta. Si SMTP no está configurado, la
interfaz informa que la recuperación no está disponible.

Los cambios quedan en Auditoría → Usuarios y roles, con fecha, hora y responsable.
El detalle visible no contiene contraseñas, hashes ni versiones internas de sesión.
Los eventos de recuperación y los fallos de entrega también quedan registrados.

Migración: ejecutar `node scripts/migrate-user-access.js` desde backend. La copia
canónica está en database/migrations/012_custom_roles_password_reset.sql y el
paquete desplegable contiene la misma definición en backend/config/user-access.sql.
Solo añade custom_roles y auth_password_resets; no modifica saldos ni cuentas.

Validación: integración HTTP y MySQL aislado para permisos, alcance, escalamiento,
roles inactivos, contraseñas, enlaces de un uso, caducidad y auditoría; recorrido
de navegador con administración real en base temporal. Las dos fixtures antiguas
de collectionResults con variables de plantilla obsoletas ya fallaban antes de
esta entrega; se conserva esa limitación de la suite general documentada en
docs/simulation-account.md.

Referencias del transporte de correo:
- https://www.hostinger.com/support/1575756-how-to-get-email-account-configuration-details-for-hostinger-email/
- https://nodemailer.com/smtp
