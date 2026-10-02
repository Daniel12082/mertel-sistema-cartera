# FASE 4.6C — Arquitectura multiempresa y aislamiento de datos

Revisión: 2 de octubre de 2026. MERTEL es el software de plataforma.
**MERTEL Importaciones S.A.S. será la primera empresa configurada**, cuando
se confirmen sus datos oficiales y las respuestas del formulario. Sus reglas
comerciales no forman parte del núcleo ni se crean en esta fase.

## Arquitectura y alcance

Se reutilizan `companies`, `users.company_id`, los roles existentes y las FK
actuales. No se crean empresas, usuarios reales, tablas paralelas ni nuevas
migraciones. El backend define el alcance de cada operación; React únicamente
recibe identidad, roles, permisos, company_id e is_global_admin desde auth.

Cadena: JWT → usuario activo y roles actuales de MySQL → alcance empresarial
→ permiso de operación → controlador → servicio → consulta SQL/transacción.
El token continúa conteniendo solo identidad y claims estándar. Cambiar un
rol o la asociación de empresa en la base cambia el alcance de la siguiente
petición, sin confiar en claims de empresa ni permisos enviados por el cliente.

`companyContext`, `companyFilter`, `documentCompany` y las comprobaciones de
referencias están centralizados en `backend/src/utils/companyScope.js`.
`requireCompanyScope` protege los cuatro montajes financieros completos;
los modelos de lectura rechazan un alcance ausente en vez de consultar todo.
`requireGlobalAdmin` es reutilizable para administración de plataforma.
Los IDs de empresa se comparan como strings y las lecturas internas de
propiedad usan CAST AS CHAR para preservar la precisión de BIGINT.

## Empresa, administrador global y usuario de empresa

Una fila de companies identifica una organización independiente. La empresa
no se decide por nombre, NIT especial ni una condición sobre la marca MERTEL.

El admin real conserva username=admin, rol=admin, estado=active y company_id
NULL. El alcance global exige **ambas condiciones**: company_id explícitamente
NULL y rol admin leído de la base. NULL por sí solo no otorga acceso global.
Un admin asociado a una empresa tiene alcance empresarial, incluso si tiene
todos los permisos de su rol. Collector, supervisor o usuario sin roles con
company_id NULL reciben 403 en rutas empresariales. Auth/me sigue disponible
para describir su identidad; no se alteran login, cookies, JWT ni refresh.

Un usuario de empresa solo accede a su asociación actual. La empresa debe
existir, estar activa y no estar eliminada. Una empresa inactiva o con baja
lógica bloquea sus operaciones, sin convertir al usuario en administrador.
No hay endpoint de cambio de empresa ni selector para usuarios normales.
La futura administración debe usar baja lógica de empresas: no debe aprovechar
ON DELETE SET NULL de las FK para desasociar usuarios, especialmente admins.

## Alcance administrativo definido

El global puede consultar datos de todas las empresas y los registros legacy
sin empresa. Puede acotar una consulta financiera con `?company_id=<id>`; el
middleware valida el ID y la existencia de la empresa. Un ID inválido produce
400; uno inexistente/eliminado, 404. Una empresa inactiva sigue siendo
inspeccionable por el global. Dentro del alcance elegido, un recurso ajeno
produce 404 también para ese administrador.

Nuevas consultas exclusivamente globales, con companies.view y
requireGlobalAdmin, sin caché:

- GET /api/admin/companies
- GET /api/admin/companies/:id

No se implementa CRUD visual ni creación HTTP de empresas. La matriz de roles
continúa siendo solo lectura en GET /api/admin/roles. companies.view es el
único permiso efectivo añadido: admin tiene 18, supervisor 11, collector 7.
companies.view indica scope=global_admin y exige el guard global, aunque un
admin de empresa tenga ese permiso en la política general de su rol.

La administración persistente de usuarios y configuración no tenía endpoints
en FASE 4.6B y continúa pendiente; sus permisos previstos no se activan ni se
simulan mediante rutas ficticias. La nueva separación de alcance y el guard
global deben aplicarse a esos futuros endpoints antes de habilitarlos.

## company_id e IDOR

Para usuarios de empresa, se ignoran los intentos de escoger otra empresa
mediante query, headers y los company_id válidos incluidos en cuerpos. Los
campos sintácticamente inválidos pueden ser rechazados por los validadores
existentes. El company_id efectivo siempre procede del usuario real.
No se acepta is_global_admin, roles, permisos ni localStorage como autoridad.

Listas y detalles incluyen company_id en los predicados SQL. En las lecturas
con joins se filtra tanto el documento como su cliente; una relación histórica
inconsistente no expone datos de otra empresa. En escrituras se verifican la
propiedad del recurso y sus referencias dentro de la transacción existente.
Para recursos ajenos se devuelve el mismo 404 que para IDs inexistentes,
antes de exponer saldo, estado, referencias o dependencias financieras.
Sin JWT válido sigue correspondiendo 401; sin empresa o permiso, 403.

## Clientes

GET lista/detalle, PUT y DELETE están limitados al company_id autenticado.
POST asigna esa empresa aunque el cuerpo intente indicar otra. El global debe
indicar una empresa real para crear un cliente, por cuerpo o alcance validado;
no crea clientes nuevos sin empresa. Ningún PUT mueve un cliente de empresa.
Las restricciones de eliminación por deuda, pagos, aplicaciones y promesas
se mantienen; la comprobación se hace después de localizar y bloquear el
cliente dentro de su alcance.

## Facturas

Lista/detalle filtran la empresa de factura y cliente. La creación normal
asigna la empresa del usuario y exige un cliente de la misma empresa. El
global puede inferirla del cliente autorizado si no la indica. La empresa
del documento es inmutable incluso sin aplicaciones previas. La reasignación
de cliente dentro de la misma empresa continúa sujeta a historial/promesas.
No cambian validación monetaria, cálculo de balance, reglas de borrado,
fechas, valores importados ni control del saldo enviado desde frontend.

## Pagos

Lista, detalle, creación, edición y la ruta de borrado respetan el alcance.
La referencia de cliente debe estar dentro de la misma empresa. El creador
del pago nuevo procede del usuario autenticado; editarlo conserva su creador,
sin aceptar suplantación desde created_by. No hay movimiento entre empresas.
Se conservan monto disponible, estado aplicable, restricciones por historial
y prohibición de eliminación física; consultar el pago ajeno devuelve 404
antes de revelar por qué un pago propio no puede eliminarse.

## Asignaciones

Se mantiene la transacción y el orden de bloqueos payment → customer → invoice
→ allocation. Los SELECT FOR UPDATE filtran empresa; las referencias se
verifican usando la misma conexión antes de insertar o modificar balances.
Payment e invoice deben tener **exactamente la misma empresa**, además del
mismo cliente. NULL no sirve de comodín para enlazar una empresa real.
Una factura ajena produce 404 para el usuario de empresa, sin exponer saldo.
El global tampoco puede realizar una asignación entre empresas diferentes.

Consultar asignaciones filtra pago, factura y cliente relacionado. Reversar
valida el pago/factura dentro de su alcance y bloquea la asignación. Se
conservan reversión una sola vez, historial, reallocation, límites de importes,
rollback y concurrencia. La comprobación de propiedad durante reversión no
exige un cliente activo: permite mantener la reversión histórica de un cliente
inactivo/eliminado, conforme al comportamiento financiero previo.

## Cartera

Las cinco rutas existentes se filtran en SQL:

- GET /api/portfolio
- GET /api/portfolio/summary
- GET /api/portfolio/customers
- GET /api/portfolio/customer/:customerId
- GET /api/portfolio/reconciliation

Listas, sumas, agrupaciones y diferencias de conciliación pertenecen al alcance
autorizado. Cambiar un filtro customer_id por uno ajeno no devuelve sus datos.
Se conserva reference_date obligatorio, filtros, orden, días de mora, balances,
clasificación financiera y fórmulas DECIMAL. Las consultas siguen siendo solo
lectura: no reparan automáticamente diferencias históricas.

## Núcleo de cobranza y configuración comercial

`collectionEngine.service.js` y `portfolio.calculation.js` permanecen intactos.
El motor puro ya recibe rules explícitas y no conoce una empresa especial.
El adaptador nuevo `companyCollection.service.js` valida que clientes y
facturas pertenezcan a company.id y delega la evaluación al motor existente.
No inventa porcentajes, prioridades, ventanas, elegibilidad, calendarios ni
frecuencias. Sin reglas configuradas no se activa una regla comercial.

`loadCompanyCollectionRules` reutiliza settings para una futura entrada
company_id + collection_rules, value_type=json, con un arreglo de reglas
explícitas compatible con el motor. No se inserta esa entrada en la base real.
Si falta, devuelve []; si su formato es incompatible, falla de forma controlada.
Los valores sintéticos usados en tests pertenecen a fixtures descartables.
No hay endpoint nuevo de cobranza, scheduler, mensajes ni pipeline comercial.

## Clasificación de settings existentes

La tabla real ya contiene company_id e índice (company_id,setting_key). No
requiere una nueva tabla ni migración para almacenar configuración de empresa.
Los ocho registros actuales tienen NULL y se conservan sin editar:

| Clave existente | Clasificación y evolución |
| --- | --- |
| iva_percentage | Configuración fiscal de empresa; confirmar por formulario |
| prompt_payment_discount | Comercial de empresa; no se activa como descuento global |
| business_day_due_day | Calendario de empresa; pendiente de confirmar |
| payment_cutoff_day | Calendario comercial de empresa |
| reminder_days_before_due | Regla de recordatorio de empresa |
| reminder_days_after_due | Regla de seguimiento de empresa |
| daily_message_limit | Límite operativo del canal de cada empresa |
| contact_line | Contacto de la empresa |

No hay una clave real de esa lista que se adopte como configuración universal
de plataforma. JWT, CORS, cookies y conexión a servicios son configuración
técnica global existente por ENV. Una futura cuota técnica del proveedor debe
ser una configuración de plataforma explícita, distinta de los límites de
mensajes propios de cada empresa.

`getCompanySettings` exige un company_id válido y solo lee esa empresa.
No hereda valores de filas NULL. El índice actual permite múltiples filas
NULL con la misma clave; no se convierte esa situación en precedencia/fallback.
Antes de introducir settings globales nuevos debe definirse su catálogo y
unicidad con una migración posterior específica, sin destruir filas actuales.

## Plantillas, mensajes, contactos e integración futura

message_templates ya distingue company_id, channel, stage y status. status
active representa una plantilla activa; no se añade una columna duplicada.
`getCompanyMessageTemplates` exige empresa explícita, filtra active y permite
filtrar canal/etapa. No devuelve plantillas de otra empresa ni filas NULL.
No existe fallback global comercial en esta fase.

messages ya identifica company_id, cliente, factura, template_id, canal,
provider y provider_message_id. No existen rutas HTTP de envío/consulta
operativas; siguen pendientes. Antes de implementarlas se deben comprobar
empresa de cliente, factura, plantilla, usuario y configuración del canal,
incluido el alcance de callbacks y colas del proveedor. Los import_errors
heredan el alcance de import_batches; las asignaciones, de payment/invoice.

La futura integración será Company → configuración de canal/WhatsApp →
provider → messages. Cada empresa tendrá plantillas, credenciales del canal,
límites, destinatarios y contactos propios. Los secretos deberán referenciar
almacenamiento seguro por empresa, sin tokens reales en código, settings
visibles, logs ni Git. No se implementa WhatsApp Cloud API ni se guardan tokens.

## Auditoría e historial

audit_logs ya tiene company_id y su FK. Los eventos de autenticación actuales
conservan el contexto del usuario real; un admin global genera eventos globales
NULL. Las pruebas verifican ambos casos. No se añaden eventos financieros que
no existían, se eliminan logs ni se modifica la retención histórica.
Los futuros eventos empresariales deben llevar la empresa del recurso
autorizado, incluso si los ejecuta un global; los cambios administrativos de
plataforma pueden usar NULL. Historial/cobranza/mensajes/reportes aún sin
endpoints deben reutilizar scope y permisos; history.view de collector conserva
su restricción adicional de propio usuario cuando se implemente.

## Inventario real y estrategia de asignación posterior

Consulta de solo lectura antes del trabajo y comparación al cierre:

| Tabla | Filas | company_id NULL |
| --- | ---: | ---: |
| companies | 0 | No aplica |
| users | 1 | 1 (admin global) |
| user_roles | 1 | No aplica |
| customers | 8 | 8 |
| invoices | 42 | 42 |
| payments | 2 | 2 |
| payment_allocations | 16 | Derivado de sus padres |
| settings | 8 | 8 |
| message_templates, messages, audit_logs, collection_actions, payment_promises, import_batches | 0 cada una | 0 |

No se reasigna ninguna fila, se cambia un balance ni se crea una organización.
La comparación de checksums de las 14 tablas inventariadas confirmó que todas
sus filas permanecen exactamente iguales al cierre de las pruebas.
Los datos legacy NULL quedan visibles únicamente al global. Para conservar
las operaciones financieras históricas, ese global puede trabajar con
documentos/clientes ambos NULL y aplicar/reversar pagos ambos NULL; nunca
mezclar NULL con una empresa real. Crear un cliente nuevo exige empresa.
No hay una ruta HTTP para trasladar estos registros a otra empresa.

Después de confirmar identidad oficial y formulario de MERTEL Importaciones:
crear su empresa mediante proceso autorizado; identificar de forma inequívoca
el origen de cada cliente/documento/pago; ensayar la asignación en una copia;
validar todos los enlaces e historial; preparar una migración de datos
explícita y respaldada; comparar balances/conciliación antes y después.
Los settings históricos se revisarán clave por clave, sin copiar reglas por
defecto. El admin global debe permanecer NULL; los futuros usuarios normales
recibirán la empresa confirmada. Esta migración de datos no se ejecutó aquí.

## Verificación y comparación con línea base

Línea base: 109/109 backend, sin omisiones. La nueva suite añade 29 pruebas
(23 HTTP/MySQL + 6 unitarias) en una base temporal con nombre UUID validado.
Ningún fixture crea usuarios o empresas en la base de aplicación.

| Suite/check | Resultado final |
| --- | --- |
| Auth | 34/34 |
| Autorización/provisioning | 19/19 |
| Multiempresa/IDOR | 29/29 |
| Integridad financiera | 37/37 |
| Cartera (cálculo) | 7/7 |
| Motor de cobranza | 12/12 |
| Backend completo (npm test) | 138/138, sin omisiones |
| Frontend lint | Aprobado |
| Frontend build, API final por ENV | Aprobado |
| git diff --check | Aprobado |

Dos escenarios antiguos se ajustan explícitamente por el nuevo aislamiento:
la factura ya no puede cambiar de empresa sin historial; y NULL ya no es un
comodín para asignar entre empresas. Se mantiene el cambio de cliente permitido
dentro del mismo alcance cuando no hay historial. No se relajan expectativas
de importes, balances, reversión o concurrencia. Auth y autorización adaptan
sus fixtures a usuarios/clientes de empresa; no se omiten pruebas.

La primera ejecución de la nueva suite detectó un problema en su preparación:
se intentó ejecutar una tabla de importación no usada con una palabra reservada
en la 001. Se limitó el fixture a las tablas necesarias, sin editar la 001.
También se corrigió el orden de importación del pool en el fixture para que se
cree después de configurar su base temporal. Ninguno de esos fallos se ocultó
ni se solucionó modificando el esquema real.

Se verifican listas/detalles A/B, mismo NIT/número en empresas diferentes,
PUT/DELETE ajenos, creación y referencias cruzadas, cuerpos/query/headers/JWT
manipulados, contexto actualizado, company NULL, empresa inactiva/eliminada,
admin global/de empresa, scope administrativo explícito, transacciones y
rollback, reallocation/concurrencia, joins históricos inconsistentes, cartera
solo lectura, settings/plantillas sin fallback, motor con reglas distintas,
auditoría y comparación exacta de empresas BIGINT adyacentes.
private_sql_failure de la suite financiera es su fallo inducido de rollback,
preexistente; no representa un fallo final de tests.

## Límites y Git

No se modificó visualmente el login ni ningún archivo frontend. No hay selector
de empresa, nuevas reglas comerciales, descuentos, días, productos excluidos,
calendario, promesas, usuarios reales, registro/recuperación pública ni WhatsApp.
Los montajes empresariales existentes están aislados; los módulos sin rutas
operativas quedan documentados y no se presentan como implementados.

No se crea 006 porque los campos/FK/índices existentes satisfacen esta fase.
No se ejecuta ninguna migración contra la base real. La 001 conserva la
modificación previa y hash Git e2f0b2c49c979991914a187dc9531d9c5d2117ce, fuera
del commit. Solo se añaden archivos explícitos de FASE 4.6C, sin git add .

Commit solicitado: feat: implementar arquitectura multiempresa; push
origin/main. El hash, resultado del push, comparación final de la base y
estado de Git se entregan al cierre sin crear una referencia circular aquí.
