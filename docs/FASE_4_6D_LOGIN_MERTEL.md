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

Commit previsto: `feat: implementar login de MERTEL`; push a `origin main` según la solicitud. El hash y resultado definitivo se reportan en el chat después de ejecutar ambas operaciones.

El repositorio tenía cambios locales previos en backend, migraciones y configuración de roles. El chat concurrente de FASE 4.6B terminó su commit `631c6d1` y push antes de preparar el commit de login, excluyendo los cambios de esta fase. FASE 4.6D se apoya sobre ese commit y conserva su configuración y componentes base. Solo se incluyen los cambios de login. La modificación previa de `database/migrations/001_initial_schema.sql` permanece fuera del commit y no fue editada.
