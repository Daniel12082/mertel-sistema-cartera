# Roadmap MERTEL posterior a 4.7

Fecha: 06/10/2026. Cerradas: 4.6D, 4.7A, 4.7B, 4.7, 4.8, 4.9, 5.0, 5.1, 5.1A y 5.2 en sus alcances autorizados. Fase 5.2 implementa administración limitada de la configuración actual; Fase 5.3 y toda integración externa siguen futuras. La orden específica de Fase 5.2 sustituye la numeración anterior del motor operativo.

Fuente: [reglas oficiales](../business/MERTEL_COBRANZA_RULES.md). Decisiones D/T: [registro pendiente](../business/MERTEL_DECISIONS_PENDING.md). Todas las fases exigen diff acotado, aislamiento, pruebas pertinentes y preservación de invariantes financieros; un cierre no implica validación de producción si no se ejecutó.

## 4.8 — Reglas reales de cobranza

Implementación técnica de selección/orden/jerarquía y catálogo ya realizada. Evaluador desde emisión y 3% exacto separados de elegibilidad/aplicación financiera; calendario/límites pendientes se representan sin otorgar Pronto Pago. Productos unknown/mixed requieren revisión manual. Informe y evidencias: [fase 4.8](../architecture/MERTEL_PHASE_4_8.md). Los tests, lint/build y E2E aprobaron; los pendientes comerciales no se declaran resueltos.

- **Objetivo:** corregir jerarquía y selección de factura más atrasada; diseñar/configurar Faltan 5 días y ventana Pronto Pago desde emisión según decisiones confirmadas. Presentación de catálogo coherente con backend. Mantener cliente único y `/api/collection` de consulta.
- **Dependencias:** 4.7; reglas oficiales; configuración de compañía autorizada; datos de emisión y propuesta compatible de configuración. D01–D06, D24–D29/T02–T03 según la parte.
- **Riesgos:** convertir ejemplos de prioridad en política, usar due_date como emisión, aplicar descuento sobre IVA o sin productos, ocultar clientes pendientes fuera de ventanas.
- **Decisiones necesarias:** tipo/límites de días; exclusiones/fuente y revisión manual; desempates/sin vencidos; persistencia en etapas; redondeo/tratamiento del descuento. Condiciones del 10% no se sustituyen por 3%.
- **Cierre:** corregir C01–C03/C06/C07 y probar cliente único, antigüedad y orden; registrar pendientes que impidan una subparte. No declarar todo Pronto Pago implementado si faltan datos o límites. Cualquier ruta de descuento automático bloqueada por decisión queda sin activar; no escribir saldo por una etapa. Sin gestiones/promesas/mensajes/importación.

## 4.9 — Gestiones e historial

Implementada y validada por orden posterior: gestiones de tipo libre, promesas pendientes, historial por cliente/factura y borrador temporal sin envío. [Informe 4.9](../architecture/MERTEL_PHASE_4_9.md). El registro manual de promesas se incluye expresamente aquí; evaluación/pausa/cambios siguen en fases futuras. D08/D35 no se consideran resueltos por reutilizar permisos y aceptar texto libre.

- **Objetivo:** registrar y consultar gestiones del cliente en contexto de cobranza y ofrecer historial trazable.
- **Dependencias:** 4.8, identidad y permisos actuales, catálogo D08 y visibilidad D35; definición D09 si se presenta una métrica.
- **Riesgos:** hechos duplicados, filtración entre compañías, confundir gestión con pausa de envío o con pago.
- **Decisiones necesarias:** catálogo, campos obligatorios, resultados, edición/corrección y alcance de roles.
- **Cierre:** operaciones autorizadas y auditadas, consulta con actor/fecha; no alterar balances ni detener automatización por una gestión. No construir la métrica de gestionados sin definición.

## 5.0 — Promesas de pago

- **Objetivo futuro:** ciclo de estados, modificación/cancelación de promesas; representar pausa de mensajes y cumplimiento/incumplimiento. Registro y consulta básicos ya existen desde la orden 4.9; no duplicarlos.
- **Dependencias:** 4.9, D07/D23/D31/D32/D35; contrato de integración operativa propuesto para 5.2.
- **Riesgos:** incumplimiento prematuro, importe parcial ambiguo, varias promesas activas y fórmula no aprobada.
- **Decisiones necesarias:** fórmula de prioridad, hora de corte, alcance, modificación/cancelación y acreditación del cumplimiento.
- **Cierre:** estados y pausa probados con fechas aprobadas; ningún incremento inventado ni escritura de pagos desde promesas. Si falta una decisión, su parte permanece pendiente, no se simula completa.

## 5.1 — Panel operativo y preparación de mensajes WhatsApp

La orden del 05/10/2026 sustituye el alcance anterior de esta numeración. Implementada y validada: tarjetas por cliente, detalle operativo, reutilización de gestiones/promesas 4.9 y selección de plantillas reales → vista previa → preparación temporal, sin envío/persistencia de mensajes. Ver [informe 5.1](../architecture/MERTEL_PHASE_5_1.md). Permisos y companyScope siguen obligatorios; no se cambian reglas de Fase 5. No se avanza a 5.2.

## Importación/actualización de cartera — pendiente, fuera de esta orden

- **Objetivo:** archivo semanal validado, preview de diferencias, trazabilidad de lote y actualización conciliada, seguida de reevaluación.
- **Dependencias:** 4.8–5.0; D10–D15/D33, fuente de SKU si se utiliza; diseño financiero aprobado antes de aplicar diferencias. La coordinación operativa de 5.4 se diseña como dependencia de contrato, no se implementa anticipadamente.
- **Riesgos:** archivo parcial considerado completo, factura omitida/reaparecida, duplicados, desfase con pagos locales y saldo externo incompatible.
- **Decisiones necesarias:** formato, columnas, identidad, ámbito de snapshot, tratamiento de omisión/reaparición y mecanismos contables autorizados.
- **Cierre:** validación, preview, idempotencia y errores de lote probados; ninguna factura se declara pagada por mera ausencia. Aplicación solo con conciliación autorizada; allocations existentes preservadas. Sin formato/regla aprobada no habilitar importación irreversible.

## 5.2 — Configuración administrativa de cobranza

Implementada y validada; ver [informe Fase 5.2](../architecture/MERTEL_PHASE_5_2.md). Reutiliza `settings.collection_rules` y su consumidor actual. Administra el estado activo de las cuatro etapas configuradas por empresa, mientras muestra como solo lectura los valores comerciales confirmados y mantiene fija la jerarquía. Usa `settings.manage`, `companyScope` y auditoría transaccional. Las semillas legacy de recordatorios, límites y contacto se excluyen porque no las consume el sistema. Sin empresa real no se crea configuración.

La previsión previa de esta numeración para motor operativo queda pendiente fuera de esta entrega: coordinación de promesas, frecuencia, idempotencia y criterios de reingreso siguen sin implementación ni decisión.

## 5.3 — Mensajería/WhatsApp

- **Objetivo:** envío manual y automático autorizado con proveedor aprobado, plantillas oficiales y estados trazables.
- **Dependencias:** motor operativo pendiente, D16–D21/D30/D31/D35 y cuenta/proveedor autorizado. La configuración existente de 5.2 no supone habilitación ni autorización de envío.
- **Riesgos:** mensajes duplicados, error de destinatario, reintentos fuera de cuota, filtración de secretos y falta de consentimiento/evidencia.
- **Decisiones necesarias:** proveedor, plantillas, estados, retries, horarios, reglas diaria/semanal y alcance de límites.
- **Cierre:** pruebas de integración con entorno apropiado, deduplicación y errores inciertos controlados; secretos fuera de Git y cuotas respetadas. Envíos externos requieren autorización específica; no inventar WhatsApp usando el esquema histórico.

## 5.4 — Pagos y reevaluación

- **Objetivo:** integrar efectos de pagos/allocations/reversiones e importación conciliada con la actualización operativa de cobranza.
- **Dependencias:** pagos actuales, 5.1–5.3; D23/D25/D29/D33 y definiciones de fuente financiera.
- **Riesgos:** pago sin asignar contado como saldo cancelado, descuento restado dos veces, inconsistencias por concurrencia o reversiones.
- **Decisiones necesarias:** acreditación de pago/descuento, permanencia parcial y correspondencia del saldo externo con allocations.
- **Cierre:** pago total aplicado retira al cliente si no queda deuda; parcial permanece según política aprobada; reevaluación después de commit y correcta reversión/reallocation. Integridad financiera y read-only de consultas preservados.

## 5.5 — Reportes y métricas

- **Objetivo:** dinero recuperado, clientes gestionados, promesas realizadas/cumplidas y cartera pendiente con definiciones oficiales.
- **Dependencias:** hechos de 4.9–5.4 y D09/D22/D23/D34; auditoría suficiente.
- **Riesgos:** doble conteo, atribución no aprobada, ignorar reversión o tomar snapshots como recuperación monetaria.
- **Decisiones necesarias:** fuente, período, fecha corte, deduplicación y atribución de cada indicador.
- **Cierre:** métricas conciliables y reproducibles, pruebas de correcciones/reversiones y filtros autorizados; no reportes definitivos con definiciones abiertas.

## 5.6 — Configuración operativa avanzada

- **Objetivo:** resolver necesidades futuras de configuración que dependan de decisiones comerciales pendientes y no estén soportadas por el editor acotado de Fase 5.2.
- **Dependencias:** motor operativo aún pendiente, mensajería 5.3 y decisiones D01/D03/D04/D05/D17/D18/D26/D35.
- **Riesgos:** reglas inválidas activas, cambio retroactivo sin versión/evidencia, edición de secrets o eliminación de controles.
- **Decisiones necesarias:** quién aprueba/edita y vigencia de cambios, validación de configuración y revisión de descuentos.
- **Cierre:** ampliar solo después de aprobar reglas y garantizar consumidores reales, validación, auditoría y compatibilidad. Sin tenants comerciales ni nuevos sistemas de roles.

## 5.7 — Auditoría/endurecimiento

- **Objetivo:** revisar trazabilidad integral, seguridad, concurrencia, integridad, IDs, rendimiento y recuperación antes de producción.
- **Dependencias:** 4.8–5.6, registros operativos/financieros y políticas aprobadas.
- **Riesgos:** datos sensibles en logs, referencias huérfanas, redondeo/BIGINT, carrera de envío/pago y respaldo no restaurable.
- **Decisiones necesarias:** retención/acceso a historial y tratamiento autorizado de incidencias.
- **Cierre:** evidencias de aislamiento/roles, idempotencia y no mutación indebida; restauración ensayada, deuda crítica resuelta y resultados documentados. No confundir unit tests con datos reales validados.

## 6.0 — Producción MERTEL

- **Objetivo:** habilitar operación real de MERTEL con datos, usuarios, reglas aprobadas, monitoreo y plan de recuperación.
- **Dependencias:** cierres previos y T01/T06; configuración explícita HTTPS de producción y autorizaciones de despliegue/envío.
- **Riesgos:** migración accidental de fixtures, ausencia de companyScope real, configuración vacía, datos financieros sin conciliación o rollback no ensayado.
- **Decisiones necesarias:** responsable de aprobación, ventana de puesta en marcha y evidencia de reglas/datos definitivos.
- **Cierre:** consultas autenticadas reales, permisos, cartera/motor, operaciones habilitadas y métricas conciliadas; comprobación postdeploy, backups y recuperación; sin secretos en repositorio. No declarar producción por solo haber hecho push a main.
