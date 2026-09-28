# Extraer boletas, y rangos largos en una hoja aparte

Hasta ahora el scraper de CPE entraba a SOL con la cuenta **general del SIRE**,
que solo tiene acceso a **facturas y notas** (FE, NC, ND). Las boletas no
estaban porque esa cuenta no las podía ver, no porque el scraper no supiera
bajarlas.

Con el acceso ampliado de SOL eso cambia. Este documento dice qué se preparó,
qué falta averiguar contra el portal real, y en qué orden hacerlo.

---

## 1. Qué se preparó

### El catálogo de tipos: `lib/sunat/cpe-consulta.ts`

Antes, los tipos a consultar eran seis nombres sueltos en una variable de
entorno, y el camino del menú estaba escrito a mano dentro del script. Eso
servía mientras **todos** los tipos vivieran en la misma pantalla. Las boletas
no tienen por qué vivir ahí, así que ahora cada tipo dice por dónde se llega:

| Nombre | Etiqueta en el portal | Código SUNAT | Menú | ¿Confirmado? |
|---|---|---|---|---|
| FE Emitidas | FE Emitidas | `10` | Empresas › Consulta de Facturas y Notas Electrónicas | sí |
| FE Recibidas | FE Recibidas | `11` | ídem | sí |
| NC Emitidas | NC Emitidas | `13` | ídem | sí |
| NC Recibidas | NC Recibidas | `14` | ídem | sí |
| ND Emitidas | ND Emitidas | `15` | ídem | sí |
| ND Recibidas | ND Recibidas | `16` | ídem | sí |
| BVE Emitidas | BVE Emitidas | — | Empresas › Comprobantes de pago › SEE - SOL › Boleta de Venta Electrónica › Consultar Boleta de Venta y Nota | sí |
| BVE Recibidas | BVE Recibidas | — | ídem | sí |
| NC-BVE Emitidas | NC-BVE Emitidas | — | ídem | sí |
| ND-BVE Emitidas | ND-BVE Emitidas | — | ídem | sí |

Las cuatro etiquetas de boleta son **las que ofrece el desplegable**, leídas de
la captura del portal. Que las notas de boleta solo existan **Emitidas** no es
un olvido: el portal no ofrece «NC-BVE Recibidas» ni «ND-BVE Recibidas», y
agregarlas por simetría serían dos consultas condenadas a fallar.

Las boletas no llevan código porque su pantalla usa un `<select>` de verdad: lo
que se verifica ahí es el **texto de la opción elegida**, no un campo oculto.

## Las dos pantallas no se parecen

Esto es lo que más sorprendió al mirar el portal. No es el mismo formulario con
opciones nuevas: está armado distinto de arriba abajo.

| | facturas y notas | boletas |
|---|---|---|
| menú | acceso directo, dos clics | el árbol entero, cinco clics |
| campos de fecha | `fec_desde` / `fec_hasta` | «Fecha de Inicio» / «Fecha de Fin» (nombres desconocidos) |
| Tipo de Consulta | combobox de jQuery (`#criterio.tipoConsulta` + campo oculto) | `<select>` de HTML |
| resultados | grilla dojox, **virtualizada** | tabla HTML común |
| descargar | `consultaFactura.descargar(i)` | clic en el enlace |

La última fila es la que más importa. El arreglo que costó media docena de
commits —bajar por índice de fila porque la grilla dojox solo pinta ~25 filas y
recicla el DOM al scrollear— **no hace falta acá**: una tabla HTML común trae
todas las filas en el documento, así que contar los enlaces y clicarlos (el
camino viejo, el que en la grilla se quedaba en 25 de 400) es exactamente lo
correcto.

Por eso en el script son **dos motores separados** (`consultarFacturas` y
`consultarBoletas`), no una función con `if`s: no comparten casi nada, y
enredarlos pondría en riesgo el camino de facturas, que ya está probado contra
datos reales.

### Lo único que sigue sin saberse

**Cómo se llaman los campos de fecha de la pantalla de boletas.** El portal
solo muestra las etiquetas; un atributo `name` no se ve en una captura. El
script los busca en dos pasos y **dice en el registro cuál funcionó**:

1. por la etiqueta de su fila (`tr` que contiene «Fecha de Inicio»), que es lo
   que sí se ve y no cambia aunque SUNAT renombre el campo;
2. por posición entre los campos de texto, que es como está armado ese
   formulario de tres filas.

Si ninguno lo encuentra, **abandona esa consulta**. Aceptar con el rango que
estuviera puesto traería otro período y quedaría archivado como si fuera el
pedido.

### El enlace dice «Factura» aunque sea una boleta

En la tabla de boletas el enlace de descarga se rotula **«Descargar Factura
(XML)»**. Es del portal, no un error de lectura. Por eso el script busca el
enlace por **`(XML)`** y no por la palabra «Factura»: el rótulo puede corregirse
cualquier día, pero lo que distingue el XML del PDF es el formato.

### La red de seguridad: no bajar un tipo por otro

El riesgo concreto: si el tipo pedido no queda seleccionado, el formulario se
queda con lo que tenía y la consulta baja **otra cosa**. El registro diría «BVE
Recibidas: 112 comprobantes» y se archivarían facturas bajo el nombre de
boletas. Nadie lo notaría.

Por eso se **verifica antes de bajar**, en las dos pantallas:

- **facturas**: se compara el campo oculto `tipoConsulta` contra el código
  conocido del tipo (`10`, `11`, `13`…) y se abandona si no coincide;
- **boletas**: se lee el texto de la opción que quedó elegida en el `<select>` y
  se compara con la pedida.

La comparación de boletas es **exacta**, no «que contenga», y eso importa:
`NC-BVE Emitidas` **contiene** `BVE Emitidas`. Con una comparación floja, pedir
la nota de crédito podría elegir la boleta — justo el error que no se nota
mirando el resultado.

Es la diferencia entre un run que falla claro y un run que miente.

### La hoja aparte

La hoja histórica —**COMPROBANTES SUNAT - DETALLE**— trae todo y crece sin
parar. Para revisar dos meses concretos, o para pasárselos a alguien sin
mandarle el archivo entero, el workflow nuevo deja además una hoja con el rango
en el nombre:

```
COMPROBANTES SUNAT - DETALLE 2026-08 a 2026-09
```

El nombre es **estable**: volver a correr el mismo rango reemplaza esa hoja en
vez de dejar otra al lado. Se llena desde la base, no desde lo que se acaba de
bajar, así que sale completa aunque la corrida solo haya agregado lo que
faltaba.

Al final el registro imprime el desglose por tipo de comprobante:

```
· ítems por tipo de comprobante: 01=1843 03=207 07=44
```

Ese `03` es la comprobación de un vistazo de que las boletas entraron.

### El corte por mes

Pedirle a SUNAT dos meses en **una sola** consulta es justo lo que disparó el
`User rate limit exceeded` al rellenar meses viejos. El workflow nuevo parte el
rango en **una consulta por mes calendario** (`PARTIR_POR_MES=1`), y cada tanda
cae dentro de un solo período tributario, que es como se mira el resultado
después.

En modo depuración no se parte: ahí el objetivo es ver qué ofrece el portal, y
eso se ve igual en una consulta que en seis.

---

## 2. Las credenciales: dos secretos nuevos, no reemplazar los viejos

El scraper busca primero `SUNAT_SOL_USUARIO` / `SUNAT_SOL_CLAVE` y **cae** a los
del SIRE (`SUNAT_INROPRIN_USUARIO` / `SUNAT_INROPRIN_CLAVE`) si los primeros no
están.

**No sobreescribir los del SIRE con la cuenta nueva.** Esos dos secretos no los
usa solo este scraper: `scripts/sunat-diario.mts` los usa para la **API del
SIRE**. Si la cuenta nueva no tiene habilitada esa API, reemplazarlos rompe la
consulta diaria del registro de compras sin ninguna señal.

Con secretos separados: cada cosa usa el acceso que le toca, y si la cuenta
nueva falla, lo que ya funcionaba sigue en pie.

Mientras los secretos nuevos no estén puestos, **todo se comporta exactamente
como antes** (y sin boletas, claro).

---

## 3. El orden de las cosas

> **El botón «Run workflow» solo aparece si el archivo está en la rama
> principal.** Es una regla de GitHub para los workflows manuales. Mientras
> `extraer-cpe-rango.yml` viva solo en una rama de trabajo, no se puede
> disparar desde la pestaña Actions.

### Paso 1 — correr en modo «solo mirar»

Actions → **SUNAT extraer rango (hoja aparte)** → Run workflow, con
`debug = true` (es lo que viene marcado). No baja nada. Entra, recorre el menú y
deja en el registro:

- los campos reales del formulario de boletas (`▚ FRAME …`, con el `name` de
  cada uno) — que es lo que falta saber;
- cuál de los dos caminos encontró cada fecha
  (`· «Fecha de Inicio» = … (por la etiqueta de la fila)`);
- las opciones del desplegable (`· opciones del desplegable nº 1: …`);
- cuántas filas ve en la tabla de resultados.

Más las capturas y el HTML de cada paso como artefacto `capturas-sunat-rango`.

### Paso 2 — ajustar si hizo falta

Si el registro muestra que las fechas se encontraron **por posición** y no por
la etiqueta, conviene anotar en `cpe-consulta.ts` los `name` reales que salgan
en la radiografía y buscarlos directo, que es más firme.

Si SUNAT renombra una entrada del menú, el input `menu_boletas` permite probar
otro camino sin tocar código: los textos separados por `>`.

### Paso 3 — correr de verdad

El mismo workflow con `debug = false`. Es seguro repetirlo: Drive detecta «ya
estaba» y la base actualiza en vez de duplicar.

---

## 4. Qué NO cambió

El workflow diario `descargar-cpe.yml` usa el mismo script, pero **no cambia de
comportamiento**: sigue con sus seis tipos, su ventana de dos días y la cuenta
del SIRE. Lo nuevo se prende con variables que solo pone el workflow nuevo
(`PARTIR_POR_MES`, `HOJA_DEL_RANGO`, `MENU_BOLETAS`, `SUNAT_SOL_*`).

Conviene dejarlo así hasta que la cuenta nueva esté probada. Cuando lo esté,
pasar el diario a la cuenta nueva es agregarle dos líneas de `env`.

---

## 5. Lo que sigue sin resolver

- **Las boletas que el técnico pidió a su nombre siguen sin aparecer.** `BVE
  Recibidas` trae las boletas donde el **RUC de la empresa** es el adquiriente
  —se confirmó en el portal: emisores como `10209958258`, proveedores pequeños
  con RUC de persona natural—. Una boleta emitida al **DNI del trabajador** no
  está vinculada al RUC de la empresa en ningún registro de SUNAT, así que
  ninguna pantalla del portal la va a devolver. Es el mismo límite ya anotado
  en `docs/descarga-cpe-y-detalle-de-items.md`, y este cambio no lo cierra.
- **Los comprobantes anulados.** Acá hay una novedad: la tabla de boletas **sí
  trae una columna «Comprobante Anulado»**, que la grilla de facturas no tiene
  (§4 de `docs/scraper-cpe-hallazgos-tecnicos.md`). No se está leyendo todavía
  —habría que decidir antes si un anulado se guarda y se marca, o se excluye
  del detalle—, pero por primera vez el dato está a la vista.
- **El PDF de las boletas.** La columna de descarga del PDF quedó cortada en la
  captura, así que el script busca el enlace de forma flexible y, si no lo
  encuentra, **baja solo el XML y lo dice**. El XML es el que trae el detalle de
  ítems; el PDF es un extra.
