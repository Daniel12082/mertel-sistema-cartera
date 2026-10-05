# Auditoría del proyecto después de 4.7

Fecha: 05/10/2026. Base auditada: `main`, commit `53a9a1093073076f5a0d4ba00ae7924c3b1c2af5`. Auditoría documental; no se modifican código, esquema, reglas, roles, datos ni autenticación.

## Estado actualizado durante 4.8

La auditoría original de las secciones siguientes es la **foto histórica posterior a 4.7**. La implementación autorizada 4.8 se registra en esta tabla y en [MERTEL_PHASE_4_8.md](MERTEL_PHASE_4_8.md), sin convertir pendientes comerciales en decisiones aprobadas.

| Hallazgo | Estado técnico 4.8 |
|---|---|
| C01 | CORREGIDO: factura vencida más antigua; ID técnico para empate; saldo no decide |
| C02 | CORREGIDO: ventana desde issue_date, diez días; tipo/calendario/límites pendientes bloquean asignación, no se usan due_date ni promo_18 |
| C03 | CORREGIDO: orden configurable y rangos ordinales, clientes ordenados en backend |
| C04 | PARCIAL/PENDIENTE: no se implementan flujos de pagos/eventos ni permanencia D29 |
| C05 | Cálculo matemático exacto 3% base_value implementado; subcentavos sin redondear; aplicación financiera y exclusiones siguen pendientes |
| C06 | CORREGIDO: UI consume catálogo/orden/etiquetas de backend, sin catálogo comercial estático |
| C07 | CORREGIDO en código/tests: sin pesos arbitrarios ni interpretación Pronto Pago por vencimiento; settings NULL no se heredan ni editan |
| C08 | PENDIENTE fases 5.1/5.4; finanzas existentes intactas |

Estado histórico de esta auditoría: gestiones, promesas, mensajes, importaciones, reportes y administración completa estaban sin implementar. Actualización 4.9: registro manual/historial de gestiones y promesas y borrador temporal implementados y validados, ver [informe](MERTEL_PHASE_4_9.md). Cumplimiento, pausa, envío y módulos posteriores siguen futuros; las filas de fases futuras de esta matriz no representan evaluación de promesas implementada. No hay migraciones nuevas. 4.8 CERRADA (alcance técnico autorizado) con validaciones automáticas aprobadas; los resultados específicos constan en su informe.

## Estado por módulo y evidencia

| Módulo | Estado actual | Evidencia y alcance |
|---|---|---|
| Auth/sesión 4.6D | IMPLEMENTADA | auth routes/controllers/service/model, middleware y AuthProvider/api.js; JWT en memoria, refresh cookie, roles actuales; tests HTTP y unitarios |
| Seguridad por compañía | IMPLEMENTADA | companyScope/requirePermission en montajes financieros y cobranza; administración global técnica, no SaaS |
| Clientes | IMPLEMENTADA | customer routes/controller/service/model y Clientes; CRUD y baja lógica con protección de deuda |
| Facturas | IMPLEMENTADA | invoice routes/controller/service/model y Facturas; fechas, valores, saldo, campos discount/promo_18; no líneas/SKU de producto |
| Pagos/allocations | IMPLEMENTADA | payment.service/model y paymentAllocation.model; locks/transacciones, saldo, reversión, reallocation; pagos no se eliminan físicamente |
| Cartera | IMPLEMENTADA | portfolio routes/controller/service/calculation/model; saldo pendiente, fechas, resumen, cliente y conciliación solo lectura |
| Cobranza 4.7 | IMPLEMENTADA PARCIALMENTE frente a nuevas reglas | GET /api/collection y Cobranza, una fila por cliente, main_invoice, todas las clasificaciones y ambos saldos; reglas nuevas incompletas |
| Motor puro | IMPLEMENTADA | collectionEngine.service.js soporta overdue, due_today y days_before_due configurables; no usa issue_date para ventanas |
| Configuración interna | IMPLEMENTADA PARCIALMENTE | companyConfiguration.model carga settings/templates de una empresa; companyCollection lee collection_rules JSON; no editor/API administrativo |
| Configuración visual | IMPLEMENTADA PARCIALMENTE | Configuracion.jsx muestra catálogo de roles; no etapas, descuentos, horarios ni plantillas |
| Gestiones/historial operativo | NO IMPLEMENTADA | collection_actions existe en 001; no rutas, servicios ni pantalla operativa; history.view y collection.manage previstos/no activos |
| Promesas | NO IMPLEMENTADA | payment_promises existe en 001; sin CRUD, pausa, cumplimiento o prioridad por incumplimiento |
| Mensajes/WhatsApp | NO IMPLEMENTADA | messages/message_templates y loader interno; sin envío, proveedor, cuotas, scheduler ni reintentos; permisos previstos |
| Importación | NO IMPLEMENTADA | import_batches/import_errors registran esquema de lotes/errores; no parser, ruta, reconciliador ni UI de importación localizados |
| Auditoría | IMPLEMENTADA PARCIALMENTE | audit_logs y auditAuth registran autenticación; no evidencia de auditoría operacional integral de reglas/gestiones/importación |
| Reportes/métricas | NO IMPLEMENTADA | /reportes placeholder, permisos reports no implementados; Dashboard también placeholder; Cartera no es un reporte operativo de recuperación |
| Migraciones | IMPLEMENTADAS para fases previas | 001 esquema, 002 soft delete allocations, 003 unicidad activa, 004 refresh y 005 username; no nuevas migraciones en esta orden |

La navegación muestra módulos visibles aunque no todos tienen funciones activas. El backend es la barrera de autorización; no todas las pantallas CRUD ocultan acciones por permiso. No habilitar permisos futuros porque una tabla ya exista.

## Matriz de compatibilidad de negocio

Los estados se separan en **decisión comercial** y **implementación**, para no confundir CONFIRMADA con IMPLEMENTADA.

| Regla | Estado comercial | Estado técnico | Siguiente tratamiento |
|---|---|---|---|
| En mora > Vence hoy > Faltan 5 días > Pronto pago | CONFIRMADA | IMPLEMENTADA PARCIALMENTE: prioridades configurables, sin garantía de ese orden | 4.8 |
| Una tarjeta por cliente | CONFIRMADA | IMPLEMENTADA | Preservar agrupación por identidad |
| Factura más atrasada determina posición | CONFIRMADA | NO IMPLEMENTADA conforme a regla | Requiere corrección en 4.8 |
| Pronto Pago 3% antes de IVA | CONFIRMADA | IMPLEMENTADA PARCIALMENTE: helper genérico aislado sin integración | 4.8, tratamiento financiero en 5.4 |
| Ventana diez días desde emisión | CONFIRMADA; calendario/límites PENDIENTE DE NEGOCIO | NO IMPLEMENTADA | Requiere corrección en 4.8 |
| Descuento condicionado 10% independiente | CONFIRMADA como modalidad; condiciones PENDIENTE DE NEGOCIO | NO IMPLEMENTADA | No fusionarlo con Pronto Pago |
| Productos excluidos y revisión manual mixta | CONFIRMADA; lista/fuente/resolución PENDIENTE DE NEGOCIO | NO IMPLEMENTADA; PENDIENTE TÉCNICA de líneas/SKU | 4.8/5.1 sin concesión automática |
| Promesa pausa mensajes hasta fecha | CONFIRMADA; corte PENDIENTE DE NEGOCIO | NO IMPLEMENTADA | 5.0/5.2/5.3 |
| Incumplimiento aumenta prioridad | CONFIRMADA; fórmula PENDIENTE DE NEGOCIO | NO IMPLEMENTADA | No asignar un incremento |
| Máximo un mensaje por etapa y día; días hábiles | CONFIRMADA; unidad/calendario/frecuencia PENDIENTE DE NEGOCIO | NO IMPLEMENTADA | 5.2/5.3 |
| Gestión manual no pausa automatización | CONFIRMADA | NO IMPLEMENTADA | Preservar separación futura |
| Funciones del cobrador | CONFIRMADA | IMPLEMENTADA PARCIALMENTE: consulta de factura y saldo | 4.9/5.0/5.3 |
| Pago total sale, parcial permanece y reevaluación | CONFIRMADA | IMPLEMENTADA PARCIALMENTE | 4.8/5.2/5.4; ver C04 |
| Configuración administrativa centralizada | CONFIRMADA | IMPLEMENTADA PARCIALMENTE: lectura interna solamente | Diseño 4.8, administración 5.6 |
| Métricas requeridas | CONFIRMADA; fórmulas PENDIENTE DE NEGOCIO | NO IMPLEMENTADA salvo consulta de cartera | 5.5 |
| Archivo semanal actualiza y reevalúa | CONFIRMADA | NO IMPLEMENTADA; PENDIENTE TÉCNICA de reconciliación | 5.1 |
| Ausencia en archivo significa pago/al día | Intención CONFIRMADA; salvaguarda PENDIENTE DE NEGOCIO/TÉCNICA | NO IMPLEMENTADA deliberadamente | No modificar finanzas por ausencia |

## Contradicciones y brechas verificadas

| ID | Evidencia actual | Diferencia con regla oficial | Acción futura |
|---|---|---|---|
| C01 | compareInvoiceCandidates prioriza regla numérica y después abs(vencimiento−referencia), saldo e ID | Entre vencidas de igual prioridad selecciona la más reciente, no la más atrasada | **Requiere corrección en 4.8**; revisar selección y test de desempate |
| C02 | ruleMatches solo contempla distancia a due_date; prompt_payment usa days_before_due | Diez días antes de vencimiento no es diez días desde issue_date; tampoco es una ventana continua | **Requiere corrección en 4.8**, condicionada a D06/D24 |
| C03 | Prioridades arbitrarias aceptadas; customers del modelo ordenados por nombre; tabla conserva orden | No hay garantía de jerarquía comercial ni de posición por factura más atrasada | **Requiere corrección en 4.8** sin inventar magnitudes de prioridad |
| C04 | API omite cliente sin facturas elegibles; pago parcial puede dejar deuda fuera de ventanas; consulta solo se refresca por fecha/Actualizar | Tener deuda parcial no garantiza permanecer visible, ni existe reevaluación operativa inmediata tras pago | Precisar D27/D29 en 4.8; coordinación operativa 5.2 y pagos 5.4 |
| C05 | calculateDiscountFromRule exige base_value y aplica porcentaje con Number/toFixed; no tiene callers en src/tests localizados | Hay helper, no Pronto Pago operativo, ni ventana/exclusión/registro contable; requiere revisar precisión monetaria | 4.8 diseño/condiciones, 5.4 contabilización aprobada |
| C06 | UI presenta catálogo estático en orden Pronto/Faltan/Vence/Mora y reconoce days_before_due; test usa five_days_before_due | Orden visual y etiquetas no son el orden oficial ni catálogo configurable; claves arbitrarias pueden verse crudas junto a tarjetas conceptuales de cero | **Requiere corrección en 4.8** con metadatos reales compatibles |
| C07 | Seeds legacy NULL incluyen descuentos/días y baseRules de test usa prompt_payment a diez días antes de vencer | Valores históricos y fixtures no son configuración oficial de MERTEL | No heredarlos; actualizar pruebas en 4.8 según reglas aprobadas |
| C08 | portfolio usa deuda/document_value−allocations para conciliación; no hay importador | Sobrescribir balance desde un snapshot externo puede romper la contabilidad de aplicaciones existentes | PENDIENTE 5.1/5.4; aprobación de modelo de reconciliación |

Contraejemplos ejecutados solo en memoria en esta auditoría: con referencia 05/10/2026, dos facturas vencidas de igual prioridad (01/09 y 04/10) seleccionan hoy 04/10; y dos emisiones diferentes con vencimiento 15/10 reciben prompt_payment igualmente bajo una regla days_before_due=10. Son ejemplos técnicos, **no datos reales de MERTEL**, sin escrituras.

### Settings y valores históricos

Se inspeccionó el esquema versionado, el working tree y metadatos de la base local, sin cambiar ninguno. En HEAD la migración 001 contiene `prompt_payment_discount=3`; en el archivo local esa fila está ausente por una modificación preexistente protegida. La base conserva settings NULL: descuento 3, business_day_due_day 7, payment_cutoff_day 10, reminder_days_before_due 5 y reminder_days_after_due 1.

El nuevo 3% y los cinco días sí tienen respaldo en la orden oficial, pero la coincidencia de un número antiguo no valida su contexto. El 10 histórico de payment_cutoff_day no acredita la ventana de diez días desde emisión. No hay aprobación nueva del día hábil 7 ni del recordatorio posterior 1. companyConfiguration excluye NULL y companyCollection exige collection_rules de la empresa: mantener ese aislamiento, no trasladar seeds automáticamente.

Al 05/10/2026 la base local configurada tiene cero compañías y no se encontró collection_rules en esa inspección. No se validaron reglas MERTEL activas ni producción. Esto conserva la salvedad del cierre técnico de 4.7.

### Documentación y pruebas

Documentos de fases 4.6 y cierre 4.7 describen comportamiento histórico. No deben presentarse como validación de las reglas nuevas. Test `primary invoice tie-break uses nearest due date...` y fixture prompt_payment/days_before_due=10 codifican C01/C02; que pasen no prueba compatibilidad comercial. La nueva documentación es el punto de entrada oficial para 4.8, sin reescribir evidencia histórica.

## Deuda técnica y límites

- Motor no recibe catálogo de productos, base_value, promesas, calendario o política operativa; collection.model solo proyecta campos actuales. Ampliar por fase, no consultar SQL desde el motor puro.
- Configuración JSON valida reglas de forma básica; falta versionado, semántica comercial, metadatos de presentación y cambios auditados.
- Clasificación de consulta y elegibilidad de descuento necesitan conceptos diferentes; evitar reutilizar eligible para descuentos o mensajes.
- Auditoría de autenticación no sustituye historial operativo ni trazabilidad financiera de importación.
- Listados de cobranza cargan conjunto completo; evaluar paginación/consulta agrupada según volumen, sin inventar requisitos de escala.
- Factura/cliente/company ID BIGINT se usan en algunos comparadores/conversiones Number; revisar sin pérdida en 5.7, especialmente desempates del motor.
- Settings NULL y FK ON DELETE SET NULL requieren cautela: no borrar empresas físicamente ni convertir contexto huérfano en admin global. Preservar salvaguardas existentes.
- No hay problema crítico que obligue a un refactor de código en esta orden. Las correcciones comerciales están acotadas a 4.8 y las operaciones nuevas a su roadmap.

## Verificación de esta orden

Ejecutados nuevamente el 05/10/2026: backend npm test **148/148**, sin omisiones; frontend npm test **51/51**; lint **OK** y build **OK**. Se revisó infraestructura y cobertura E2E existente, cuyo cierre 4.7 documentó 12/12; E2E no se volvió a ejecutar en esta orden documental y no se atribuye ese resultado histórico a una nueva ejecución. Solo documentos se crean en esta orden. La migración 001 conserva hash de contenido `e2f0b2c49c979991914a187dc9531d9c5d2117ce` y queda excluida.
