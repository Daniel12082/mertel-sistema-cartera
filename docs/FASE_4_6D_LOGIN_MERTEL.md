# FASE 4.6D — Login MERTEL

## Implementación

- `LoginPage`: composición oscura/blanca, logo original adjunto, bienvenida y beneficios.
- `LoginForm`: email/contraseña controlados, campos requeridos, mensajes seguros, loading, bloqueo de doble envío y éxito antes de la navegación.
- `PasswordField`: mostrar/ocultar con botón accesible y autocomplete.
- `ProtectedRoute` / `SessionLoading`: espera de recuperación inicial y protección de todas las rutas actuales.
- `SessionActions`: identidad y cierre de sesión en el encabezado existente.
- Se reutilizan `AuthProvider`, `AuthContext`, `useAuth` y la única instancia Axios de `services/api.js`.
- Modificaciones: `App.jsx`, `MainLayout.jsx` (solo acción de logout), `api.js`, proveedor de autenticación, servicio de identidad, entorno, título/idioma HTML y herramientas de pruebas. Se reutiliza el wiring de `main.jsx` de FASE 4.6B. Los módulos financieros no se editan.

## API y sesión

Login: **POST /api/auth/login**, `{ email, password }`, seguido de **GET /api/auth/me** antes de aceptar la sesión.

`frontend/.env.example`: `VITE_API_URL=https://api.mertelimportaciones.com`. Desarrollo: `http://localhost:3000`. Se mantiene compatibilidad con configuraciones anteriores terminadas en `/api`; el cliente no duplica el prefijo. El `.env.local` existente usa `http://localhost:3000/api` y no se incluye en Git.

Todas las peticiones usan `withCredentials: true`. El access token solo vive en memoria y se agrega como Bearer desde el interceptor. Usuario, nombre, email, roles y permisos se exponen por contexto React. No se escriben tokens, contraseñas ni usuario en localStorage/sessionStorage. La cookie de refresh HttpOnly sigue a cargo del backend.

Refresh: **POST /api/auth/refresh**, una sola petición compartida al arrancar (también bajo StrictMode) o ante 401. Se reintenta la petición original una vez. Una renovación fallida o un segundo 401 invalida la sesión; 403 no renueva. La revisión de sesión impide restaurar sesiones por respuestas tardías. Login y logout se serializan con la rotación de cookie.

Logout: **POST /api/auth/logout** con credentials; limpieza local incluso ante fallo de conexión. Un fallo del servidor se comunica al volver al login. React no intenta eliminar cookies HttpOnly.

Rutas: sin sesión → `/login`; con sesión → acceso a rutas existentes; `/login` con sesión → **`/`**, Dashboard ya existente. No se agregan registro ni creación de usuarios.

## Verificación

- `npm run lint`: correcto.
- `npm run build`: correcto.
- `npm run test`: **21 pruebas** en Vitest / Testing Library, correctas.
- `npm run test:e2e`: **6 pruebas** Playwright Chromium, correctas.
- Cobertura: login/identidad, credenciales incorrectas, requeridos, loading y doble envío, mostrar/ocultar contraseña, logout, rutas, restauración al recargar, 401, renovación concurrente, segundo 401, 403, fallos de conexión, refresh/logout solapados y login durante logout.
- Inspección de capturas a **1672×941, 900×1024, 390×844 y 320×720**. Dos paneles en escritorio/tablet; un panel con logo y formulario en móvil. Sin scroll horizontal. El botón conserva posición y tamaño en loading/error.
- Las peticiones de pruebas se simulan; no se crearon usuarios ni se probaron credenciales reales contra producción/MySQL.
- Sin cambios en backend, migraciones, roles, permisos ni módulos financieros durante esta fase.

## Recursos visuales

Logo: copia exacta de `C:/Users/Daniel/Downloads/LOGO.png` en `frontend/src/assets/login/mertel-logo.png`. La versión sobre fondo oscuro se presenta con un filtro CSS de contraste, conservando el archivo original.

Fondo: `frontend/src/assets/login/login-office.png`, generado con la herramienta integrada `imagegen`. Prompt: “Create a photorealistic premium enterprise login background asset, portrait 1024x1536. A very dark graphite executive office with subtle red accent lighting. Laptop on a black desk on the RIGHT HALF, screen showing a white accounts receivable financial dashboard with red bar charts and red donut chart, no legible text. Dark black coffee cup and a stacked closed notebook at bottom right, soft silhouette of houseplant behind laptop. Upper left and middle left must be almost empty dark negative space for HTML branding and headline overlay. Laptop occupies middle-right to bottom-right. Elegant cinematic studio photography, realistic details, deep blacks, slight red rim lighting. No logos, no typography, no watermark, no UI outside the laptop, no floating icons. This is only an atmospheric background photograph for a Mertel internal finance login, not a screenshot of a whole login page.”

Capturas de revisión en `tmp/login-desktop.png`, `tmp/login-tablet.png`, `tmp/login-mobile.png`, `tmp/login-small-mobile.png` (ignoradas por Git).

## Git

Commit de implementación verificado: `066118ee78906de23855b979c30ab3f85a5fecdc`, `feat: implementar login de MERTEL`. Está incluido en `origin/main`, cuyo HEAD remoto al iniciar la auditoría de cierre es `8609585e74caf075b85db2e0beb384f675d008c0`.

El repositorio tenía cambios locales previos en backend, migraciones y configuración de roles. El chat concurrente de FASE 4.6B terminó su commit `631c6d1` y push antes de preparar el commit de login, excluyendo los cambios de esta fase. FASE 4.6D se apoya sobre ese commit y conserva su configuración y componentes base. Solo se incluyen los cambios de login. La modificación previa de `database/migrations/001_initial_schema.sql` permanece fuera del commit y no fue editada.

## Auditoría de cierre — 2 de octubre de 2026

Estado: COMPLETA CON OBSERVACIONES. El propietario autorizó expresamente el cierre y el commit selectivo de las correcciones verificadas. La prueba funcional con el administrador real continúa pendiente; no se presenta como realizada.

### Alcance y hallazgos

Se revisaron LoginPage, LoginForm, PasswordField, ProtectedRoute/SessionLoading, SessionActions, AuthProvider/AuthContext/useAuth, main.jsx, App.jsx, MainLayout, servicios de auth/API, ejemplos de entorno y pruebas de frontend. En backend se revisaron app.js, configuración auth, rutas/controladores/servicios/modelos auth, middleware de autenticación/permisos y hashing de contraseñas. No se editaron backend, módulos financieros, cobranza, esquema, usuarios ni contraseñas.

La sesión procede de login y /me o de refresh validado por el servidor. ProtectedRoute controla navegación, mientras el backend exige JWT, usuario activo y permisos; todos los montajes financieros rechazan llamadas directas sin autenticación. Las credenciales incorrectas y usuarios inactivos/eliminados reciben el mismo 401 genérico. Los 403 no provocan refresh. El access token permanece en memoria, sin localStorage/sessionStorage.

La cookie refresh es HttpOnly, host-only y Path=/api/auth. Secure es obligatorio en producción; SameSite se configura explícitamente mediante ENV. Para https://mertelimportaciones.com y https://api.mertelimportaciones.com corresponde lax: son cross-origin pero same-site. CORS admite únicamente el frontend final en producción y permite credentials. La rotación mantiene la expiración absoluta y detecta reutilización. Logout revoca la familia refresh y elimina la cookie; un access JWT ya emitido puede seguir siendo válido hasta su expiración si el usuario permanece activo. No se cambió esta regla.

Se detectaron dos fallas directamente relacionadas con el cliente auth: los errores Axios retenían Authorization/cuerpo de login en sus metadatos, y una configuración de producción sin VITE_API_URL podía utilizar el fallback local.

### Correcciones

- services/api.js elimina Authorization, Cookie, auth, cuerpo y objeto request de los metadatos de errores Axios que llegan a los consumidores. Se aplica después del manejo de refresh/reintento para preservar ese flujo; mantiene status y respuesta de error. No se editaron los módulos que imprimen errores.
- services/api.js exige VITE_API_URL en producción y HTTPS; valida origen sin credenciales, query, fragmento ni rutas ajenas al prefijo opcional /api. Conserva el fallback http://localhost:3000 solo en desarrollo y la compatibilidad con URLs terminadas en /api.
- frontend/.env.example documenta esas restricciones, sin modificar archivos .env locales.
- test/api.test.js añade cuatro pruebas necesarias para estas fallas: metadatos sin Bearer, errores sin contraseña, rechazo de configuración insegura y compatibilidad de configuración válida. Las dos pruebas de filtración fallaron sobre la implementación previa y pasaron después de la corrección.

### Verificación ejecutada

- Backend completo, npm test: 138/138, sin fallos ni omisiones; incluye auth, autorización, aislamiento empresarial y regresiones existentes. Integración MySQL en esquemas temporales generados y retirados por las pruebas, sin migraciones sobre la base de aplicación.
- Frontend final, npm test: 25/25 en dos archivos.
- E2E final, npm run test:e2e: 6/6 Chromium; API simulada. Incluye login/me, recuperación al recargar, logout, redirecciones, campos, teclado y cuatro tamaños de pantalla. No sustituye la prueba del administrador real.
- npm run lint: correcto.
- npm run build con VITE_API_URL=https://api.mertelimportaciones.com: correcto; el bundle contiene ese origen. No se desplegó producción.
- git diff --check: correcto al revisar las correcciones; el cambio previo de 001 permanece intacto.
- Revisión de secretos: comparación del JWT_SECRET y DB_PASSWORD locales contra 123 archivos versionados actuales y 1417 blobs de historial accesible, además de patrones de claves privadas y tokens conocidos. No se encontraron esos secretos ni credenciales reales en el alcance revisado; la coincidencia de clave privada en documentación histórica de dotenv corresponde a ejemplos incompletos con puntos suspensivos. Los archivos .env locales no están versionados. Este escaneo no certifica la ausencia de cualquier formato posible de secreto.

### Prueba funcional local y pendientes

Se inició temporalmente el API en loopback:3000 con NODE_ENV=development, origen http://localhost:5173 y SameSite=lax suministrados únicamente al proceso. El frontend local apunta al API local. No se modificaron .env ni producción. La página de login abrió correctamente y un intento inválido contra el backend real mostró el mensaje genérico esperado.

Se verificaron además llamadas GET directas sin Bearer a /api/auth/me, customers, invoices, payments, payments/1/allocations, portfolio, admin/roles y admin/companies: las ocho devolvieron 401. El preflight local de refresh devolvió 204, origen explícito y credentials=true.

El acceso válido con el administrador existente requiere que el propietario introduzca su contraseña directamente en el navegador. Se dejó el formulario preparado y se solicitó ese paso; no se conoce, solicita por chat, imprime ni cambia su contraseña. Hasta completar ese paso, siguen pendientes el panel real, /me, recarga y logout de esa identidad. Las comprobaciones automatizadas de esos flujos ya pasaron con fixtures/API simulada.

El propietario autorizó expresamente un commit selectivo y push a origin/main con el mensaje feat: cerrar login y gestion de sesion. Solo se incluyen frontend/src/services/api.js, frontend/test/api.test.js, frontend/.env.example y este informe. El cambio local previo de database/migrations/001_initial_schema.sql permanece intacto y excluido; no se ejecuta git add . ni se revierte o stagea ese archivo. El hash y la confirmación del push se entregan en el reporte de cierre.
