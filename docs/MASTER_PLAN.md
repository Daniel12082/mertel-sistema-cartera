# Plan maestro MERTEL

Actualizado: 05/10/2026. Producto exclusivo: MERTEL Importaciones — Sistema de Cobranza. **La orden vigente autoriza Fase 5.1: panel operativo y preparación de mensajes WhatsApp sin envío. No autoriza Fase 5.2 ni integración externa**.

## Dónde estamos

- Cerradas: 4.6D autenticación/sesión, 4.7A backend, 4.7B frontend, 4.7 cobranza de consulta y 4.8 en su alcance técnico autorizado.
- Base de implementación: `main`, commit `53a9a1093073076f5a0d4ba00ae7924c3b1c2af5`, mensaje `feat: implementar cobranza MERTEL`.
- Base de Fase 5: `2db4e231835319b1348542fc2e60d4951c5c4cd9`, cierre publicado de gestión manual 4.9.
- Estado actual: **4.9 IMPLEMENTADA Y VALIDADA en su alcance manual**, ver [informe de implementación](architecture/MERTEL_PHASE_4_9.md). Incluye registro/consulta de promesas por autorización expresa; su ciclo de cumplimiento y automatización continúa futuro. No se aprueba un catálogo comercial por usar texto libre.
- Salvedad de 4.7: consulta autenticada con datos reales de MERTEL no disponible. Inspección local 05/10/2026: cero compañías, settings comerciales legacy NULL y sin collection_rules; no crear datos para aparentar validación real.
- Archivo protegido: `database/migrations/001_initial_schema.sql` con cambio local previo; nunca editar, revertir ni incluir en commit de estas órdenes. Hash de contenido auditado: `e2f0b2c49c979991914a187dc9531d9c5d2117ce`.
- Base de 5.1: `75cd3d0a43897d6844ca6c00635ca503752757ba`, reglas comerciales publicadas. Panel, plantillas y preparación: [informe 5.1](architecture/MERTEL_PHASE_5_1.md). La numeración de la orden actual sustituye el antiguo 5.1 de importación; importación y ciclo automático de promesas siguen pendientes, sin activarse.

## Qué leer antes de continuar

1. [Reglas oficiales](business/MERTEL_COBRANZA_RULES.md): hechos confirmados y restricciones financieras.
2. [Decisiones pendientes](business/MERTEL_DECISIONS_PENDING.md): preguntas D01–D35 y verificaciones T01–T06.
3. [Auditoría/matriz](architecture/MERTEL_AUDIT_POST_4_7.md): estado de módulos, contradicciones C01–C08, evidencia y deuda.
4. [Arquitectura](architecture/MERTEL_COLLECTION_ARCHITECTURE.md): fronteras existentes/propuestas, acoplamientos y pruebas futuras.
5. [Roadmap 4.8–6.0](roadmap/MERTEL_ROADMAP.md): objetivos, dependencias, riesgos y cierre por fase.

Documentos de fases anteriores y VALIDACION-4.7.md son evidencia histórica, no una fuente para reemplazar las nuevas reglas. Resolver conflictos con esta documentación y la última instrucción del usuario, sin cambiar silenciosamente el negocio.

| Fase | Trabajo previsto | Estado |
|---|---|---|
| 4.8 | Reglas reales de cobranza | CERRADA; activación de Pronto Pago pendiente |
| 4.9 | Gestiones, promesas manuales, historial y borrador temporal | IMPLEMENTADA Y VALIDADA; contexto real pendiente |
| 5 | Reglas comerciales confirmadas, beneficios independientes y facturas no vencidas | Implementación y validación documentadas en el informe específico |
| 5.0 | Activación de reglas comerciales reales (orden vigente) | CERRADA en el alcance de Fase 5; ciclo automático de promesas pendiente |
| 5.1 | Panel operativo, plantillas, vista previa y preparación sin envío | IMPLEMENTADA Y VALIDADA; empresas/plantillas reales aún no configuradas |
| 5.2 | Motor operativo de cobranza | FUTURA |
| 5.3 | Mensajería/WhatsApp | FUTURA |
| 5.4 | Pagos y reevaluación | FUTURA |
| 5.5 | Reportes y métricas | FUTURA |
| 5.6 | Configuración administrativa | FUTURA |
| 5.7 | Auditoría/endurecimiento | FUTURA |
| 6.0 | Producción MERTEL | FUTURA |

## Alcance autorizado de 4.8

1. Contrastar los pendientes necesarios con respuestas de Cartera antes de activar su parte: tipo/límites de días, selección sin vencidos/desempates, productos/revisión y permanencia entre ventanas.
2. Preservar una sola tarjeta por cliente y corregir selección para la factura más atrasada, abandonando proximidad absoluta a referencia como criterio comercial. Revisar orden de clientes, no solo el main_invoice.
3. Garantizar jerarquía configurable En mora > Vence hoy > Faltan 5 días > Pronto pago. No deducir magnitudes de prioridad de 10/20/30/40 en tests.
4. Sustituir la interpretación de Pronto Pago como days_before_due por ventana desde emisión, únicamente con límites/calendario aprobados. Separar clasificación, elegibilidad de descuento y finanzas.
5. Diseñar configuración central y presentación de etiquetas/etapas coherente con el backend, manteniendo compatibilidad de `/api/collection`. No declarar hoy un nuevo contrato definitivo.
6. Registrar 3% antes de IVA como regla confirmada; no confundir con 10% condicionado ni promo_18. No aplicar automáticamente descuentos ni exclusiones desconocidas; factura mixta exige revisión manual definida.
7. Actualizar pruebas que actualmente acreditan comportamiento contrario (C01/C02), añadir regresiones de reglas autorizadas y mantener las financieras/auth/permissions.
8. Documentar pendientes restantes sin presentarlos como implementados. No cerrar una subparte comercial si está bloqueada por una decisión necesaria.

No incluye gestiones, promesas, mensajería, importación, nuevos pagos ni administración operativa futura. Las brechas de coordinación se asignan a las fases del roadmap, no se implementan aprovechando 4.8.

## Autonomía futura

La autorización de una fase o modo autónomo debe venir del usuario. Dentro de esa fase se pueden tomar decisiones técnicas de estructura, refactor mínimo necesario, tests, componentes, servicios, validaciones y arquitectura interna. Un refactor no justifica ampliar funcionalidad ni saltarse un pendiente comercial.

Nunca inventar descuentos, prioridades comerciales, fechas de corte, horarios, límites, criterios financieros, calendarios, WhatsApp, pagos o reglas de importación. Una decisión abierta se marca **PENDIENTE** y se detiene esa parte dependiente; se puede continuar con trabajo independiente autorizado. Preguntar por los IDs concretos que bloquean la fase, sin solicitar de nuevo hechos ya confirmados ni convertir toda la lista en un cuestionario obligatorio simultáneo.

No crear compañías, facturas, reglas, pagos, usuarios o tokens artificiales en la base real para conseguir un resultado. Las fixtures son exclusivamente pruebas aisladas y nunca evidencia de operación MERTEL. No enviar mensajes, desplegar ni escribir a servicios externos por una propuesta de arquitectura.

Prohibido SaaS/Hostify, suscripciones, billing, marketplace y provisioning comercial. Mantener companyScope como seguridad. `invoices.balance` sigue siendo la verdad financiera; respetar locks, allocations, soft delete, reversión y reallocation.

## Validación y cierre por fase

- Revisar git status/diff, reglas oficiales, decisiones y alcance antes de editar.
- Backend: npm test, atendiendo pruebas omitidas y disponibilidad de MySQL; sus suites de integración usan bases desechables, no la base de negocio.
- Frontend: npm test, npm run lint y npm run build cuando se modifica comportamiento. E2E de login/cobranza y nuevos flujos cuando corresponda; comprobar responsive y errores.
- Validar contrato/API, permisos, companyScope, invariantes financieros y ausencia de efectos inesperados. Probar fechas, bordes aprobados, concurrencia e idempotencia según fase.
- Comparar con contexto autorizado real cuando exista; reportar exactamente si no estuvo disponible. La excepción usada para el cierre técnico de 4.7 no se extiende automáticamente a cualquier fase futura.
- No declarar una fase cerrada con fallos, código comercial no aprobado o parte obligatoria no implementada. Registrar evidencia y pendiente con su impacto.
- Actualizar este plan, matriz y documentación al cerrar cada fase; no marcar etapas futuras completas por existir una tabla.

## Cuándo hacer commit y push

Solo cuando la instrucción vigente lo autorice y se hayan cumplido sus criterios. No suponer que leer este plan autoriza publicar cualquier cambio. La orden 4.8 autoriza commit/push selectivo de esa implementación si pasan todas las validaciones; no commit parcial ante un fallo. La migración preexistente permanece excluida. La representación pending de calendario/límites está autorizada expresamente, sin transformar esos parámetros en decisiones aprobadas ni activar descuentos.

Usar staging por archivos exactos; jamás git add . ni git add ... No incluir .env, node_modules, temporales, capturas, código ajeno o migración 001. Revisar diff --check y diff --cached --check, inspeccionar inventario y diff staged, verificar exclusiones y evitar commits mezclados. Ante modificaciones ajenas adicionales, no mezclarlas y reportar el conflicto antes de publicar.

Tras commit/push autorizado a origin/main, verificar status, log, HEAD, origin/main y estado remoto; reportar hash real y archivos pendientes. Si falla el push, no afirmar sincronización ni forzarlo para ocultar el fallo. La única diferencia local conocida en esta auditoría es la migración protegida.

## Riesgos y deuda priorizada

Prioridad de trabajo técnico, no prioridad comercial de clientes:

- 4.8: selección/jerarquía/orden/labels corregidos; evaluador desde emisión y cálculo puro implementados. Quedan decisiones de calendario/límites, datos de productos y redondeo/registro financiero antes de activar beneficio real.
- 4.9–5.2: historial y registro manual implementados; pausa por promesa, contrato seguro de importación y estado operativo continuo siguen pendientes.
- 5.3–5.6: falta proveedor, cuotas aprobadas, fuentes de métricas y edición/configuración auditada; evitar políticas dispersas.
- 5.7: revisar precisión monetaria del helper de descuento, conversiones BIGINT, auditoría integral, escala de lectura y efectos de referencias huérfanas.
- 6.0: falta contexto real autorizado y evidencia de configuración/datos de producción; no confundir push con deploy.

El entregable de la orden actual es la implementación manual acotada de 4.9 y su validación. La autorización incluye commit/push selectivo si todas las pruebas pasan, preservando la migración protegida. No incluye evaluación de promesas, automatización, pagos, importación ni envío.

## Histórico: verificación documental previa del 05/10/2026

Backend npm test: **148/148**, sin omisiones. Frontend npm test: **51/51**. Lint y build: **OK**. E2E existente se revisó como cobertura, sin nueva ejecución por tratarse de cambios exclusivamente documentales; el resultado histórico de 4.7 fue 12/12 y no se presenta como nueva ejecución.

El inventario de esta orden consta de seis documentos nuevos: este plan, reglas, decisiones, auditoría, arquitectura y roadmap. Los resultados de commit/push y hashes se comprueban después de publicar y se entregan en el reporte final; este archivo no afirma una publicación que no se haya verificado. No se implementó 4.8 ni ninguna otra fase futura.

## Cierre técnico de 4.8 — 05/10/2026

4.8 CERRADA según el alcance autorizado: factura más atrasada y orden backend, jerarquía/configuración ordinal, Pronto Pago desde emisión con diez días y tipo/límites pending, 3% matemático antes de IVA, productos/revisión separados y catálogo API/UI. El estado pendiente del calendario está implementado deliberadamente y no significa concesión del beneficio. No se declaran resueltos D01–D06/D24–D27, ni aplicación financiera del descuento.

Backend 165/165, frontend 53/53, lint/build OK y E2E 13/13. API HTTP/MySQL y read-only verificados en base aislada; health 200/401 local sin autenticación. Validación contra datos reales MERTEL no disponible (cero compañías y reglas en la base autorizada). Sin migraciones ni cambios de pagos/allocations/auth/roles.

La siguiente fase de implementación es 4.9 — Gestiones e historial, únicamente bajo autorización posterior y con catálogo/roles definidos (D08/D35). Antes de activar Pronto Pago real obtener aprobación del calendario/límites y fuente/exclusiones de productos, revisión manual y política financiera/redondeo. No habilitar mensajes, promesas, importación ni flujos financieros para resolver esos pendientes.

## Actualización autorizada de 4.9 — 05/10/2026

La orden posterior permite texto libre extensible para el tipo de gestión y registro manual de promesas pendientes con permisos existentes. Esta precisión sustituye la dependencia anterior de catálogo aprobado para el registro básico y adelanta exclusivamente registro/consulta desde 5.0. D08/D35 y todas las reglas de cumplimiento, prioridad y mensajería siguen abiertas. Backend 176/176, frontend 68/68, lint/build OK y E2E 15/15. El informe 4.9 detalla contrato, inventario y limitación de datos reales. Ninguna fase posterior se inicia.

## Fase 5 — autorización posterior del 05/10/2026

La orden Fase 5 sustituye los pendientes de calendario/límites de Pronto Pago: diez días calendario desde issue_date, días 0 a 10 incluidos. El usuario confirmó después redondeo al peso colombiano entero, convencional half-up; no a dos decimales. 3% sobre base_value antes de IVA, sin aplicar al saldo.

Configuración aprobada: [JSON empresarial version 2](../backend/config/mertel-collection-rules.json), para settings.collection_rules de la empresa real autorizada. Es una configuración oficial lista para instalar, no un seed ni fallback de settings NULL. Sin empresa real no se crea ni inserta ninguna configuración de negocio. El API continúa devolviendo no_rules_configured donde no haya setting empresarial.

Se contemplan exclusiones confirmadas y promo_18, beneficio condicionado 10% en días 60–70 inclusivos, jerarquía/cliente único y agrupación operativa Facturas no vencidas. Los datos de productos siguen ausentes; la evaluación no concede beneficio por ausencia de exclusiones. Ventanas 0–10 y 60–70 no se solapan: la coexistencia comercial/financiera permanece pendiente y se representa sin sumar porcentajes ni alterar balance. Gestiones/promesas de 4.9 se preservan. Ver [informe de Fase 5](architecture/MERTEL_PHASE_5.md).

Los apartados de autorización/cierre 4.8 y 4.9 anteriores son históricos. No habilitan automatización, cumplimiento de promesas, aplicación financiera de descuentos, WhatsApp ni Fase 6.
