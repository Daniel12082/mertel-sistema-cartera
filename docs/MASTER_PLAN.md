# Plan maestro MERTEL

Actualizado: 05/10/2026. Producto exclusivo: MERTEL Importaciones — Sistema de Cobranza. Este archivo orienta trabajo futuro; **no inicia 4.8 ni autoriza implementar todo el roadmap automáticamente**.

## Dónde estamos

- Cerradas: 4.6D autenticación/sesión, 4.7A backend, 4.7B frontend y 4.7 cobranza de consulta.
- Base de implementación: `main`, commit `53a9a1093073076f5a0d4ba00ae7924c3b1c2af5`, mensaje `feat: implementar cobranza MERTEL`.
- La orden actual es auditoría, formalización comercial y arquitectura/roadmap; solo crea documentos.
- Siguiente fase: **4.8 — Reglas reales de cobranza; NO INICIADA**. Requiere una instrucción posterior que la autorice.
- Salvedad de 4.7: consulta autenticada con datos reales de MERTEL no disponible. Inspección local 05/10/2026: cero compañías, settings comerciales legacy NULL y sin collection_rules; no crear datos para aparentar validación real.
- Archivo protegido: `database/migrations/001_initial_schema.sql` con cambio local previo; nunca editar, revertir ni incluir en commit de estas órdenes. Hash de contenido auditado: `e2f0b2c49c979991914a187dc9531d9c5d2117ce`.

## Qué leer antes de continuar

1. [Reglas oficiales](business/MERTEL_COBRANZA_RULES.md): hechos confirmados y restricciones financieras.
2. [Decisiones pendientes](business/MERTEL_DECISIONS_PENDING.md): preguntas D01–D35 y verificaciones T01–T06.
3. [Auditoría/matriz](architecture/MERTEL_AUDIT_POST_4_7.md): estado de módulos, contradicciones C01–C08, evidencia y deuda.
4. [Arquitectura](architecture/MERTEL_COLLECTION_ARCHITECTURE.md): fronteras existentes/propuestas, acoplamientos y pruebas futuras.
5. [Roadmap 4.8–6.0](roadmap/MERTEL_ROADMAP.md): objetivos, dependencias, riesgos y cierre por fase.

Documentos de fases anteriores y VALIDACION-4.7.md son evidencia histórica, no una fuente para reemplazar las nuevas reglas. Resolver conflictos con esta documentación y la última instrucción del usuario, sin cambiar silenciosamente el negocio.

| Fase | Trabajo previsto | Estado |
|---|---|---|
| 4.8 | Reglas reales de cobranza | NO INICIADA; siguiente |
| 4.9 | Gestiones e historial | FUTURA |
| 5.0 | Promesas de pago | FUTURA |
| 5.1 | Importación/actualización de cartera | FUTURA |
| 5.2 | Motor operativo de cobranza | FUTURA |
| 5.3 | Mensajería/WhatsApp | FUTURA |
| 5.4 | Pagos y reevaluación | FUTURA |
| 5.5 | Reportes y métricas | FUTURA |
| 5.6 | Configuración administrativa | FUTURA |
| 5.7 | Auditoría/endurecimiento | FUTURA |
| 6.0 | Producción MERTEL | FUTURA |

## Qué hará exactamente 4.8 cuando se autorice

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

Solo cuando la instrucción vigente lo autorice y se hayan cumplido sus criterios. No suponer que leer este plan autoriza publicar cualquier cambio. La orden actual sí autoriza un commit/push exclusivamente documental/arquitectónico, con la migración preexistente excluida.

Usar staging por archivos exactos; jamás git add . ni git add ... No incluir .env, node_modules, temporales, capturas, código ajeno o migración 001. Revisar diff --check y diff --cached --check, inspeccionar inventario y diff staged, verificar exclusiones y evitar commits mezclados. Ante modificaciones ajenas adicionales, no mezclarlas y reportar el conflicto antes de publicar.

Tras commit/push autorizado a origin/main, verificar status, log, HEAD, origin/main y estado remoto; reportar hash real y archivos pendientes. Si falla el push, no afirmar sincronización ni forzarlo para ocultar el fallo. La única diferencia local conocida en esta auditoría es la migración protegida.

## Riesgos y deuda priorizada

Prioridad de trabajo técnico, no prioridad comercial de clientes:

- 4.8: selección de factura incorrecta para la nueva regla, ventana desde emisión ausente, orden/labels y datos de descuento insuficientes.
- 4.9–5.2: no existe aún historial operativo, pausa por promesa, contrato seguro de importación ni estado operativo continuo.
- 5.3–5.6: falta proveedor, cuotas aprobadas, fuentes de métricas y edición/configuración auditada; evitar políticas dispersas.
- 5.7: revisar precisión monetaria del helper de descuento, conversiones BIGINT, auditoría integral, escala de lectura y efectos de referencias huérfanas.
- 6.0: falta contexto real autorizado y evidencia de configuración/datos de producción; no confundir push con deploy.

No se requiere corregir código ahora por una deuda crítica. El entregable de esta orden es la base documental para decidir e implementar la fase siguiente con límites explícitos.

## Verificación documental del 05/10/2026

Backend npm test: **148/148**, sin omisiones. Frontend npm test: **51/51**. Lint y build: **OK**. E2E existente se revisó como cobertura, sin nueva ejecución por tratarse de cambios exclusivamente documentales; el resultado histórico de 4.7 fue 12/12 y no se presenta como nueva ejecución.

El inventario de esta orden consta de seis documentos nuevos: este plan, reglas, decisiones, auditoría, arquitectura y roadmap. Los resultados de commit/push y hashes se comprueban después de publicar y se entregan en el reporte final; este archivo no afirma una publicación que no se haya verificado. No se implementó 4.8 ni ninguna otra fase futura.
