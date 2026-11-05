# Seguridad — revisión del 4 de noviembre de 2026

Cambios: HTTPS obligatorio cuando las cookies son Secure, no-store global, ocultar X-Powered-By, límite de 300 solicitudes/minuto/IP y límite de renovación de sesión. Diagnóstico de MySQL requiere autenticación.

Estado de los 20 requisitos:
1. Variables locales ignoradas por Git; falta escaneo exhaustivo de secretos en archivos e historial.
2. No hay .env reales versionados actualmente; no se ha reescrito el historial ni rotado credenciales. Requiere inventario de exposiciones.
3. MySQL usa credenciales privadas del backend. No corresponde publicar una key de base de datos.
4. Hay alcance por empresa en aplicación; no equivale a RLS nativa. Falta auditoría completa de consultas y aislamiento.
5. Falta inventario de datos sensibles y plan de cifrado/migración y custodia de claves.
6. Rutas financieras autenticadas; diagnóstico de DB ahora autenticado.
7. Existen permisos y alcance por empresa; falta revisar todas las operaciones y casos cruzados.
8. Falta auditoría completa de listas de campos permitidos.
9. Cookies existentes HttpOnly, Secure en producción y SameSite configurado.
10. Contraseñas existentes Argon2id.
11. Límites de login existentes; nuevos límites generales y refresh. Almacenamiento en memoria: requiere almacén compartido para varias instancias.
12. Límites reducen abuso; CAPTCHA/WAF y protección distribuida siguen pendientes.
13. Falta auditoría exhaustiva de parametrización y SQL dinámico.
14. Validación de login existente; falta revisión integral de inputs.
15. No se encontró dangerouslySetInnerHTML en frontend; falta auditoría de exportaciones y otros destinos.
16. Falta revisión integral de cargas de archivos, tamaño descomprimido y tipos reales.
17. Respuestas de autenticación mínimas existentes; falta revisar otros endpoints.
18. Helmet existente; no-store y ocultamiento de framework añadidos. Revisar también hosting frontend.
19. API rechaza HTTP en producción; certificados y proxy deben configurarse en infraestructura. TRUST_PROXY_HOPS debe coincidir con proxies reales.
20. npm audit --omit=dev detectó 11 hallazgos backend (1 alto) y 10 frontend (1 alto). Remediación pendiente; no se aplicaron downgrades automáticos de ExcelJS.

Esta revisión es parcial y no certifica el cumplimiento de los veinte requisitos. No se modificó producción ni el historial Git.

## Segunda intervención
- Actualizaciones compatibles de dependencias en ambos paquetes: eliminados hallazgos altos. Frontend con herramientas de desarrollo: 13 moderados pendientes; backend: 8 moderados incluyendo desarrollo. Persisten dependencias transitivas de ExcelJS y herramientas; no se forzaron versiones incompatibles.
- Clientes: rechazo de campos desconocidos, límites de texto, validación de correo, estado e importes y rechazo de caracteres de control.
- Controladores: retirados objetos de excepción de logs para evitar exponer SQL y valores sensibles.
- Pruebas de diagnóstico actualizadas para exigir autenticación; pruebas de producción simulan HTTPS detrás de un proxy explícitamente confiable.
- Continúan pendientes el inventario/rotación de secretos, saneamiento del historial, cifrado integral con migración, auditoría completa de autorización y cargas, y protección distribuida contra bots.

## Tercera intervención
- XLSX: validación previa del ZIP, máximo 10 MiB comprimidos, 50 MiB expandidos, 20 MiB por entrada y 2000 entradas. Rechaza archivos cifrados, macros, vínculos externos, archivos incrustados y rutas peligrosas. Comprueba tamaño real al descomprimir antes de ExcelJS.
- Facturas y pagos: listas explícitas de campos admitidos y límites de texto; campos calculados conocidos siguen ignorados por el modelo para conservar compatibilidad con las ediciones existentes.
- Validación: 37 pruebas de integridad financiera, 10 pruebas de importación/conciliación y una prueba específica del archivo XLSX aprobadas.
- El escaneo de historial por patrones no sustituye un inventario de credenciales ni demuestra ausencia de secretos; excluye dependencias y blobs mayores de 2 MB.
- Verificación adicional: 14 pruebas de autorización y alcance de empresa aprobadas. Se actualizó la expectativa del diagnóstico DB para exigir sesión.
- Escaneo histórico completado: 852 blobs revisados, sin coincidencias de patrones de claves privadas, tokens de proveedor y claves AWS. Resultado en security-secret-scan.json. Este alcance limitado no detecta contraseñas arbitrarias, todos los proveedores ni secretos locales ignorados. No hubo secretos confirmados que justificaran reescribir historial.

## Adaptación para desarrollo local
- API y frontend de desarrollo escuchan en 127.0.0.1 por defecto. La API permite HOST explícito; producción conserva enlace a todas las interfaces.
- El frontend de desarrollo/preview incorpora cabeceras contra interpretación de tipos, marcos y envío de referente, y evita caché. No se fuerza HSTS en HTTP local.
- JSON limitado explícitamente a 100 KB; rechazo de claves de prototipo, profundidad superior a 20, más de 10000 nodos y caracteres de control no imprimibles. Se conserva texto de negocio sin transformaciones destructivas.
- UUID actualizado mediante override en frontend, igual que el override existente del backend; frontend queda con 12 alertas moderadas incluyendo desarrollo.
- Cuatro pruebas específicas de estructura de solicitudes, transporte HTTPS y archivos aprobadas.
- HTTP local continúa permitido con cookies HttpOnly/SameSite; Secure y HTTPS se exigen en producción.
- Validación final local: 79 pruebas de integración backend aprobadas; compilación frontend correcta. Suite frontend inicial: 247/256 aprobadas, 9 fallos (timeouts y foco). Repetición de los 5 archivos afectados con máximo 2 workers: 48/48 aprobadas. No se cambiaron pruebas para ocultar fallos.
- Límites: no se implementó cifrado de todos los datos personales ni se reescribió Git; quedan alertas moderadas y revisión integral pendiente. Los controles locales no certifican producción.
