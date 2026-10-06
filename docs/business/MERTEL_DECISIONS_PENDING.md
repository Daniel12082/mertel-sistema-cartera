# Decisiones pendientes de MERTEL

Fecha: 05/10/2026. Fase 5 resuelve calendario/límites de Pronto Pago, redondeo al peso entero, exclusiones descriptivas, aviso de cinco días calendario, ventana del 10% y visibilidad de facturas futuras. Las precisiones se registran por ID debajo. Fuente: orden expresa Fase 5 y respuesta posterior del usuario sobre redondeo. Coexistencia temporal, fuente de productos y aplicación financiera siguen pendientes. Responsable comercial: Cartera MERTEL.

Actualización 06/10/2026 — Fase 5.2: el editor permite activar/desactivar etapas existentes de `collection_rules`; los valores comerciales confirmados se presentan bloqueados. Recordatorios legacy, límite diario, horarios y `contact_line` no se exponen porque no tienen consumidores reales. La fase no resuelve decisiones comerciales abiertas ni define aplicación del 10%.

## Histórico de 4.8 — leer las precisiones posteriores de Fase 5

- D06 y D24: **abiertas**; implementados day_type=pending y límites null, sin elegir días calendario/hábiles ni inclusión. El motor se abstiene de asignar Pronto Pago hasta configuración explícita. Los calendarios parametrizados de tests no son respuestas aprobadas.
- D01–D03: **abiertas**; solo se representan productos unknown/eligible/not_eligible/mixed y revisión manual. No hay catálogo, SKU ni concesión automática.
- D25: **abierta**; preview matemático exacto del 3%, sin regla de redondeo. Un resultado con subcentavos tiene amount=null/pending_rounding; no se aplica al saldo.
- D28: la orden 4.8 confirma vencida más antigua y autoriza ID como desempate técnico. Esa precisión quedó implementada; no define reglas nuevas para fechas faltantes/corregidas ni permanencia.
- T03: **RESUELTA TÉCNICAMENTE** en 4.8: configuración version 2 dentro de collection_rules, stage_order y metadatos API stage_catalog/stage_label. Sin activar configuración real ni editor administrativo.
- T01 continúa pendiente: la inspección local sigue sin compañía MERTEL ni collection_rules. El resto de decisiones permanece abierto para su fase.

## Registro de negocio

| ID | Pregunta pendiente | Fases afectadas |
|---|---|---|
| D01 | Lista descriptiva RESUELTA en Fase 5. Pendiente responsable de mantener versiones y asociación a la fuente real de productos | 5 |
| D02 | ¿Cuál es la fuente de productos/SKU, líneas y bases antes de IVA por factura? | 4.8, 5.1 |
| D03 | En factura mixta, confirmada la revisión manual, ¿quién decide, con qué evidencia y puede concederse descuento parcial o rechazarse totalmente? | 4.8, 4.9, 5.6 |
| D04 | ¿Qué es exactamente día hábil/laboral: días de semana, sábados, cierres excepcionales? | 4.8, 5.2, 5.3 |
| D05 | ¿Qué calendario de festivos y ámbito geográfico se usa, y quién lo actualiza? | 4.8, 5.2, 5.3 |
| D06 | RESUELTA en Fase 5: diez días calendario desde issue_date, día 10 incluido | 5 |
| D07 | ¿Cuál es la fórmula, límite y duración del incremento de prioridad por promesa incumplida? | 5.0, 5.2 |
| D08 | ¿Cuál es el catálogo oficial de gestiones, sus campos y resultados? | 4.9 |
| D09 | ¿Qué cuenta como cliente gestionado y cómo se deduplica por período/cobrador? | 4.9, 5.5 |
| D10 | ¿Cuál es el formato/versionado del archivo semanal, su origen y alcance completo o incremental? | 5.1 |
| D11 | ¿Qué columnas son obligatorias, formatos de fecha/moneda y controles de total/completitud? | 5.1 |
| D12 | ¿Cuál es el identificador único externo de factura y cómo tratar correcciones/duplicados? | 5.1 |
| D13 | ¿Cuál es el identificador único externo de cliente y cómo tratar cambios de NIT o duplicados? | 5.1 |
| D14 | ¿Qué hacer si una factura desaparece por error, filtro o archivo incompleto? ¿Qué prueba y aprobación permite considerar pago/al día? | 5.1, 5.4 |
| D15 | ¿Qué hacer si una factura reaparece tras haberse omitido o conciliado? | 5.1, 5.4 |
| D16 | ¿Cómo se resuelve la ambigüedad de frecuencia diaria/semanal y cómo convive con ambos máximos confirmados? | 5.2, 5.3 |
| D17 | ¿Cuál es el horario exacto de envío, zona horaria y comportamiento fuera de horario? | 5.2, 5.3 |
| D18 | ¿Cuáles son las plantillas oficiales, variables y responsables de aprobación? | 5.3, 5.6 |
| D19 | ¿Qué proveedor/API de WhatsApp se utilizará y qué requisitos de cuenta/consentimiento aplican? | 5.3 |
| D20 | ¿Qué estados oficiales del mensaje se esperan y cómo se interpretan acuses del proveedor? | 5.3, 5.5 |
| D21 | ¿Cuáles son las reglas de reintento, límites y tratamiento de errores definitivos o respuesta incierta? | 5.3 |
| D22 | ¿Qué significa dinero recuperado: pago recibido, confirmado, asignado, neto de reversión, y atribución por cobrador/fecha? | 5.4, 5.5 |
| D23 | ¿Qué significa promesa cumplida: importe exacto, parcial, varias facturas y pago recibido o asignado? | 5.0, 5.5 |
| D24 | Ventana 0–10 incluida RESUELTA. Sigue pendiente qué hecho/fecha de acreditación de pago se utilizará para aplicar financieramente el beneficio | 5, pagos futuros |
| D25 | Redondeo RESUELTO: al peso COP entero half-up. Pendiente registro contable y aplicación segura con pagos/allocations | 5, pagos futuros |
| D26 | 10% y ventana 60–70 incluida RESUELTOS. Pendientes base, fórmula y coexistencia temporal con Pronto Pago/pago temprano sin ventanas solapadas | 5 |
| D27 | Aviso exacto cinco días calendario RESUELTO. Persistencia no autorizada; período fuera de etapas visible como agrupación operativa | 5 |
| D28 | Si no hay facturas vencidas, ¿cómo se determina la factura principal? ¿Y empates de vencimiento, facturas sin fecha o fechas corregidas? | 4.8 |
| D29 | RESUELTA para facturas futuras: agrupación operativa Facturas no vencidas, fuera de las cuatro etapas. Fuente de fechas faltantes continúa pendiente | 5 |
| D30 | ¿Los límites de mensajes son por cliente, factura, episodio, canal o combinación? ¿Reingreso a etapa permite otro mensaje? ¿Incluyen manuales e intentos fallidos? | 5.2, 5.3 |
| D31 | ¿A qué hora se evalúa el incumplimiento en la fecha prometida y cuándo puede retomarse el envío? | 5.0, 5.2, 5.3 |
| D32 | ¿Cómo se gestionan múltiples promesas activas, cambios/cancelaciones y promesas por cliente o factura? | 5.0 |
| D33 | ¿Qué saldo trae el archivo: snapshot contable o deuda antes/después de allocations locales? ¿Cómo conciliar pagos, notas y diferencias? | 5.1, 5.4 |
| D34 | ¿Qué período, fecha de corte, atribución y fuente define cada métrica y cómo se reflejan correcciones? | 5.5 |
| D35 | ¿Quién puede revisar exclusiones, editar reglas, registrar promesas y aprobar diferencias de importación? ¿Qué límites por rol? | 4.9–5.7 |

## Pendientes técnicos, separados de las respuestas comerciales

Fase 5, 05/10/2026: lista de exclusiones confirmada (D01 parcialmente resuelta); datos de productos, SKU y evidencia siguen D02. No se configura empresa ficticia ni se concede beneficio por fuente ausente. Se aclara redondeo al peso por respuesta posterior del usuario. La representación admite dos beneficios independientes elegibles previamente evaluados, con sus fechas; no prueba una misma operación elegible simultánea ni aplica 13%. D26 conserva esta ambigüedad expresa. Configuración oficial disponible en backend/config/mertel-collection-rules.json; instalar en la empresa real cuando exista contexto autorizado (T01).

| ID | Verificación necesaria | Condición |
|---|---|---|
| T01 | Disponer del contexto autorizado real de MERTEL, empresa y usuario con permisos | Última inspección local: cero compañías; no inventar datos ni tokens |
| T02 | Relevar esquema desplegado y origen de datos de productos y archivo | El esquema versionado no prueba que las tablas estén completas en producción |
| T03 | Contrato/configuración versionada de reglas y labels implementado | Resuelto técnico en 4.8; ver informe de contrato. Seeds legacy no son fallback |
| T04 | Diseñar preview, idempotencia, validación y conciliación de importaciones | Depende de D10–D15/D33; sin actualizar balance unilateralmente |
| T05 | Diseñar auditoría y relación entre hechos financieros y eventos operativos | Mantener transacción y consistencia sin envío de red dentro de locks |
| T06 | Verificar despliegue, secretos externos, restauración, monitoreo y calendario aprobado | Antes de 6.0; sin instalar o activar proveedores en esta orden |

## Cómo resolver una decisión

Actualización 4.9: la orden autoriza gestión con tipo libre extensible y registro/consulta de promesas en estado `pending` existente. D08 continúa abierto (sin catálogo oficial). D07/D23/D31/D32/D35 y decisiones de mensajería siguen abiertas: no se evalúa cumplimiento, no se cambia prioridad, no hay pausa/reanudación ni edición de estados. Se habilita únicamente el permiso existente `collection.manage` para los roles que ya lo tenían previsto; no se define una nueva política comercial de roles. El borrador se mantiene en memoria de la interfaz, sin envío ni persistencia en messages.

Registrar ID, respuesta literal o evidencia acordada, fecha, aprobador y fases afectadas. Mover únicamente esa decisión al registro confirmado y actualizar reglas, matriz y criterios de cierre. Si la respuesta afecta un contrato financiero, revisar su impacto antes de ejecutar migraciones u operaciones. La mera presencia de un valor en MySQL, un test o un documento antiguo no cierra una decisión.
