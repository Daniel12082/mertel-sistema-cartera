# Configuración → Usuarios y scrollbar del sidebar

## Inspección y reutilización

El backend tenía users/user_roles/roles, autenticación, Argon2id, sesiones refresh, el provisioning CLI del primer administrador y GET /api/admin/roles. No existía una API HTTP para gestionar usuarios de trabajadores.

Se reutilizan hashPassword, findUserById, isActiveUser, userRoles, permissionsForRoles, requirePermission, requireCompanyScope y el middleware de autenticación existente. No se alteran auth.service.js, auth.model.js, las definiciones de roles/permisos ni la migración 001.

Los permisos users.* están definidos como previstos, sin habilitar en permissionsForRoles. Como la solicitud exige no cambiar la matriz, se protege el módulo con settings.manage, ya disponible para administradores. El catálogo de roles existente continúa en /api/admin/roles; la nueva respuesta de usuarios incluye solo la intersección de roles físicos existentes y los roles soportados por esa misma política. No se crean roles.

## Endpoints necesarios

- GET /api/admin/users: lista usuarios del contexto MERTEL, incluyendo el administrador original con company_id NULL y rol admin; excluye usuarios de otras empresas y eliminados. Devuelve exclusivamente datos básicos y roles disponibles, nunca hashes/tokens.
- POST /api/admin/users: crea una cuenta activa asociada a MERTEL y asigna roles existentes.
- PUT /api/admin/users/:id: modifica datos básicos y roles; no acepta contraseña, permisos, empresa ni estado.
- PATCH /api/admin/users/:id/status: activa/desactiva mediante active/inactive.

No se duplica una API anterior: no existía. Se conserva el router administrativo y su autenticación/alcance. Las operaciones de creación/edición/estado usan transacciones y auditoría sin contraseñas. Una falla de auditoría revierte el usuario y las asignaciones.

## Creación y edición

Campos soportados: nombre obligatorio (100), apellidos opcionales (100), username opcional (3–50, letras/números/punto/guion/guion bajo), email obligatorio (150), teléfono opcional (50), contraseña inicial y uno o más roles existentes.

La contraseña utiliza el helper actual: no vacía, máximo 1024 bytes, Argon2id. No se inventa una política diferente ni una pantalla de reset. La pantalla de login existente continúa usando correo electrónico; el backend también admite username, pero no se cambia ese flujo.

La edición no cambia la contraseña. Se rechazan duplicados de email/username con un mensaje seguro. La asignación de MERTEL es automática del backend, sin campo company_id ni selector de empresas. Los IDs se recuperan como strings desde MySQL para respetar BIGINT.

No se permite desactivar la propia cuenta ni quitar el propio rol administrativo. La cuenta administrativa original sin company_id conserva su rol admin. Debe permanecer al menos un administrador activo. Las escrituras revalidan al actor dentro de la transacción para no autorizar una petición en espera cuyo acceso haya sido retirado.

Cambiar roles o estado revoca sesiones refresh anteriores. El middleware existente verifica estado y roles actuales en cada petición. Se preservan la estructura, expiración y comportamiento de los access tokens JWT; no se crea otro mecanismo de autenticación. Al editar el perfil propio, se reutiliza refreshIdentity del AuthProvider.

## Interfaz

La sección aparece mediante un enlace en Configuración → Usuarios, sin reorganizar el sidebar ni cambiar rutas existentes. Lista cuentas y estados, abre un formulario modal nativo con foco/teclado y solicita confirmación antes de cambiar estado. Solo muestra roles que el servidor confirma como existentes. Usa las primitivas visuales Panel, Badge y EmptyState del sistema MERTEL, sin nuevas librerías.

## Scrollbar

Solo cambia CSS de .mertel-navigation: scrollbar-width:none para Firefox y navegadores modernos; pseudo-elemento ::-webkit-scrollbar de dimensión cero para Chrome/Edge. Conserva overflow-y:auto, su altura limitada y el sidebar fijo. Overflow-x:hidden evita desplazamiento lateral de escritorio.

El menú mantiene scroll nativo con rueda y navegación/foco por teclado. El contenido principal sigue desplazándose de forma independiente. En móvil se conserva la fila de navegación desplazable que ya existía; no se añaden rutas ni nuevos comportamientos y la barra nativa también queda oculta.

## Validación

Backend: pruebas MySQL aisladas para permisos, alcance MERTEL, administrador original, secretos excluidos, creación/login real, hash Argon2id, edición sin cambio de contraseña, roles existentes, duplicados, estados, revocación de refresh, protección propia y rollback de auditoría. Se verifican tablas financieras sin cambios.

Frontend: listado, enlace desde configuración, permisos, creación sin selector de empresa, roles, contraseña oculta, edición, confirmación y errores/reintento.

E2E: administración crea/edita/desactiva/reactiva un trabajador en una base aislada y luego inicia sesión con esa cuenta usando el backend real. La cuenta sin settings.manage no accede a Usuarios. Sidebar: scrollbar invisible, rueda, foco visible de teclado, menú fijo y scroll del contenido independiente; sin overflow del documento en móvil.

La consulta sobre la base operativa real devolvió únicamente el usuario existente y los roles admin/collector/supervisor. Comparación de checksums de users, roles, user_roles, sesiones, auditoría, empresas, settings y tablas financieras: sin cambios. No se crean trabajadores de ejemplo en la base operativa.

Se detectó una fixture E2E anterior que usaba CURRENT_TIMESTAMP para un payment de prueba y dependía de la zona horaria al cambiar de día. Se corrigió únicamente la fixture para usar UTC_TIMESTAMP; no se cambia el endpoint financiero ni su cálculo.

Resultados: backend completo 280 pruebas; frontend completo 179 pruebas; E2E completo 66 pruebas; lint/build/diff check aprobados. Warnings preexistentes: bundle inicial superior a 500 kB, source-map-js en npm audit, FORCE_COLOR/NO_COLOR y LF/CRLF.

## Archivos de esta tarea

- backend/src/routes/admin.routes.js
- backend/src/services/userManagement.service.js
- backend/test/userManagement.test.js
- frontend/src/App.jsx
- frontend/src/index.css
- frontend/src/pages/Configuracion/Configuracion.jsx
- frontend/src/pages/Configuracion/Usuarios.jsx y Usuarios.css
- frontend/src/services/userManagement.service.js
- frontend/test/usuarios.test.jsx
- frontend/test/e2e/adminDashboard.integration.spec.js
- docs/users-and-sidebar.md

Todos los cambios anteriores se preservan, incluidos los dos archivos aprobados de Historial, provisioning, Dashboard, package.json backend, prueba de resolución y el cambio protegido de migración 001. No hay staging, commit ni push.

Durante la revisión final aparecieron además docs/local-schema-repair-006-008.md y archivos bajo frontend/src/simulation, ajenos a esta tarea. No se crearon, modificaron, eliminaron ni incluyeron como parte de este trabajo.
