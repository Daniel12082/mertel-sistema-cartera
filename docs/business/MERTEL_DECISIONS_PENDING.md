# Decisiones pendientes de MERTEL

Fecha: 05/10/2026. Las decisiones comerciales siguen abiertas salvo la precisión técnica de la orden 4.8 indicada debajo. No contiene respuestas propuestas como si fueran aprobadas. Responsable de aprobación comercial: Cartera MERTEL, con participación administrativa/contable cuando corresponda. La respuesta debe quedar registrada con fecha, alcance y evidencia antes de activar la parte dependiente.

## Avance de 4.8 sin inventar respuestas

- D06 y D24: **abiertas**; implementados day_type=pending y límites null, sin elegir días calendario/hábiles ni inclusión. El motor se abstiene de asignar Pronto Pago hasta configuración explícita. Los calendarios parametrizados de tests no son respuestas aprobadas.
- D01–D03: **abiertas**; solo se representan productos unknown/eligible/not_eligible/mixed y revisión manual. No hay catálogo, SKU ni concesión automática.
- D25: **abierta**; preview matemático exacto del 3%, sin regla de redondeo. Un resultado con subcentavos tiene amount=null/pending_rounding; no se aplica al saldo.
- D28: la orden 4.8 confirma vencida más antigua y autoriza ID como desempate técnico. Esa precisión quedó implementada; no define reglas nuevas para fechas faltantes/corregidas ni permanencia.
- T03: **RESUELTA TÉCNICAMENTE** en 4.8: configuración version 2 dentro de collection_rules, stage_order y metadatos API stage_catalog/stage_label. Sin activar configuración real ni editor administrativo.
- T01 continúa pendiente: la inspección local sigue sin compañía MERTEL ni collection_rules. El resto de decisiones permanece abierto para su fase.

## Registro de negocio

| ID | Pregunta pendiente | Fases afectadas |
|---|---|---|
| D01 | ¿Cuál es la lista definitiva de productos excluidos de Pronto Pago y quién mantiene sus versiones? | 4.8, 5.1, 5.6 |
| D02 | ¿Cuál es la fuente de productos/SKU, líneas y bases antes de IVA por factura? | 4.8, 5.1 |
| D03 | En factura mixta, confirmada la revisión manual, ¿quién decide, con qué evidencia y puede concederse descuento parcial o rechazarse totalmente? | 4.8, 4.9, 5.6 |
| D04 | ¿Qué es exactamente día hábil/laboral: días de semana, sábados, cierres excepcionales? | 4.8, 5.2, 5.3 |
| D05 | ¿Qué calendario de festivos y ámbito geográfico se usa, y quién lo actualiza? | 4.8, 5.2, 5.3 |
| D06 | ¿Los diez días desde emisión de Pronto Pago son calendario o hábiles? | 4.8 |
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
| D24 | ¿La fecha de emisión cuenta como primer día de Pronto Pago, cuál es el último instante incluido y qué fecha de pago acredita el beneficio? | 4.8, 5.4 |
| D25 | ¿Cómo se redondea el 3% y cómo se registra el descuento contablemente sin romper balance y allocations? | 4.8, 5.4 |
| D26 | ¿Cuáles son condiciones/base/ventana y compatibilidad del descuento condicionado del 10% con otras modalidades? | 4.8, 5.6 |
| D27 | ¿Faltan 5 días es un aviso puntual o una etapa que persiste? ¿Cómo tratar fin de semana/festivo y el período entre esa etapa y vence hoy? | 4.8, 5.2 |
| D28 | Si no hay facturas vencidas, ¿cómo se determina la factura principal? ¿Y empates de vencimiento, facturas sin fecha o fechas corregidas? | 4.8 |
| D29 | ¿Una factura pendiente fuera de cualquier ventana debe permanecer visible en cobranza? ¿Cómo se representa sin inventar una quinta etapa comercial? | 4.8, 5.2 |
| D30 | ¿Los límites de mensajes son por cliente, factura, episodio, canal o combinación? ¿Reingreso a etapa permite otro mensaje? ¿Incluyen manuales e intentos fallidos? | 5.2, 5.3 |
| D31 | ¿A qué hora se evalúa el incumplimiento en la fecha prometida y cuándo puede retomarse el envío? | 5.0, 5.2, 5.3 |
| D32 | ¿Cómo se gestionan múltiples promesas activas, cambios/cancelaciones y promesas por cliente o factura? | 5.0 |
| D33 | ¿Qué saldo trae el archivo: snapshot contable o deuda antes/después de allocations locales? ¿Cómo conciliar pagos, notas y diferencias? | 5.1, 5.4 |
| D34 | ¿Qué período, fecha de corte, atribución y fuente define cada métrica y cómo se reflejan correcciones? | 5.5 |
| D35 | ¿Quién puede revisar exclusiones, editar reglas, registrar promesas y aprobar diferencias de importación? ¿Qué límites por rol? | 4.9–5.7 |

## Pendientes técnicos, separados de las respuestas comerciales

| ID | Verificación necesaria | Condición |
|---|---|---|
| T01 | Disponer del contexto autorizado real de MERTEL, empresa y usuario con permisos | Última inspección local: cero compañías; no inventar datos ni tokens |
| T02 | Relevar esquema desplegado y origen de datos de productos y archivo | El esquema versionado no prueba que las tablas estén completas en producción |
| T03 | Contrato/configuración versionada de reglas y labels implementado | Resuelto técnico en 4.8; ver informe de contrato. Seeds legacy no son fallback |
| T04 | Diseñar preview, idempotencia, validación y conciliación de importaciones | Depende de D10–D15/D33; sin actualizar balance unilateralmente |
| T05 | Diseñar auditoría y relación entre hechos financieros y eventos operativos | Mantener transacción y consistencia sin envío de red dentro de locks |
| T06 | Verificar despliegue, secretos externos, restauración, monitoreo y calendario aprobado | Antes de 6.0; sin instalar o activar proveedores en esta orden |

## Cómo resolver una decisión

Registrar ID, respuesta literal o evidencia acordada, fecha, aprobador y fases afectadas. Mover únicamente esa decisión al registro confirmado y actualizar reglas, matriz y criterios de cierre. Si la respuesta afecta un contrato financiero, revisar su impacto antes de ejecutar migraciones u operaciones. La mera presencia de un valor en MySQL, un test o un documento antiguo no cierra una decisión.
