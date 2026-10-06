# MERTEL como contexto único

Esta aplicación está dedicada a **MERTEL IMPORTACIONES**. No ofrece selección, cambio ni administración de empresas desde la interfaz. La columna `company_id` y `companyScope` permanecen como controles internos de aislamiento, integridad referencial y auditoría.

## Resolución del contexto

Las rutas operativas pasan por `requireCompanyScope`. El middleware resuelve en la base la única fila activa y no eliminada cuyo nombre es `MERTEL IMPORTACIONES`, y fija su identificador en el alcance de la petición. Un `company_id` de consulta solo se tolera si coincide con ese identificador; cualquier otro valor se rechaza. Las asociaciones no nulas de una cuenta a otra empresa también se rechazan. El administrador global existente puede conservar `users.company_id=NULL`: su alcance autenticado se fija a MERTEL sin cambiar sus credenciales ni su fila de usuario.

Si falta la fila MERTEL, está inactiva o hay duplicados, las rutas fallan de forma cerrada. Ningún endpoint de la aplicación crea empresas.

## Provisioning

Tras aplicar las migraciones de esquema requeridas, desde `backend/` se puede ejecutar:

```sh
npm run provision:mertel
```

El script toma un bloqueo advisory de MySQL, crea MERTEL solamente si no existe y reutiliza una fila activa existente. En caso de duplicidad o estado inactivo se detiene y requiere revisión. El provisioning es un dato de instancia, no DDL; por eso se implementa como script y no como migración. No se debe ejecutar una reparación general de migraciones como parte del provisioning.

## Datos e historial

No se reasignan registros históricos a una compañía por inferencia. En esta instancia, tras consultar los conteos y relaciones y pedir confirmación, el usuario autorizó eliminar el conjunto identificado como datos de prueba: 8 clientes, 42 facturas, 2 pagos, 16 aplicaciones, 8 settings y 6 eventos de auditoría, todos con `company_id=NULL`. Se verificaron cero acciones, promesas, plantillas, mensajes y lotes de importación; el usuario admin y los datos de autenticación se conservaron. La tabla `001_initial_schema.sql` no se usa como mecanismo de provisioning y conserva su edición local preexistente.

## Evolución técnica

El modelo relacional puede conservar `company_id` para proteger referencias y permitir una evolución explícita si el producto cambia. Esa posibilidad no constituye una función multiempresa actual: no se implementan selector, CRUD, cambio de contexto ni operación de otras compañías.

## Estado de migraciones local

La auditoría de esta instancia encontró incompleta la migración 006 de importación (`import_errors` ausente y columnas esperadas no presentes). Se documenta como pendiente separada; no se corrige ni se ejecuta automáticamente en esta fase.
