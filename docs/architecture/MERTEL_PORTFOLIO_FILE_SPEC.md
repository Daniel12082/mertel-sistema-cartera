# Especificación de cartera MERTEL — Excel de entrada

Actualizado: 06/10/2026. Este documento define el análisis estructural del archivo de cartera MERTEL. No autoriza la aplicación financiera de sus filas.

## Fuente observada

- Archivo: `cartera al 06-10.xlsx` (955.390 bytes en la copia revisada).
- Empresa indicada en el reporte: MERTEL IMPORTACIONES S.A.S.
- NIT de empresa: `900.499.744-8`.
- Fecha de corte del título: 06/10/2026. La hora de generación que aparece en el reporte no cambia la fecha de negocio.
- Hojas: `cartera de clientes NIIF0` (principal) y `Hoja1`. El parser requiere el nombre exacto de la hoja principal.
- El encabezado aparece en la fila 7, después de metadata y filtros. Se conserva el texto original de las 27 columnas.
- El archivo real cabe en el límite de 2 MiB ya aplicado por el endpoint.

## Encabezados y clasificación

Las columnas de origen son, sin renombrarlas en el archivo: `Cobrador`, `Nit Cliente`, `Nombre cliente`, `Rep Legal`, `Direccion`, `Ciudad`, `Departamento`, `Telefono`, `Celular`, `Cupo`, `Numero`, `Movimiento`, `Emitida`, `Vence`, `Días Emitida`, `días Vencida`, `Corriente`, `1-30 días`, `30-45 días`, `45-60 días`, `60-90 días`, `+90 días`, `Valor doc.`, `IVA`, `Observaciones`, `Vendedor`, `Zona`.

El parser busca los cuatro encabezados centrales (`Nit Cliente`, `Numero`, `Movimiento`, `Emitida`) ignorando mayúsculas, espacios repetidos y diacríticos al comparar. Reporta columnas requeridas ausentes y encabezados duplicados; la respuesta conserva los nombres hallados en el libro.

Cada fila posterior se clasifica sin escribir información financiera:

| Categoría | Regla | Uso |
|---|---|---|
| `DOCUMENT` | Tiene NIT, número, movimiento y fecha de emisión | Validar y previsualizar el movimiento original |
| `CUSTOMER_SUMMARY` | Tiene NIT, no tiene número/movimiento/fechas de documento y contiene datos de cartera | Reconocer resumen por cliente; no contarlo como documento |
| `REPORT_SUMMARY` | Totales, porcentajes u otras filas del reporte sin identidad de cliente/documento | Diagnóstico del reporte; no crear cliente ni factura |
| `EMPTY` | Ningún campo útil de las columnas de cartera tiene valor | Contar separadores y filas vacías |
| `INVALID` | La fila parece documento o cliente, pero carece de identificador esencial | Reportar el error y conservar la fila para revisión |

Las filas resumen por cliente y los totales generales no son facturas. La previsualización muestra hasta 25 filas no vacías y etiqueta el tipo detectado.

## Resultado medido en la copia revisada

El parser devolvió estos conteos exactos; las cifras no son reglas para otros reportes:

| Medida | Resultado |
|---|---:|
| Filas tras el encabezado | 4.121 |
| Clientes por NIT único | 961 |
| Filas documento | 2.177 |
| Documentos únicos | 2.177 |
| `012 Factura de venta credito` | 1.827 |
| `023 Devolucion de clientes` | 347 |
| `014 Nota debito cliente` | 3 |
| Resúmenes por cliente | 968 |
| Filas de resumen/totales del reporte | 6 |
| Filas vacías/separadoras | 970 |
| Filas inválidas/errores en este archivo | 0 |
| Movimientos desconocidos | 0 |
| Duplicados con la clave definida abajo | 0 |

La observación inicial decía aproximadamente 4.119 filas y 2.178 documentos. En esta ejecución el rango real de filas de datos es 4.121 y hay 2.177 filas-documento / claves distintas. Se reporta lo leído por la copia, sin ajustar el Excel para que coincida con la aproximación.

## Identidad de cliente y normalización

`Nit Cliente` es la identidad primaria; `Nombre cliente` solo es un atributo descriptivo. La respuesta incluye el NIT original y una forma normalizada que recorta extremos y colapsa espacios internos. Conserva puntos, guion y dígito de verificación; no transforma el original ni usa el nombre para deduplicar.

El modelo actual `customers` ya dispone de `nit`, `name`, `address`, `city`, `phone`, `credit_limit` y campos financieros/crédito. El NIT y nombre encajan directamente. `Direccion` y `Ciudad` tienen equivalentes; `Telefono` y `Celular` no caben ambos en el único `phone` sin decidir precedencia. `Departamento`, `Rep Legal`, `Cobrador`, `Vendedor` y `Zona` no tienen un campo dedicado equivalente en el modelo actual. No se crean columnas ni usuarios en esta fase.

`Cupo` se analiza por separado como valor numérico (`cupo_amount`) y texto restante (`cupo_condition`, por ejemplo “compartido”). No activa crédito ni modifica `credit_limit`.

## Documentos y campos financieros

La clave de detección de duplicado es `NIT normalizado + Numero + Movimiento original + Emitida normalizada`. `Numero` por sí solo no identifica el movimiento. Los duplicados se informan como advertencia; el parser no elimina ni combina filas.

Los movimientos reconocidos se clasifican como `invoice`, `return` y `debit_note`; el código y la descripción de `Movimiento` se conservan. Otros movimientos quedan `unknown` y requieren revisión. Una devolución o nota débito nunca se convierte automáticamente en factura.

El modelo `invoices` puede almacenar número, cliente, fechas, `document_value`, `base_value`, `iva_value` y `balance`, pero el archivo no resuelve por sí solo las reglas que conectan todos esos valores. `Valor doc.` se previsualiza como valor de documento y `IVA` como dato IVA; no se deduce `base_value` de ellos. `Emitida` y `Vence` se normalizan como fechas de negocio `YYYY-MM-DD` sin conversión UTC; `Días Emitida` y `días Vencida` solo se tratan como datos derivados/reportados.

Los campos de antigüedad describen la agrupación del reporte, no una fila de factura adicional. Sirven para diagnóstico y futura conciliación; no sustituyen `invoices.balance`. Observaciones se conserva como texto y nunca se interpreta como política o descuento. En particular, texto como “DSCTO 10” no activa un 10%.

Hoy `invoices` no tiene un campo de tipo de movimiento y no puede representar devoluciones/notas débito correctamente como facturas. Antes de una futura aplicación, se debe definir un modelo de movimientos de origen separado, con código/tipo, NIT, número, fecha, importes originales y referencia de lote/fila. No se añadió esa tabla ni se aplicó movimiento alguno aquí.

## Validaciones

El análisis reconoce extensión y MIME de `.csv` y `.xlsx`, aplica el límite actual de 2 MiB y conserva CSV. Para XLSX valida firma/libro, presencia de la hoja exacta, ubicación del encabezado, encabezados requeridos y límites de 10.000 filas de datos / 200 columnas. También informa identidad de empresa/NIT de origen incompatibles.

Por fila documento valida NIT, número, movimiento, fecha de emisión, vencimiento obligatorio para factura, valor del documento e IVA; detecta fechas o importes inválidos, movimientos no reconocidos y duplicados. Reporta filas vacías, resúmenes y filas incompletas. La copia real no generó incidencias.

Solo se guarda el lote de análisis con nombre, tipo, conteos, hash, estado y errores estructurales sin valores de celdas. No se guarda el archivo ni las filas/previsualización. No se insertan clientes, documentos, pagos, allocations o saldos. El lote continúa con estado `analyzed_unconfigured` para indicar que no existe un flujo autorizado de aplicación.

## Relación con tablas existentes

- `customers`: no duplicar clientes; clave futura sería NIT normalizado con reglas de preservación acordadas.
- `invoices`: no actualizar desde el análisis. Las devoluciones/notas débito necesitan un modelo de movimientos definido antes de poder aplicarse.
- `payments`, `payment_allocations` y `invoices.balance`: permanecen sin cambios.
- `import_batches` / `import_errors`: solo conservan metadata del análisis, hash y errores sin valores de origen.
- Empresa: el contexto backend es el MERTEL único; el archivo incompatible se señala. No hay selector ni selector de empresa en el frontend.

No se crea migración en esta fase. La migración protegida `001_initial_schema.sql` permanece fuera de alcance. La migración 006 de análisis, existente y previamente detectada como incompleta en la base local, no se ejecuta como parte de la adaptación del formato.

## Pendientes antes de aplicar cartera

1. Aprobar cómo conciliar `Valor doc.`, IVA, importes por antigüedad, pagos y saldo financiero actual; no inferir `base_value` ni `balance` desde la hoja.
2. Definir efectos, signos y reversión de devoluciones, notas débito, anticipos y cualquier otro movimiento.
3. Definir qué significa que una factura desaparezca y cómo reconocer una reaparición/reemisión.
4. Aprobar clave definitiva, edición/corrección de NIT y tratamiento de documentos repetidos o con números reutilizados.
5. Decidir la asignación operativa de Cobrador, teléfonos y necesidad de guardar representante legal, departamento, vendedor, zona y condición de cupo.
6. Confirmar significado contable de columnas de antigüedad, `Valor doc.` e IVA con MERTEL y cotejarlas con una fuente financiera autorizada.

Hasta cerrar esas decisiones, el alcance es entender, validar, clasificar, mostrar y preparar el archivo para una fase futura. La pantalla no ofrece una acción de aplicación.

## Dependencia y pruebas

El lector XLSX usa ExcelJS 4.4.0, biblioteca Node.js para cargar workbooks `.xlsx`; se fija un override de `uuid` a una versión corregida por la alerta transitiva de bounds check. CSV conserva su parser previo. Los tests generan un libro en memoria con los encabezados y movimientos observados, sin depender de la copia personal descargada.

Ver también el contrato de empresa única: [MERTEL_SINGLE_COMPANY.md](MERTEL_SINGLE_COMPANY.md).
