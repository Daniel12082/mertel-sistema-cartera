# Personalización — diagnóstico de persistencia

Fecha: 8 de octubre de 2026. Estado: fallo informado no reproducido en el entorno local actual; identificación de causa pendiente de URL y evidencia de la instancia afectada.

## Qué se investigó

Se inspeccionaron AppearanceProvider, contexto, CSS, servicio HTTP, editor Personalizacion, configuración de apariencia, servicio y rutas backend, integración en main/App/MainLayout, contexto MERTEL y pruebas existentes.

No se encontró una condición que descarte colores por conservar la identidad predeterminada. No se modificó código de producción durante este diagnóstico.

## Prueba controlada contra el backend local

Destino: `http://localhost:3000/api/appearance`, usando la autenticación existente de un administrador activo, sin modificar su cuenta, contraseña o permisos.

Antes de la prueba, no existía una fila con `setting_key='visual_appearance'`. GET devolvía legítimamente los predeterminados desde `readValue()` en `backend/src/services/appearance.service.js`.

Con el nombre y descripción predeterminados, se enviaron:

| Campo | Valor |
|---|---|
| primary | `#166534` |
| accent | `#7c3aed` |
| sidebar | `#0c4a6e` |

Resultados:

1. PUT respondió HTTP 200 con los tres colores exactos.
2. SELECT independiente sobre MySQL confirmó los tres colores dentro de `settings.setting_value`, clave `visual_appearance`, company_id 1, fila id 10.
3. GET inmediatamente posterior respondió HTTP 200 y devolvió los mismos valores.
4. Se restauró mediante el PUT existente la apariencia original, que era la predeterminada. Quedó persistida en esa fila de settings y la prueba utilizó la auditoría existente.

Esta prueba demuestra persistencia real del backend local. La inexistencia inicial de la fila indica que los cambios informados no estaban persistidos allí, pero **no demuestra por sí sola por qué**: no hay captura del PUT del intento original ni evidencia de que usara este mismo backend y modo.

## Prueba de navegador con Express y MySQL reales de prueba

Se amplió `frontend/test/e2e/adminDashboard.integration.spec.js`, conservando sus pruebas previas. El esquema MySQL es independiente y se elimina mediante el teardown existente. La base operativa no recibe usuarios, clientes ni facturas ficticios.

La prueba nueva mantiene el nombre «MERTEL» y verifica:

- Inicio de sesión por la autenticación existente.
- Navegación Configuración → Personalización.
- Edición de primary, accent y sidebar.
- Guardar y confirmar la respuesta real del PUT.
- SELECT de la fila persistida con los colores exactos.
- GET independiente inmediatamente después del guardado.
- Dos recargas completas: GET, valores del editor, variables CSS y color computado del sidebar.
- Navegación entre módulos.
- Cierre de sesión y nuevo inicio: colores conservados.
- Restauración explícita y recarga: predeterminados conservados.

Se amplió la prueba existente de logos/simulación para comprobar que los colores sobreviven al guardado de logos y que una recarga en simulación descarta los cambios locales sin solicitudes `/api` ni modificación de la apariencia real. Salir de simulación restaura la apariencia persistida.

## Resultado del diagnóstico

La cadena comprobada funciona en el entorno local actual:

Editor → PUT → servicio backend → settings.visual_appearance → GET → AppearanceProvider → variables CSS → interfaz.

No se ha localizado un primer punto de pérdida en estas reproducciones. No corresponde declarar corregida una causa que no se ha observado. Tampoco se añadió localStorage, tabla, migración, sistema de configuración ni cambio de autenticación, permisos o finanzas.

Para continuar con el fallo original se solicitó al usuario la URL afectada, el mensaje exacto al guardar y si aparece el badge «MODO SIMULACIÓN». Una captura de Request Payload/Response de PUT y Response de GET, sin Authorization ni cookies, permitiría comparar la instancia afectada con la cadena comprobada.

## Validaciones

- Backend: `node --test test/appearance.test.js test/simulationGuard.test.js` — 39 pruebas aprobadas.
- Frontend: `npm test -- --run test/appearance.test.jsx test/settingsCenter.test.jsx test/simulation.test.js` — 26 pruebas aprobadas.
- E2E de apariencia: pruebas con backend y MySQL reales independientes.
- Lint: aprobado.
- Build: aprobado, con la advertencia existente de chunks mayores de 500 kB.
- `git diff --check`: aprobado.

Los tests existentes verifican rechazo de escrituras sin settings.manage, aislamiento de otras compañías/configuraciones y secretos, persistencia de logos, restauración y rollback de configuración si falla la auditoría.

## Archivos modificados en este diagnóstico

- `frontend/test/e2e/adminDashboard.integration.spec.js`: una nueva prueba y comprobaciones adicionales de apariencia dentro de la prueba existente.
- Este informe.

Todos los demás cambios del workspace son preexistentes y se conservaron. Sin staging, commit, push ni `git add .`.
