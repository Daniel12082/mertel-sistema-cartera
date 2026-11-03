# Centro de Configuración y Personalización MERTEL

## Organización

`/configuracion` es la portada con ocho tarjetas, sin contadores inventados. `/configuracion/:category` conserva una navegación interna visible en desktop y un selector en móvil. La aplicación mantiene una sola entrada principal «Configuración». Las rutas administrativas anteriores siguen funcionando.

| Categoría | Disponibilidad y fuente |
| --- | --- |
| General | Nombre real del contexto MERTEL resuelto por el servidor, identidad visual y formatos de presentación actuales. COP, español de Colombia y Bogotá son información de los formatos existentes, no preferencias editables nuevas. |
| Cobranza | Componente `CollectionSettings`, GET `/api/admin/settings` y PUT `/api/admin/settings/collection-rules`. Las mismas cuatro etapas y reglas comerciales, sin alterar prioridad, 3%, redondeo ni beneficio informativo del 10%. |
| Usuarios | Componente `Usuarios`, `/api/admin/users` y catálogo `/api/admin/roles`. Crear/editar/activar/desactivar existentes; permisos como consulta secundaria. Sin último acceso inventado. |
| WhatsApp | Componente `WhatsAppCenter` y sus servicios existentes: conexión, proveedor, credenciales enmascaradas, automatizaciones, mensajes e historial. MOCK sigue identificado como simulado. |
| Mensajes | Enlace a `/administracion/plantillas-whatsapp`: plantillas y variables del módulo existente. |
| Importaciones | Enlaces a `/administracion/importar-cartera` y `/administracion/resolucion-clientes`. No se duplica análisis, conciliación ni resolución. |
| Sistema | GET `/api/health` y `/api/health/db`: únicamente disponibilidad de API y base de datos. En simulación no se consultan servicios reales. |
| Personalización | Editor de identidad, logos y seis colores, preview inmediato y restauración confirmada. |

No se agregan preferencias de horarios/promesas, cuotas, compañías, roles ni campos sin soporte. El centro requiere `settings.manage`, y los enlaces conservan además el permiso original del módulo de destino.

## Persistencia visual

No existía API ni almacenamiento de logos para esta finalidad. Se añadió únicamente GET/PUT `/api/appearance`, con autenticación y el contexto MERTEL existente. GET entrega solo identidad y colores seguros para que todos los trabajadores reciban la apariencia común; PUT exige `settings.manage`. No se modifica la matriz de permisos ni la autenticación.

Se reutiliza `settings`: una fila JSON `visual_appearance` por MERTEL. Leer valores predeterminados no inserta datos. Guardar bloquea el contexto, comprueba de nuevo los permisos actuales y guarda configuración y auditoría en la misma transacción. Un fallo de auditoría revierte la actualización. Una solicitud idéntica no repite auditoría. Restaurar envía solamente el documento visual predeterminado; no borra otras configuraciones.

Los logos se almacenan como imágenes raster pequeñas codificadas dentro de esa misma fila. No hay archivos subidos en Git, proveedor externo ni tabla nueva. Se admite PNG/JPG/WebP, máximo 20 KiB por logo y 2048 × 2048 píxeles. Se comprueban tamaño, formato, cabeceras y dimensiones en backend, y decodificación en navegador. SVG, HTML, JavaScript, URLs externas y CSS arbitrario se rechazan. El límite total de 60 KiB respeta la columna TEXT existente y el parser JSON actual. Imágenes mayores necesitan preparación previa; no se instaló una librería de transformación.

La auditoría registra actor usuario, cambios de identidad/colores y huellas SHA-256 de logos, evitando copiar las imágenes en registros históricos. Ningún secreto se consulta ni se incluye.

## Tema y simulación

`AppearanceProvider` utiliza variables CSS `--mertel-primary`, `--mertel-accent`, `--mertel-sidebar`, `--mertel-background`, `--mertel-surface`, `--mertel-text`, conectadas a las variables existentes. El CSS central adapta superficies y controles; los colores semánticos de éxito/advertencia/error permanecen independientes. Texto sobre fondo/tarjetas debe alcanzar contraste 4.5:1. Los colores de texto de botones y sidebar se calculan para su fondo.

El nombre, subtítulo y logos del espacio autenticado provienen del tema. La pantalla previa al inicio de sesión conserva la identidad predeterminada: no se expone configuración administrativa sin autenticación. La preview no implica persistencia; salir del editor descarta cambios sin guardar.

En simulación el proveedor no carga ni guarda apariencia real. La configuración visual temporal permanece en memoria, sigue disponible al navegar dentro de la demo y se descarta al reiniciar, recargar o salir. La apariencia real en caché se restaura al salir y se vuelve a consultar de forma autenticada. El transporte y el rechazo de `X-Mertel-Simulation` existentes permanecen intactos.

## Archivos de esta fase

- Backend: `src/app.js`; nuevos `src/config/appearance.js`, `src/services/appearance.service.js`, `src/routes/appearance.routes.js`, `test/appearance.test.js`.
- Frontend: `src/App.jsx`, `src/main.jsx`, `src/layouts/MainLayout.jsx`, `src/pages/Configuracion/Configuracion.jsx`; nuevos `src/pages/Configuracion/Personalizacion.jsx`, `SettingsCenter.css`, `src/appearance/AppearanceProvider.jsx`, `appearance.context.js`, `appearance.css`, `src/services/appearance.service.js`. En `CollectionSettings.jsx` se añadió retry de lectura; en `WhatsAppCenter.jsx` el retry limpia el error anterior. No se cambia la lógica de guardado de estos módulos.
- Pruebas: nuevos `frontend/test/settingsCenter.test.jsx`, `frontend/test/appearance.test.jsx`; ajustes de navegación en `frontend/test/usuarios.test.jsx` y ampliación de `frontend/test/e2e/adminDashboard.integration.spec.js`. Los fixtures de `messageTemplatesAdmin.spec.js` y `simulation.spec.js` contemplan la lectura común de apariencia y respuestas de WhatsApp/plantillas con su contrato correcto.
- Este documento.

Las modificaciones preexistentes de Dashboard, Historial, Usuarios, simulación, importaciones, migración 001, backend/package.json y reparación 006/008 se preservaron. No se hace staging, commit ni push.

## Validación

- Backend completo: 319 pruebas aprobadas, incluyendo 6 casos nuevos de apariencia con MySQL desechable.
- Frontend completo: 214 pruebas aprobadas.
- E2E relacionados: 17 aprobados, incluyendo las ocho categorías a 390/768/1024/1366/1920 px, sin overflow, y el recorrido navegador → API → settings → recarga → simulación → restauración.
- Snapshots financieros, roles, usuarios y otras configuraciones comparados en bases de prueba: sin cambios por personalización.
- Revisión visual de portada desktop y editor móvil mediante capturas locales en `tmp` (fuera del código de producto).
- Lint y build aprobados. Persiste el aviso existente de chunks de más de 500 kB.

La primera regresión encontró un fallo transitorio de un test preexistente de token de importación; su suite aislada y la segunda suite backend completa pasaron sin modificar ese flujo. Se corrigió una carrera de la caché del editor: espera la lectura actual antes de montar el formulario.

La regresión E2E completa pasó 73 casos. Tres assertions previas de plantillas se actualizaron para contemplar GET `/api/appearance` y comprobar explícitamente que no haya escrituras visuales. Un fixture de salida de simulación respondía `[]` a WhatsApp, contrario a su contrato; se corrigió la respuesta de prueba, sin modificar las operaciones de WhatsApp ni silenciar errores.

Git: rama `main...origin/main`, índice vacío y HEAD anterior `0269323`. El árbol contiene los cambios locales previos y los de esta fase, sin commit ni push. Los hashes de `backend/package.json`, migration 001, los dos archivos aprobados de Historial y `collectionDashboard.test.jsx` coinciden con el estado previo. `git diff --check` pasa; los avisos LF/CRLF son de la política de Git existente.
