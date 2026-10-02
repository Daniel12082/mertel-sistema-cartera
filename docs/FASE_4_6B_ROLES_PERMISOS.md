# FASE 4.6B — Roles, permisos y primer usuario admin

Revisión: 2 de octubre de 2026. Autorización por roles existentes, sin aislamiento
por empresa. La FASE 4.6A se conserva; el login añade username opcional y las
respuestas de usuario añaden username y permisos calculados por el servidor.

## Inspección y decisiones

La base real contiene `roles`, `user_roles` y `users`, con las FK de la migración
001. Roles existentes: admin (id 1), collector (id 2), supervisor (id 3). Al
iniciar esta fase había 0 usuarios y 0 relaciones user_roles. No se añaden roles,
tablas de permisos ni estructuras de edición persistente.

`users.email` es obligatorio y único; no existía username. La migración nueva
005 añade `username VARCHAR(50) NULL` e índice único. Los usuarios existentes
pueden conservar username NULL y autenticarse con email. Se permite
`POST /api/auth/login` con `{login, password}` (username o email) y se conserva
`{email, password}`. Enviar ambos identificadores produce 400. Se mantiene la
respuesta genérica para usuario inexistente, inactivo, eliminado o contraseña
incorrecta; nunca se crea un usuario mediante login.

## Matriz inicial centralizada

Fuente única: `backend/src/config/permissions.js`. Los permisos usan
`modulo.operacion`, descripción, módulo y disponibilidad. No hay reglas de
roles duplicadas dentro de controladores financieros. Los roles múltiples
suman sus permisos; roles desconocidos o ausentes no conceden permisos.

| Módulo | Admin | Supervisor | Collector | Disponible ahora |
| --- | --- | --- | --- | --- |
| Clientes | ver, crear, editar, eliminar | ver, editar | ver | Sí |
| Facturas | ver, crear, editar, eliminar | ver, editar | ver | Sí |
| Pagos | ver, crear, editar, eliminar según regla financiera | ver, crear, editar | ver, crear | Sí |
| Asignaciones | ver, crear, reversar | ver, crear, reversar | ver, crear | Sí |
| Cartera | ver, exportar | ver, exportar | ver | Solo ver |
| Cobranza | ver, gestionar | gestionar | gestionar | Motor puro; sin endpoint HTTP |
| Reportes | ver, exportar | ver, exportar | ver | Sin endpoint HTTP |
| Historial | ver | ver | solo actividad de su propio usuario | Sin endpoint HTTP |
| Mensajes | ver, gestionar | ver, gestionar | gestionar | Sin endpoint HTTP |
| Configuración | administrar | sin acceso administrativo | sin acceso | Sin endpoint HTTP |
| Usuarios | ver, crear, editar, desactivar | sin acceso administrativo | sin acceso | Sin endpoint HTTP |
| Matriz de roles | consultar | sin acceso | sin acceso | Sí, solo lectura |

Admin posee todas las operaciones del catálogo. La lista de permisos efectivos
devuelta al frontend incluye únicamente operaciones implementadas: 17 para
admin, 11 para supervisor y 7 para collector. Los permisos previstos se
documentan en el catálogo pero no autorizan endpoints ficticios. Por ejemplo,
`portfolio.export` no se activa mientras no exista una operación de exportación.
`history.view` del collector incluye `scope=own_user`; al implementar historial,
el backend deberá filtrar por el usuario real, antes de habilitar esa operación.

El permiso administrativo no omite las restricciones financieras: la ruta de
borrado de pagos sigue sin eliminar pagos reales, según la regla existente.
Los 37 escenarios de integridad financiera se conservan sin modificar sus
expectativas; su fixture ahora tiene el rol admin para probar reglas de negocio.

## Cadena y rutas protegidas

JWT → `authenticateToken` → usuario activo → roles actuales de MySQL → permisos
efectivos → `requirePermission` → controlador. Roles/permisos no se almacenan en
JWT ni se aceptan desde el cuerpo, headers o React. Se consultan de nuevo en cada
petición: retirar un rol elimina el acceso aunque el access token siga vigente.
Sin autenticación válida: 401. Con usuario activo sin permiso: 403 genérico.
Permiso desconocido o aún no implementado: error al configurar el middleware.

| Método / ruta | Permiso |
| --- | --- |
| GET /api/customers y /:id | customers.view |
| POST /api/customers | customers.create |
| PUT /api/customers/:id | customers.update |
| DELETE /api/customers/:id | customers.delete |
| GET /api/invoices y /:id | invoices.view |
| POST /api/invoices | invoices.create |
| PUT /api/invoices/:id | invoices.update |
| DELETE /api/invoices/:id | invoices.delete |
| GET /api/payments y /:id | payments.view |
| POST /api/payments | payments.create |
| PUT /api/payments/:id | payments.update |
| DELETE /api/payments/:id | payments.delete |
| GET /api/payments/:paymentId/allocations | payment_allocations.view |
| POST /api/payments/:paymentId/allocations | payment_allocations.create |
| DELETE /api/payments/:paymentId/allocations/:allocationId | payment_allocations.reverse |
| GET /api/portfolio, /summary, /customers, /customer/:customerId, /reconciliation | portfolio.view |
| GET /api/admin/roles | roles.view |

Health continúa público. Login, refresh y logout conservan su comportamiento;
me requiere autenticación, incluso si el usuario no tiene permisos de módulos.
No se inventan rutas de cobranza, reportes, mensajes, historial, settings ni
administración CRUD de usuarios. La única ruta administrativa nueva es la
consulta de la matriz requerida, protegida exclusivamente para admin.

Referencia de diseño: [OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).

## Consulta administrativa y preparación del frontend

`GET /api/admin/roles` devuelve Admin, Supervisor y Collector, con módulos,
descripciones, estado habilitado/no habilitado y disponibilidad. Solo lectura,
sin endpoints de edición de políticas; Cache-Control no-store.

En Configuración se prepara la consulta y selección de rol. Un usuario sin
sesión ve que necesita una sesión interna; un usuario sin roles.view no consulta
la matriz. El backend aplica la protección aunque se altere el frontend.
Los permisos previstos se distinguen de operaciones disponibles.

`AuthProvider` conserva en memoria access token y usuario; expone roles,
permisos, `acceptSession`, `clearSession` y `refreshIdentity`, que consulta me.
No hay localStorage/sessionStorage, login visual, usuarios por defecto ni
refresh automático nuevo. La integración de login será FASE 4.6D; clearSession
solo limpia memoria y no sustituye el logout del backend.

## Migraciones y primer admin interno

Se revisó la 004 existente, que solo crea auth_refresh_sessions e índices/FK;
su archivo no se modifica. El 2 de octubre se ejecutó explícitamente
`npm run migrate:auth` sobre la base configurada: se aplicaron
`004_auth_refresh_sessions.sql` y `005_users_username.sql`. No se ejecutó ni
modificó la 001. El comando solo permite esas dos migraciones, verifica el
esquema, omite lo ya aplicado y usa un bloqueo de MySQL para evitar concurrencia.
La DDL de MySQL no es transaccional; un fallo requiere revisar qué archivo se
aplicó antes de volver a ejecutar el comando. Nunca elimina datos ni tablas.

Provisioning: `npm run provision:admin`, desde backend en una terminal
interactiva. Pide email del propietario y contraseña/confirmación con entrada
oculta. Solo admite el argumento opcional --email; rechaza argumentos de
contraseña, redirecciones y ejecución sin TTY. No recibe la
contraseña de ENV ni la escribe en código, migración, documentación o archivos.
Solo persiste Argon2id en users.password_hash, usando el helper de FASE 4.6A.

Username fijo `admin`, etiqueta `Admin`, rol existente admin, estado active,
company_id NULL. No se crea ningún otro usuario de aplicación. Un bloqueo por
base de datos, la unicidad del username y la transacción de usuario/rol evitan
duplicados, incluso con dos ejecuciones simultáneas. Si ya hay cualquier
usuario con rol admin (incluido inactivo/eliminado), se conserva sin cambios y
no se pide otra contraseña. Username/email ocupados no se reasignan; un fallo
al insertar el rol revierte la creación del usuario. Los errores SQL se
responden sin cuerpos de consultas ni hashes. Los IDs se manejan como strings.

Provisioning real completado el 2 de octubre mediante entrada oculta del
propietario. La consulta posterior confirmó exactamente un usuario, username
admin, rol admin, estado active, email coincidente con el confirmado y hash
Argon2id. No se mostró el hash ni se recibió la contraseña en el chat.
Una segunda ejecución del servicio devolvió created=false sin solicitar otra
contraseña ni modificar el usuario. El login por username/email se verificó
en la integración con credenciales de fixtures; no se capturó la contraseña
real para repetirlo desde el agente.

Referencia: [bloqueos de MySQL](https://dev.mysql.com/doc/refman/8.4/en/locking-functions.html)
y [TTY de Node.js](https://nodejs.org/api/tty.html).

## Pruebas y revisión

- Auth: 34/34, sin omisiones.
- Autorización/provisioning: 19/19, sin omisiones.
- Backend completo: 109/109, sin omisiones (34 auth + 19 autorización + 37
  integridad financiera + 19 cartera/motor).
- Lint frontend: aprobado para el contenido de esta fase preparado para commit,
  sin desactivar reglas.
- Build frontend: aprobado para ese mismo contenido con VITE_API_URL de la API
  final.
- git diff --check: aprobado; revisión individual de cambios antes del commit.

Se verifican las 24 variantes de rutas para cada rol, 401 y 403, revocación de
roles, unión de roles, intento de elevar permisos desde cliente/JWT,
catálogo solo admin, health/auth, ausencia de registro/recuperación pública,
login admin por username y email, Argon2id, duplicación/concurrencia,
conflictos de identidad, rollback y migraciones idempotentes. La CLI se prueba
también contra argumentos de contraseña y entrada por pipe, sin conectarse a
la base real ni revelar el valor recibido.
Las suites escriben exclusivamente fixtures aleatorios en sus propias bases
temporales; no se provisionan usuarios de prueba en la base de aplicación.
El mensaje private_sql_failure de la suite financiera es la prueba de rollback
preexistente y no un fallo de la ejecución.

## Exclusiones y Git

`database/migrations/001_initial_schema.sql` conserva su modificación local
previa, hash Git `e2f0b2c49c979991914a187dc9531d9c5d2117ce`; queda fuera del índice
y del commit. No se modifica código financiero ni el motor de cobranza.
No se implementa aislamiento por company_id: será FASE 4.6C.
No hay registro público, recuperación pública de contraseña ni WhatsApp.

Commit solicitado: `feat: implementar roles y permisos`, push origin/main.
Se añaden únicamente rutas explícitas de esta fase; el hash, resultado del
push y estado final se entregan en el reporte para no crear una referencia
circular dentro del propio commit.

Durante el cierre aparecieron cambios concurrentes del login frontend que
pertenecen a otra fase. Se conservan en el directorio de trabajo, fuera de este
commit. En App.jsx, AuthProvider.jsx y auth.service.js se prepara únicamente la
versión de FASE 4.6B en el índice, sin sobrescribir esa integración concurrente.
Lint y build se verifican sobre una exportación del índice para revisar el
contenido exacto del commit sin depender del login en curso.
