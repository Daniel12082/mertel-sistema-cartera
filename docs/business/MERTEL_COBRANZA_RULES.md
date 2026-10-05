# Reglas oficiales de cobranza MERTEL

Fecha: 05/10/2026. Fuente: orden maestra del usuario basada en respuestas de Cartera MERTEL y autorización posterior de 4.8. Esta documentación distingue implementación y activación comercial. Base histórica 4.7: commit `53a9a1093073076f5a0d4ba00ae7924c3b1c2af5`; estado técnico actual 4.8: CERRADA con pendientes de configuración explícitos.

## Actualización autorizada 4.8

4.8 CERRADA (alcance técnico autorizado), validación técnica aprobada. Ya están implementados: selección de vencida más antigua, orden de clientes en backend, jerarquía mediante stage_order y rangos ordinales, catálogo/labels de servidor, evaluador de ventana desde emisión y función matemática exacta del 3% de base_value. Consultar [informe 4.8](../architecture/MERTEL_PHASE_4_8.md).

Se implementó el estado de configuración pendiente autorizado por esta orden: el tipo de día y límites **no se eligieron por MERTEL**. Sin ellos no se asigna Pronto Pago. Productos desconocidos/mixtos representan manual_review; no se inventaron SKU ni revisión operativa. La clasificación no aplica descuentos; el cálculo puro solo produce preview exacto o pending_rounding. El 10% y promo_18 siguen separados. No se implementan fases posteriores ni se acredita validación de datos reales.

## Autoridad y alcance

El producto actual es exclusivamente MERTEL Importaciones. `company_id` y `companyScope` se conservan por seguridad y aislamiento. No autorizan SaaS, Hostify, planes, suscripciones, billing, marketplace, onboarding ni provisioning comercial.

Estas reglas prevalecen para futuras fases sobre ejemplos de tests, seeds y documentos históricos. El cierre de 4.7 acredita la implementación de consulta de esa fase; no acredita compatibilidad completa con reglas recibidas posteriormente. No modificar silenciosamente el comportamiento cerrado: registrar diferencias y corregirlas en la fase autorizada.

## Etapas y cliente único

Orden comercial confirmado, de mayor a menor prioridad:

1. En mora.
2. Vence hoy.
3. Faltan 5 días.
4. Pronto pago.

Las etapas y sus prioridades deben ser configurables y centralizadas. No hay valores numéricos absolutos de prioridad aprobados. El día 5 sí está confirmado como regla de MERTEL, aunque no debe convertirse en una constante dispersa en componentes.

Cada cliente tiene una única tarjeta en el pipeline principal. La factura más atrasada determina su posición/prioridad principal; el detalle muestra sus facturas. En 4.8 el motor selecciona la vencida más antigua, sin criterio de mayor saldo. La orden 4.8 autoriza ID como desempate técnico y entre futuras de igual rango; no se transforma ese criterio en regla comercial. La permanencia entre ventanas continúa pendiente.

## Pronto Pago y modalidades de descuento

| Concepto | Confirmación | Restricción |
|---|---|---|
| Finalidad | Motivar pago temprano antes del ciclo normal de cobro | No sustituye la gestión de cartera |
| Porcentaje Pronto Pago | 3% | No usar otro porcentaje por inferencia |
| Base | Valor antes de IVA | No calcular sobre document_value con IVA |
| Ventana | 10 días desde emisión | Calendario/hábiles, límites inclusivos y fecha de acreditación pendientes |
| Descuento condicionado | 10%, modalidad comercial distinta | No convertirlo en Pronto Pago; condiciones exactas pendientes |
| promo_18 | Campo histórico independiente | No enlazarlo automáticamente a Pronto Pago |

La ventana desde emisión no es diez días antes del vencimiento. El cálculo conceptual confirmado es 3% de la base elegible antes de IVA; no autoriza aún el cálculo automático de una base elegible por producto ni el registro financiero del descuento. El redondeo y su tratamiento financiero requieren definición.

Existen productos excluidos. Una factura mixta exige **revisión manual**. Están pendientes la lista oficial, fuente de SKU/productos, responsable de revisión y resultado permitido de esa revisión. No inventar exclusiones ni conceder descuentos automáticamente por falta de datos.

La elegibilidad de una factura para una etapa de cobranza (`invoices[].eligible` en la respuesta actual) **no equivale a elegibilidad de todos sus productos para el descuento**.

## Pagos e invariantes financieros

Fuente de verdad: `invoices.balance`, administrado por el backend. React puede presentar y solicitar operaciones autorizadas, pero nunca decidir o sobrescribir el saldo.

- Pago total del saldo del cliente: desaparece de cobranza. Pagar una factura no elimina al cliente si conserva otras deudas.
- Pago parcial: permanece con el saldo pendiente y debe reevaluarse.
- Un pago registrado y aún no asignado no reduce por sí solo el saldo de una factura. La reducción financiera actual ocurre mediante allocations.
- Preservar transacciones, bloqueos, aplicaciones activas, soft delete, reversión, reallocation y conciliación.
- No restar descuentos del saldo por mera clasificación; definir primero el tratamiento contable autorizado.

La consulta actual reevaluará los datos cuando se solicite nuevamente, pero no hay actualización operativa inmediata ni evento de reevaluación tras cada pago. La permanencia tras un pago parcial no está garantizada cuando ninguna regla aplica. Estas diferencias se distribuyen entre 4.8, 5.2 y 5.4.

## Promesas de pago — fase futura

Una promesa detiene mensajes automáticos hasta la fecha prometida. Si llega esa fecha y no se realiza el pago, la promesa se considera incumplida y aumenta la prioridad del cliente. La fórmula de incremento no está definida: **no inventarla**.

No se aprobó que una promesa detenga la gestión manual, altere saldos ni elimine la tarjeta. La hora de corte, cumplimiento parcial, múltiples promesas, modificación/cancelación y condiciones de cumplimiento requieren decisión. No implementar estas operaciones en esta orden.

## Mensajería — fase futura

Confirmado: máximo un mensaje por etapa, máximo uno por día, solamente días laborales/hábiles. Una gestión manual del cobrador no detiene las automatizaciones.

Pendiente: ambigüedad diaria/semanal, calendario, horarios y unidad de aplicación de límites (cliente/factura/episodio/canal); no resolver por inferencia. También falta precisar qué sucede en la fecha prometida y cómo contar intentos, reintentos y mensajes manuales. No existe autorización para enviar mensajes ahora.

## Trabajo del cobrador y administrador

El cobrador deberá ver facturas y saldo, registrar gestión y promesa, enviar mensaje manual y consultar historial. La tarjeta debe facilitar ese trabajo desde un contexto de cliente suficiente. En 4.7 solo existe consulta; las operaciones se habilitarán en sus fases con permisos y auditoría.

El administrador deberá configurar etapas, prioridades, días, Pronto Pago, descuentos, horarios, límites y plantillas. La configuración no debe dispersarse en constantes. La página actual de Configuración consulta roles, no administra estas reglas.

## Flujo semanal y seguridad de importación

Flujo operativo confirmado: archivo semanal → actualización de cartera → reevaluación → nueva cobranza.

MERTEL interpreta que una factura ausente del archivo nuevo está pagada/al día y se continúa con la siguiente. Esa intención **no constituye una regla técnica segura de cancelación financiera**. Antes de automatizar se debe aprobar completitud del archivo, identidad, conciliación, tratamiento de omisiones y reapariciones y mecanismo financiero.

No marcar saldo cero, crear pagos, alterar allocations, eliminar facturas o asignar estado financiero pagado únicamente por ausencia en un archivo. En 5.1 se requiere una propuesta de validación y revisión de diferencias antes de cualquier aplicación irreversible.

## Métricas solicitadas

Dinero recuperado, clientes gestionados, promesas realizadas, promesas cumplidas y cartera pendiente. La cartera consultable ya existe; no hay reportes definitivos de estas métricas. Deben formalizarse período, fuente, atribución, deduplicación, reversión y cumplimiento antes de 5.5.

## Referencias

- [Decisiones pendientes](MERTEL_DECISIONS_PENDING.md).
- [Auditoría y matriz de compatibilidad](../architecture/MERTEL_AUDIT_POST_4_7.md).
- [Arquitectura actual y futura](../architecture/MERTEL_COLLECTION_ARCHITECTURE.md).
- [Roadmap](../roadmap/MERTEL_ROADMAP.md).
- [Plan maestro](../MASTER_PLAN.md).
