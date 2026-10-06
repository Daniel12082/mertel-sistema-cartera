# FASE 5.2 — Configuración administrativa de cobranza

Fecha: 06/10/2026. Producto: MERTEL Importaciones. Se reutilizan `settings`, `settings.collection_rules`, `companyScope` y `audit_logs`; no se agrega tabla ni migración. No se avanza a Fase 5.3.

## Alcance implementado

La sección **Administración → Configuración de cobranza** consulta las reglas existentes de la empresa y permite modificar el estado activo de las etapas `overdue`, `due_today`, `five_days_before_due` y `prompt_payment`. El backend solo acepta el conjunto completo de esas cuatro claves y booleanos; rechaza propiedades adicionales, claves desconocidas, valores mal formados y reglas que no sean la política empresarial versionada admitida. Solo actualiza `settings.collection_rules` cuando hay un cambio efectivo.

El catálogo entregado al frontend procede del backend. Presenta el 3% calculado sobre `base_value`, diez días calendario desde emisión con día diez incluido, los cinco días calendario antes del vencimiento y la jerarquía confirmada. Estos valores, el redondeo half-up a peso y las reglas de beneficios permanecen no editables para evitar cambiar decisiones comerciales aprobadas. La elegibilidad del 10% condicionado puede mostrarse por el motor existente, pero su base de cálculo y coexistencia financiera continúan pendientes; esta fase no cambia esos aspectos.

## Valores que se dejaron fuera

La migración 001 contiene seeds globales legacy para `reminder_days_before_due`, `reminder_days_after_due`, `daily_message_limit` y `contact_line`. No tienen consumidores en backend/frontend y están asociados a `company_id=NULL`; no se exponen ni se copian como configuración empresarial. Tampoco se encontró una configuración horaria estable ni proceso que la consuma. No se agregan parámetros, valores por defecto, contactos, productos ni exclusiones.

La configuración versionada de reglas solo se lee desde `settings` de la empresa por `loadCompanyCollectionRules`. Sin una fila empresarial válida, el administrador ve “configuración no disponible”; esta fase no inserta defaults, no convierte legacy NULL en fallback y no modifica datos reales. Al guardar, el siguiente ciclo de consulta usa el JSON guardado por el mismo cargador y motor de cobranza existente.

## Autorización y auditoría

`settings.manage` se habilita como permiso implementado en el catálogo existente. El rol `admin` lo recibe por la concesión existente derivada del catálogo; `supervisor` y `collector` no. No se crean roles. Ambas rutas verifican permiso y `requireCompanyScope`. Las cuentas de empresa conservan su empresa autenticada aunque incluyan otra en query; una cuenta global debe elegir explícitamente una empresa existente y activa. El body no acepta `company_id`, actor ni otros atributos.

| Método | Endpoint | Operación |
|---|---|---|
| GET | `/api/admin/settings` | Devuelve el catálogo disponible de la empresa autorizada; para global exige `?company_id=` explícito. |
| PUT | `/api/admin/settings/collection-rules` | Cambia exclusivamente los booleanos de activación de las cuatro etapas. |

El update y su fila `audit_logs` comparten una transacción. La auditoría registra actor, empresa, clave `collection_rules`, mapa anterior/nuevo de estados, IP, user-agent y fecha de base de datos. Si falla la auditoría, también se revierte la configuración. No se crean eventos para una actualización sin cambios.

## Efectos y límites

La integración usa el motor actual: al desactivar una etapa ya no produce candidato de esa etapa en la siguiente evaluación; al reactivarla vuelve a producirlo. La jerarquía relativa se mantiene `En mora > Vence hoy > Faltan 5 días > Pronto pago`; los parámetros internos de días y los beneficios no cambian. No se escriben facturas, pagos, allocations, balances, clientes, mensajes ni operaciones financieras. No hay envío ni integración de WhatsApp.

## Validación

Backend completo: **223/223**; frontend: **106/106**; E2E Playwright: **34/34**. Lint y build: **OK**. La integración backend usa un schema MySQL aleatorio desechable. E2E recorre persistencia de API simulada, exige selección explícita para admin global y verifica anchos 1440/390/320; scope y persistencia MySQL reales quedan cubiertos por la prueba backend HTTP. No hubo fallos ni omisiones.

La base configurada se consultó en modo de solo lectura después de las pruebas: 0 empresas, 0 settings empresariales, 0 plantillas y 0 schemas temporales de prueba restantes. No se crean fixtures fuera de esquemas temporales desechables, compañías, ni configuración MERTEL inventada.
