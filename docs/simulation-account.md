# Cuenta exclusiva de presentación

La cuenta dedicada se autentica con el login existente y el rol reservado `simulation`.
No recibe permisos operativos de `permissionsForRoles`. La respuesta de identidad
incluye `simulation_only: true` y permisos de visualización para abrir todos los
módulos sobre el adaptador local. `authenticateToken` rechaza esta cuenta con
`SIMULATION_ACCOUNT_ONLY` antes de cualquier lectura o escritura operativa,
incluida la configuración y los envíos de WhatsApp. Solo `/auth/me` permite
consultar su propia identidad; login, refresh y logout conservan su auditoría.
Agregar accidentalmente otro rol no elimina esta frontera.

En producción, la sesión verificada activa la simulación antes de montar las
pantallas. Al recargar se vuelve a verificar la cookie con el servidor antes
de crear el conjunto de datos ficticio. El almacenamiento del navegador no
autoriza una cuenta a entrar a simulación en producción. Las cuentas habituales
conservan su funcionamiento real y no muestran el botón de simulación.

La cuenta permite reiniciar los datos y cerrar sesión. No ofrece una salida a
producción. Crear o editar clientes, facturas, pagos, plantillas y mensajes en
la demostración solo cambia la memoria del navegador. Marcar pagada crea un
pago y un historial locales y excluye esa factura de los próximos avisos.
Las recargas y el reinicio restablecen el conjunto ficticio.

El provisioning `backend/scripts/provision-simulation.js` recibe JSON por stdin
con companyId, actorId, email, username y password. Usa Argon2id y una
transacción que registra USER_CREATED sin contraseñas; no convierte ni modifica
usuarios anteriores. El bloqueo de empresa impide provisionar una segunda
cuenta de simulación en MERTEL. La gestión habitual de usuarios permite cambiar
su estado, pero no convertirla en una cuenta operativa cambiando sus roles.

Verificación: autenticación y autorización HTTP contra MySQL aislado; creación
auditada, contraseña hash y rollback; entrada automática antes del montaje,
reinicio y cierre de sesión; recorrido sobre el build de producción sin llamadas
operativas de red, pago e historial locales y chat simulado.

La suite backend general con proveedor MOCK presenta dos fallos previos en las
fixtures de collectionResults por variables antiguas de plantilla; se reprodujeron
sin estos cambios en HEAD 96165a2. Las pruebas de autenticación, permisos,
provisioning y gestión de usuarios de esta entrega pasan sin omisiones.
