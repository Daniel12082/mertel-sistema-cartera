# FASE 4.6A — Autenticación segura de MERTEL

Revisión: 2 de octubre de 2026. Se implementa autenticación; autorización e
aislamiento por empresa siguen pendientes.

Reporte histórico de FASE 4.6A: la autorización provisional aquí descrita es
sustituida por [FASE 4.6B — roles y permisos](FASE_4_6B_ROLES_PERMISOS.md).
El aislamiento por empresa continúa pendiente de FASE 4.6C.

## 1. Inspección real y datos existentes

Se revisaron migraciones 001–003, `information_schema.COLUMNS` y
`KEY_COLUMN_USAGE`, rutas, server, Helmet/CORS, dependencias, settings y auditoría.
La base configurada se consultó solo en modo lectura.

| Columna de users | Tipo real | Nullable / default |
| --- | --- | --- |
| id | BIGINT UNSIGNED, PK, autoincremental | No |
| company_id | BIGINT UNSIGNED, FK companies.id | Sí |
| first_name | VARCHAR(100) | No |
| last_name | VARCHAR(100) | Sí |
| email | VARCHAR(150), UNIQUE | No |
| password_hash | VARCHAR(255) | No |
| phone | VARCHAR(50) | Sí |
| status | VARCHAR(30) | No, active |
| last_login_at | TIMESTAMP | Sí |
| created_at | TIMESTAMP | No, CURRENT_TIMESTAMP |
| updated_at | TIMESTAMP | No, CURRENT_TIMESTAMP; actualización automática |
| deleted_at | TIMESTAMP | Sí |

`users.company_id` referencia companies, con ON DELETE SET NULL / ON UPDATE
CASCADE. No se cambian columnas ni estados.

`roles` contiene `id` BIGINT UNSIGNED PK, `name` VARCHAR(80) UNIQUE,
`description` VARCHAR(255) nullable y `created_at` TIMESTAMP.
`user_roles` usa PK compuesta `(user_id, role_id)`, ambos BIGINT UNSIGNED,
con FK a users/roles y borrado/actualización en cascada.

`companies` contiene identificación y contacto, estado `active`, timestamps y
`deleted_at`. No se presupone una empresa obligatoria para el usuario.

Inventario antes y después: **0 usuarios, 3 roles, 0 relaciones user_roles,
0 empresas, 0 eventos audit_logs**. Los roles existentes son `admin`, `collector`
y `supervisor`. No se crean ni asignan roles comerciales nuevos. No hay hashes
existentes que convertir. La creación del primer usuario requiere identidad y
credenciales decididas por el propietario; no se provisiona automáticamente.

`settings` contiene las ocho claves preexistentes: iva_percentage,
prompt_payment_discount, business_day_due_day, payment_cutoff_day,
reminder_days_before_due, reminder_days_after_due, daily_message_limit y
contact_line. No contiene configuración de autenticación; no se modifica.

La base financiera mantiene 8 clientes, 42 facturas, 2 pagos y 16 aplicaciones.
Las inconsistencias documentadas en FASE 4.5B permanecen sin ajustes.

## 2. Contraseñas

Se incorpora `argon2` y el helper `hashPassword`: **Argon2id**, sal aleatoria
gestionada por la biblioteca, 64 MiB, 3 iteraciones, paralelismo 1. El resultado
PHC se almacena en la columna existente `users.password_hash`. La biblioteca
funciona y fue probada en el Node 26.10.0 instalado; requiere Node >=22.

El login verifica Argon2id; un formato desconocido, bcrypt o texto plano da el
mismo 401 que una contraseña incorrecta, sin conversión automática. Una
verificación real con hash dummy también se realiza cuando el usuario no existe
o el formato es incompatible. No se aplica una política comercial nueva de
longitud mínima al login; se exige string presente de hasta 1024 bytes.

No hay endpoint de registro, recuperación ni administración de contraseñas en
esta fase. El provisionamiento controlado debe usar `hashPassword`, persistir
solo el hash mediante parámetros SQL y evitar contraseñas en argumentos,
historial del terminal, respuestas o logs. No se inventa un usuario inicial.

Referencia del proveedor: [node-argon2](https://github.com/ranisalt/node-argon2).

## 3. JWT y middleware

Access token **HS256**, emitido con `jsonwebtoken`, verificado con algoritmo
permitido explícitamente, firma, expiración, issuer, audience y edad máxima.
Solo contiene `sub` (ID de usuario como string), `iat`, `exp`, `iss`, `aud`.
No contiene password, hash, roles ni información financiera.

Duración por defecto: **15 minutos** (`JWT_ACCESS_EXPIRES_IN=15m`), configurable
entre 1 segundo y 1 hora. Se exige `JWT_SECRET` de al menos 32 bytes, generado
aleatoriamente y gestionado fuera del repositorio. No existe secreto por defecto
ni fallback inseguro. Se validan origen y demás variables antes de escuchar.

`authenticateToken(config)` extrae Bearer, valida JWT, carga usuario sin hash,
comprueba `status = active` y `deleted_at IS NULL`, y establece `req.user`.
Ausencia, token inválido/expirado y usuario inexistente/inactivo producen 401.
Un error de base de datos produce 500 genérico, nunca se disfraza de credencial
incorrecta ni expone SQL. No se implementa autorización por roles.

`GET /me` responde `id`, `email`, `name` derivado de first_name/last_name,
`company_id` nullable y roles actuales `{id, name}`. IDs de autenticación se
serializan como strings para conservar precisión de BIGINT UNSIGNED.

Referencia: [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken).

## 4. Refresh y logout

Refresh opaco de **32 bytes aleatorios** (256 bits, base64url). Solo se devuelve
en cookie `mertel_refresh`, **HttpOnly**, host-only, Path `/api/auth`, SameSite
elegido explícitamente por `AUTH_COOKIE_SAME_SITE` y Secure en producción.
No aparece en JSON y no se acepta desde body, query string ni Authorization.

La base almacena únicamente SHA-256 del token. Cada login crea una familia de
sesión independiente; cada refresh bloquea usuario y sesión, comprueba existencia,
expiración UTC, revocación y usuario activo, revoca el hash anterior y crea otro
hash de la misma familia en una transacción. Conserva la expiración absoluta
original: **7 días** por defecto, configurable hasta 90 días.

La reutilización de un token revocado invalida esa familia; no afecta otras
sesiones del usuario. Dos refresh simultáneos del mismo token no pueden emitir
dos sucesores válidos. El futuro frontend debe serializar solicitudes refresh
para evitar que una segunda solicitud se interprete como replay.

Logout revoca solo la familia identificada por la cookie y elimina la cookie
con los mismos atributos. Es idempotente para cookies ausentes/desconocidas.
Un access token ya emitido permanece válido hasta su expiración, salvo que el
usuario sea eliminado/deshabilitado; logout corta la renovación, no mantiene
una lista global de revocación de JWT.

Se exige JSON en POST de auth y se comprueba Origin exacto mediante CORS antes
de mutar sesiones; formularios/text/plain y solicitudes cross-site sin Origin
se rechazan. Los clientes técnicos sin Origin pueden probar la API con JSON.
SameSite None solo se admite con Secure en producción y orígenes HTTPS.

Referencia: [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

## 5. Endpoints y protección

| Endpoint | Autenticación | Resultado |
| --- | --- | --- |
| POST /api/auth/login | Email/password válidos | 200 con access_token, token_type, expires_in y user; cookie refresh |
| POST /api/auth/refresh | Cookie refresh | 200 con access token y cookie rotada; 401 si no es válida |
| POST /api/auth/logout | Cookie actual, si existe | 200 y cookie eliminada; revocación de familia |
| GET /api/auth/me | Bearer access token | 200 con usuario mínimo; 401 sin autenticación válida |

Email/password inválidos: 400. Credenciales incorrectas, usuario desconocido,
inactivo o eliminado: idéntico 401 `Credenciales inválidas`. Auth usa
`Cache-Control: no-store`. Errores inesperados: 500 seguro; no stack, SQL,
passwords, hashes ni tokens en errores/logs. Solo login/refresh exitosos
devuelven el access token esperado.

Se protegen todas las operaciones de `/api/customers`, `/api/invoices`,
`/api/payments` (incluidas aplicaciones/reversiones) y `/api/portfolio`.
No existen endpoints HTTP de cobranza separados. El motor puro no cambia.
Un usuario autenticado puede acceder provisionalmente con cualquier rol,
incluso sin roles: el filtrado comercial es FASE 4.6B.

`/api/health` y `/api/health/db` siguen públicos; el segundo solo informa
conectividad, sin nombre de base ni datos financieros. Helmet sigue activo.

## 6. CORS, límites y configuración

En producción, `FRONTEND_URL` debe ser únicamente
`https://mertelimportaciones.com`; el backend rechaza al arrancar cualquier otro
origen o una lista con varios orígenes. La API es
`https://api.mertelimportaciones.com`, que no se admite como origen del frontend.
Desarrollo/test permiten orígenes exactos separados por coma, sin wildcard,
rutas ni credenciales embebidas. CORS permite cookies (`credentials: true`),
Content-Type y Authorization, y rechaza orígenes ajenos antes de ejecutar rutas.
Los ejemplos declaran HTTP local para backend y la URL HTTPS de API para frontend;
`.env.local` del frontend conserva su URL de desarrollo y no se modifica.

Rate limit exclusivo del login: por IP, **10 fallos / 15 minutos** por defecto,
HTTP 429 genérico con Retry-After. Los logins exitosos no consumen ese presupuesto.
Configurable por `AUTH_RATE_LIMIT_WINDOW_MS` y `AUTH_RATE_LIMIT_MAX`.
Se utiliza MemoryStore de express-rate-limit, válido para un proceso; si el
despliegue usa varias instancias deberá compartir almacenamiento de límites.

`TRUST_PROXY_HOPS=0` por defecto; debe ajustarse al número real de proxies
controlados por el despliegue para no compartir o falsificar la IP del límite.
No se usa `trust proxy=true`. NODE_ENV debe ser development/test/production.

Variables y límites están documentados en `backend/.env.example`, sin secretos:
JWT_SECRET, JWT_ACCESS_EXPIRES_IN, JWT_ISSUER, JWT_AUDIENCE,
AUTH_REFRESH_EXPIRES_IN, AUTH_COOKIE_SAME_SITE, FRONTEND_URL,
AUTH_RATE_LIMIT_WINDOW_MS, AUTH_RATE_LIMIT_MAX y TRUST_PROXY_HOPS.

Referencia: [express-rate-limit](https://express-rate-limit.mintlify.app/reference/configuration).

## 7. Auditoría

Se aprovecha audit_logs existente, con FK nullable a companies/users,
entity_type, entity_id, action, JSON old_values/new_values, ip_address,
user_agent y created_at. No se rediseña ni migra esa tabla.

Se registran `login_success`, `login_failed` (credenciales rechazadas), `logout`
y `refresh_rejected`, con entity_type `auth`, ID de usuario cuando corresponde
e IP. Los intentos fallidos no guardan email ni identifican al usuario candidato.
No se almacenan cuerpos, headers, cookies, passwords, hashes o tokens; JSON y
user_agent permanecen NULL. Errores de sintaxis/validación y límites HTTP se
responden sin registrar el contenido recibido.

Las escrituras de sesión y auditoría exitosas son transaccionales. Una caída
de persistencia no emite credenciales sin sesión/auditoría guardadas. Los fallos
de autenticación se loguean en consola solo como mensajes internos genéricos.

## 8. Migración y activación

Nueva migración: **004_auth_refresh_sessions.sql**, que crea solamente
auth_refresh_sessions: id, user_id, family_id, token_hash UNIQUE, expires_at,
revoked_at, created_at y sus índices/FK. Conserva hashes revocados para replay.
Incluye SQL comentado de reversión; eliminar esa tabla termina refresh sessions,
sin tocar usuarios ni audit_logs.

**La migración no se aplicó automáticamente a la base de aplicación.** Se aplicó
y verificó en bases temporales de pruebas con las FK reales. No se alteran datos
históricos. La base real sigue sin auth_refresh_sessions ni usuarios; su `.env`
actual tampoco define JWT_SECRET ni FRONTEND_URL y se dejó intacto.

Para activar en el entorno real:

1. Ejecutar solo la nueva migración 004 mediante el procedimiento habitual de
   base de datos; no volver a ejecutar la 001.
2. Configurar JWT_SECRET aleatorio en secret manager o `.env` ignorado; en
   producción, `NODE_ENV=production`, `AUTH_COOKIE_SAME_SITE=lax` y
   `FRONTEND_URL=https://mertelimportaciones.com`. Servir la API por HTTPS en
   `https://api.mertelimportaciones.com` y mantener MySQL en la red interna.
3. Provisionar el primer usuario de forma controlada con un hash Argon2id,
   identidad y contraseña decididas por su dueño, sin valores por defecto.
4. Reiniciar backend y probar login/me/refresh/logout.

El server falla explícitamente al arrancar si falta la configuración obligatoria;
no escucha una API financiera sin protección. En el frontend solo se añade el
ejemplo ENV de la URL de API. Sus pantallas financieras recibirán 401 hasta la integración de login y
Bearer prevista para FASE 4.6D; el backend se prueba directamente por HTTP.

## 9. Archivos de FASE 4.6A

- backend/.env.example — variables sin secretos.
- backend/package.json y backend/package-lock.json — dependencias y test:auth.
- backend/src/app.js — aplicación probada, CORS, Helmet, mounts protegidos y errores.
- backend/src/server.js — arranque separado de la aplicación.
- backend/src/config/auth.js — validación de configuración.
- backend/src/utils/password.js — Argon2id y verificación segura.
- backend/src/models/auth.model.js — usuarios, roles, sesiones y auditoría.
- backend/src/services/auth.service.js — JWT, login, refresh y logout transaccionales.
- backend/src/middleware/authenticateToken.js — Bearer y usuario activo en req.user.
- backend/src/controllers/auth.controller.js — validación HTTP y cookies.
- backend/src/routes/auth.routes.js — endpoints, no-store, JSON y rate limit.
- backend/test/auth.test.js y backend/test/auth.unit.test.js — integración y unidad.
- backend/test/financialIntegrity.test.js — solo montaje sobre createApp y login
  de fixture; se conservan los 37 escenarios financieros.
- database/migrations/004_auth_refresh_sessions.sql — tabla de sesiones nueva.
- docs/FASE_4_6A_AUTENTICACION_SEGURA.md — este reporte.

La implementación inicial incluyó 17 archivos; el cierre añade
`frontend/.env.example` con `VITE_API_URL=https://api.mertelimportaciones.com/api`.
No se modifica fuente financiera FASE 4.5B, motor puro FASE 4.3, código del
frontend ni datos de aplicación. La migración 001 conserva
su modificación local preexistente y se excluye del commit.

## 10. Verificación y resultados

- `npm test`: **90/90** aprobadas, sin skips: 34 auth, 37 integridad financiera
  y 19 cartera/cobranza preexistentes.
- `npm run test:auth`: **34/34** aprobadas, sin skips.
- `npm run test:financial`: **37/37** aprobadas, sin skips, sobre API autenticada.
- `npm run lint` frontend: aprobado; backend no tiene lint configurado.
- `npm run build` frontend: aprobado.
- `npm audit --omit=dev` backend: 0 vulnerabilidades reportadas.
- `git diff --check`, revisión diff/stat/status y exclusiones: realizadas.
- Hash del archivo 001 antes/después:
  `e2f0b2c49c979991914a187dc9531d9c5d2117ce`.

Se cubren los casos solicitados de login, JWT, refresh, logout, me, rutas,
password/hash en respuestas, tokens en logs, SQL público y rate limit. También
algoritmo none/incorrecto, issuer/audience/firma, expiración obligatoria,
precisión de IDs, configuración ausente, CORS/CSRF, cookies Secure/HttpOnly,
replay, sesiones independientes, refresh simultáneo y logout contra refresh.

Triggers exclusivos de prueba comprueban rollback de login y rotación cuando
falla el INSERT de sesión; nunca se pierde la sesión anterior por una rotación
fallida. Se conserva el test financiero que induce un fallo SQL: su mensaje de
consola `private_sql_failure` es esperado y no pertenece a autenticación.

Las suites MySQL crean y eliminan únicamente esquemas aleatorios
`mertel_auth_test_<uuid>` / `mertel_financial_test_<uuid>`, con verificación del
nombre antes de DROP. Requieren credenciales y permisos de tablas/bases/triggers;
sin credenciales se omiten explícitamente las integraciones. No quedan bases
temporales después de ejecutar las pruebas. La migración 001 tiene un problema
preexistente con `row_number` en una tabla de importación ajena a este alcance;
las pruebas copian solo las definiciones necesarias y no modifican ese archivo.

## 11. Git y pendientes

Commit solicitado: `feat: implementar autenticacion segura`; push origin/main.
Hash, resultado push y estado final se reportan al terminar para evitar una
referencia circular en el propio commit.

FASE 4.6B debe definir y aplicar permisos por roles reales; después vendrá
aislamiento multiempresa. Actualmente cualquier usuario activo autenticado puede
acceder a las rutas protegidas, con independencia de rol/empresa. No se inventa
esa política comercial. FASE 4.6D debe añadir login y protección frontend,
access token en memoria y refresh coordinado con cookies, evitando exponer el
refresh a JavaScript. No se implementan recuperación de contraseña, WhatsApp,
paginación, cobranza nueva ni ajustes financieros.

El despliegue debe completar activación anterior, TLS y proxies; una instalación
con varias instancias requerirá rate-limit compartido. Retención/limpieza de
sesiones expiradas y política de revocación ante futuros cambios de contraseña
se deben coordinar cuando existan esos flujos. No se borra historial de sesión
automáticamente en esta fase.

## 12. Cookie y arquitectura final de producción

`AUTH_COOKIE_SAME_SITE` es obligatorio: acepta `lax`, `strict` o `none` en
minúsculas. Su ausencia o un valor inválido impiden iniciar el backend. El ejemplo
declara `lax` para desarrollo y producción; se elimina la selección implícita
del código. Producción utiliza exclusivamente esta arquitectura:

- Frontend: `https://mertelimportaciones.com`.
- Backend/API: `https://api.mertelimportaciones.com`.
- MySQL: red interna; no expuesta públicamente. No se configura ni modifica su
  infraestructura desde este repositorio.

| Despliegue | NODE_ENV | AUTH_COOKIE_SAME_SITE | Secure | HttpOnly |
| --- | --- | --- | --- | --- |
| HTTP local, mismo host y distintos puertos | development | lax | false | true |
| HTTPS, frontend/API finales de MERTEL | production | lax | true | true |

Frontend y API finales tienen orígenes distintos, por lo que requieren CORS,
pero comparten esquema HTTPS y dominio registrable `mertelimportaciones.com`:
son same-site y `SameSite=Lax` es compatible con refresh por POST. CORS y
SameSite son controles distintos; un origen distinto no obliga a usar None.
En local, no mezclar `localhost` con `127.0.0.1`.
Referencias: [SameSite en MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)
y [same-site frente a same-origin](https://web.dev/articles/same-site-same-origin).

Para producción final, configurar `NODE_ENV=production`,
`AUTH_COOKIE_SAME_SITE=lax` y `FRONTEND_URL=https://mertelimportaciones.com`.
Secure es siempre true en producción, sin variable para desactivarlo;
HttpOnly es siempre true. La validación de None se conserva: `none` se rechaza
en desarrollo/test porque allí Secure es false; no es la opción del despliegue
final. Se conservan host-only (cookie de la API, sin Domain) y Path `/api/auth`.
El frontend deberá activar `credentials: "include"` en fetch o
`withCredentials: true` en Axios; CORS ya permite credenciales y solo orígenes
autorizados. Se restringe la configuración de CORS de producción al frontend
final; se conserva su middleware y el resto de las reglas de autenticación.

Las pruebas verifican encabezados Set-Cookie del servidor y el origen real del
frontend con solicitudes HTTP de prueba. No simulan la política de cookies de
un navegador ni un despliegue TLS; esa validación queda para el despliegue e
integración del frontend. No se publican servicios ni se aplican migraciones
contra la base real durante este cierre.

Verificación de la revisión previa de cookie: `npm run test:auth` **33/33** y `npm test`
**89/89**, sin fallos ni omisiones. La matriz cubre NODE_ENV ausente,
development, test y production, valores SameSite ausentes/inválidos y rechazo
de None sin Secure. La integración comprueba Lax local y Lax/Strict/None en
producción durante login, rotación, logout y borrado por refresh rechazado.
La única adaptación del test financiero es declarar SameSite en su fixture.
La revisión anterior se mantuvo sin commit hasta recibir esta arquitectura
final. El usuario ahora autoriza commit `feat: implementar autenticacion segura`
y push a `origin/main`, condicionados a todas las verificaciones del cierre.

## 13. Cierre con los dominios finales

Resultado del cierre: auth **34/34**, backend completo **90/90**, sin fallos ni
omisiones. El incremento frente a 33/89 corresponde a un nuevo test de CORS de
producción: permite el frontend final, rechaza dominios retirados, la URL de la
API, otros subdominios, localhost y wildcard, y comprueba que un login rechazado
no emite cookies ni crea sesiones. La matriz de configuración también verifica
que producción rechace listas de orígenes adicionales o duplicados.

Lint y build del frontend aprobados; se verificó también un build con la URL
final de API y su presencia en el bundle generado. Para construir el frontend del despliegue,
definir `VITE_API_URL=https://api.mertelimportaciones.com/api` en el entorno de
build; el archivo local de desarrollo no se modifica. Los ejemplos ENV no
contienen secretos ni credenciales iniciales. No existe registro público ni
recuperación de contraseña; no se provisionan usuarios en la base real.
Las integraciones ejecutan únicamente sus fixtures existentes en bases
temporales y aplican allí la migración 004, nunca en la base de aplicación.

Archivos del commit de cierre (solo estos siete):

- `backend/.env.example`.
- `backend/src/config/auth.js`.
- `backend/test/auth.test.js`.
- `backend/test/auth.unit.test.js`.
- `backend/test/financialIntegrity.test.js` (solo SameSite explícito del fixture).
- `frontend/.env.example`.
- `docs/FASE_4_6A_AUTENTICACION_SEGURA.md`.

La migración 001 permanece fuera del commit y conserva el hash Git
`e2f0b2c49c979991914a187dc9531d9c5d2117ce` de su modificación local anterior.
La migración 004 se revisa y permanece sin cambios en este cierre. No hay
referencias activas de producción a los dominios retirados; las únicas
referencias añadidas son casos negativos de pruebas que deben rechazarlos.
No se implementan permisos, roles nuevos, aislamiento por empresa, frontend de
login ni WhatsApp, y no se modifican reglas financieras.

Se realiza `git diff --check` y revisión de diff/status antes del commit,
se añaden rutas explícitas y se verifica la exclusión de la migración 001 en el
índice. El hash del commit y el resultado del push se entregan en el reporte
final; no se incrustan en el propio commit.
