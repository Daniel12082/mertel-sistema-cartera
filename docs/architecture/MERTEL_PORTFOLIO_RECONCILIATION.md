# Conciliación de cartera MERTEL

## Objetivo y fuente

La conciliación compara temporalmente el XLSX real `cartera al 06-10.xlsx` con las facturas actuales de MERTEL. Reutiliza `parseMertelPortfolioXlsx`, que identifica la hoja `cartera de clientes NIIF0`, y agrega sus filas documentales completas a la salida estructurada. El archivo se procesa en memoria y no se persiste.

## Endpoint y acceso

`POST /api/admin/portfolio/imports/reconcile` acepta un XLSX, requiere `portfolio.import` y el contexto autorizado de MERTEL. La respuesta es `summary`, `results` y `metadata`. El acceso a MySQL usa una transacción de solo lectura y solo consultas `SELECT`; el análisis no crea lotes, eventos de auditoría ni registros de conciliación. La ruta fija `Cache-Control: no-store`.

## Identificación

El NIT se transforma a su representación canónica conservando solo dígitos; así coinciden valores Excel numéricos y texto como `800.001.269-0` y `8000012690`, sin alterar el valor original mostrado. Si identifica a más de un cliente activo en la empresa, la fila queda en ERROR. La clave documental completa para detectar repetidos es NIT canónico + número + tipo de movimiento + fecha de emisión. Para encontrar una factura existente aunque cambie su fecha, la comparación busca por NIT y número y luego compara la fecha como campo; múltiples coincidencias de factura en BD también generan ERROR.

## Categorías

Cada fila documental recibe una sola categoría: NEW, UPDATED, UNCHANGED, DISAPPEARED, DUPLICATE, RETURN, DEBIT_NOTE o ERROR. Duplicados tienen prioridad sobre el tipo de movimiento para evitar elegir una copia; el movimiento sigue visible como devolución/nota débito en sus datos de origen. Devoluciones y notas débito nunca se tratan como factura. Los resúmenes del reporte no son documentos y no participan.

Se comparan número, tipo de movimiento, fechas, valor documento, IVA, NIT, nombre, dirección, ciudad y observaciones, solo donde existe una representación en el esquema actual. Los importes se comparan como centavos enteros. Teléfonos, representante, departamento, cupo, vendedor, cobrador y zona se conservan como datos de origen para revisión, pero no se señalan como cambios frente a columnas que el modelo actual no almacena.

## Límites financieros

La conciliación nunca escribe `invoices`, `payments`, `payment_allocations` ni `customers`; no actualiza balances ni aplica documentos. El saldo solo aparece como dato actual de BD para facturas ausentes. “No aparece en archivo actual” no significa pagado, cancelado, eliminado o saldo cero. Las devoluciones y notas débito se muestran como movimientos informativos, sin impacto aplicado.

La pantalla permite revisar resumen, filtrar y abrir detalles, pero no ofrece acción de aplicación. Una futura aplicación requerirá una fase separada con reglas de aprobación, correspondencia, tratamiento contable y pruebas transaccionales explícitas.
