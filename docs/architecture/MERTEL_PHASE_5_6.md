# Fase 5.6 — Historial y trazabilidad avanzada de cobranza

Fecha: 06/10/2026. Implementación de solo lectura sobre registros ya persistidos. El objetivo es dar contexto operativo a la cobranza sin crear otra fuente de verdad.

## Fuentes y alcance

El historial unifica, en tiempo de consulta, gestiones (`collection_actions`), promesas (`payment_promises`), cambios auditados de `settings.collection_rules` y lotes de análisis estructural (`import_batches`). Cada fila conserva su identidad de origen y se ordena por fecha descendente con ID como desempate estable. El filtro de compañía se aplica en backend a todas las fuentes y el cliente puede consultar únicamente actividad asociada a su cliente dentro de `companyScope`.

La vista del cliente se sirve en `GET /api/collection/customers/:customerId/history`. La vista administrativa y su catálogo de actores usan `GET /api/admin/collection/history` y `GET /api/admin/collection/history/actors`. Admiten paginación acotada y filtros por fecha, tipo de evento, actor, cliente/factura o texto; el backend valida los parámetros y entrega datos presentacionales sin secretos. `Cache-Control: no-store` evita almacenar respuestas de historial en cachés HTTP.

El permiso existente `history.view` se activa sin cambiar sus grants de rol. El middleware exige `collection.view` en el router de cobranza y, para la vista global, `history.view` junto con `settings.manage`. Los collectors quedan limitados a su propio `user_id` en el backend para gestiones y promesas, aunque modifiquen parámetros del cliente. La consulta administrativa requiere `companyScope`; una cuenta global debe elegir una empresa activa explícitamente.

## Límites deliberados

No se duplica ni copia la historia a una tabla nueva, no se añaden migraciones o permisos y no se alteran datos. La preparación de WhatsApp es efímera y no constituye un envío; no aparece como evento enviado. Pagos y allocations se excluyen: no se añade ahora una interpretación de eventos financieros al timeline. Importaciones muestran únicamente el resultado/metadata del análisis estructural, que no aplica cambios a cartera. Los cambios de reglas exponen solo claves y estados operativos necesarios, no el JSON completo ni valores sensibles.

La pantalla del cliente agrega una sección de historial con tipo y paginación; los paneles existentes de gestiones y promesas siguen siendo sus fuentes operativas. La pantalla administrativa `/administracion/historial-cobranza` agrega selector de empresa global, fechas, tipo, usuario, búsqueda y páginas. Ninguna vista permite editar ni ejecutar acciones.

## Verificación

La cobertura verifica la autorización y validación del servicio, consultas HTTP con alcance propio y por empresa, orden estable/paginación, fuentes de configuración/importación, ausencia de filtración de valores sensibles y ausencia de mutaciones de saldos. Frontend y E2E cubren ambos historiales, filtros, permisos y anchos responsive. Verificación final: backend **237/237**, frontend **124/124**, lint **OK**, build de producción **OK** y E2E Playwright **53/53**.
