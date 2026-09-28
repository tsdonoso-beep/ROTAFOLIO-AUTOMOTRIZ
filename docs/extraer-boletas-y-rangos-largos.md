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

## 2. Las dos pantallas SÍ se parecen — y esto se creyó al revés

Vale la pena dejarlo escrito, porque el error costó código de más.

Mirando las capturas del portal, las dos pantallas se ven distintas: la de
boletas parece tener un `<select>` de HTML común donde la de facturas tiene un
combobox, y su tabla de resultados parece una tabla simple donde la otra tiene
la grilla dojox. De ahí se concluyó que estaban armadas distinto de arriba
abajo, y se escribió un **motor aparte** para boletas.

La radiografía del primer run (28/09/2026) lo desmintió:

```
▚ FRAME https://ww1.sunat.gob.pe/ol-ti-itconscpemypebve/consultar.do
   inputs=36 selects=0
     · input#criterio.fec_desde[name=fec_desde type=text]
     · input#criterio.fec_hasta[name=fec_hasta type=text]
     · input#criterio.tipoConsulta[name=- type=text]
     · input#-[name=tipoConsulta type=hidden]
```

**Cero `<select>`**, y exactamente los mismos nombres de campo que la pantalla
de facturas. Es la misma aplicación desplegada dos veces:
`ol-ti-itconscpemype` y `ol-ti-itconscpemype`**`bve`**. El motor aparte sobraba
entero y se borró — 169 líneas menos.

Lo único que cambia de verdad:

| | facturas y notas | boletas |
|---|---|---|
| menú | acceso directo, dos clics | el árbol entero, cinco clics |
| módulo | `ol-ti-itconscpemype` | `ol-ti-itconscpemypebve` |
| etiquetas | FE / NC / ND | BVE / NC-BVE / ND-BVE |
| formulario | **idéntico** | **idéntico** |

Y el camino del menú ya lo dice el catálogo, así que el código no necesita
preguntarse en cuál de las dos está.

**La moraleja para la próxima:** una captura muestra cómo se VE una pantalla,
no cómo está construida. Para eso está la radiografía del modo depuración, y
conviene correrla ANTES de escribir código que dependa de la estructura.

### El enlace dice «Factura» aunque sea una boleta

En la tabla de boletas el enlace de descarga se rotula **«Descargar Factura
(XML)»**. Es del portal, no un error de lectura.

Por eso el script busca el enlace por **`(XML)`** y no por «Descargar Factura»,
que era lo que buscaba antes. Ese cambio arregla de paso un problema viejo: con
«Descargar Factura», el respaldo por enlaces **nunca veía las notas de crédito
ni de débito** —se rotulan «Descargar NC (XML)»— y contaba cero aunque hubiera
filas.

### La sonda antes de bajar por índice

El arreglo que costó media docena de commits —bajar llamando
`consultaFactura.descargar(i)` en vez de clicar, porque la grilla dojox solo
pinta ~25 filas y recicla el DOM— depende de que esa función exista en la
página. Con un módulo más en juego, eso dejó de estar garantizado.

Y falla de la peor manera: `descargar(i)` no devuelve nada, así que si el objeto
no está **no pasa NADA** —ni error ni descarga— y el que espera el archivo
agota sus 60 segundos. Con 400 filas son casi siete horas sin hacer nada antes
de rendirse.

Ahora se comprueba que la función exista **antes** de comprometerse con ese
camino. Si no está, se baja clicando los enlaces; y si además la tabla está
virtualizada, el registro dice cuántas filas quedarían fuera en vez de cortarse
en silencio.

### La red de seguridad: no bajar un tipo por otro

El riesgo concreto: si el tipo pedido no queda seleccionado, el formulario se
queda con lo que tenía y la consulta baja **otra cosa**. El registro diría «BVE
Recibidas: 112 comprobantes» y se archivarían facturas bajo el nombre de
boletas. Nadie lo notaría.

Por eso se **verifica antes de bajar**, y con qué se compara depende de lo que
se sepa del tipo:

- **con código conocido** (los de factura): contra el campo oculto
  `tipoConsulta`, que es el dato que de verdad viaja a SUNAT. Se abandona si no
  coincide con `10`, `11`, `13`…
- **sin código** (los de boleta, todavía): contra lo que muestra el campo
  visible. Es más flojo, pero atrapa el caso que importa — que el combobox se
  haya quedado en otra cosa.

La comparación es **exacta**, no «que contenga», y eso importa: `NC-BVE
Emitidas` **contiene** `BVE Emitidas`. Con una comparación floja, pedir la nota
de crédito podría elegir la boleta — justo el error que no se nota mirando el
resultado.

La verificación **insiste** antes de rendirse: los campos se actualizan por un
evento del combobox, no en el mismo tic del clic, y abandonar por medio segundo
de desfase rompería consultas que iban bien.

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

## 3. Las credenciales: dos secretos nuevos, no reemplazar los viejos

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

## 4. El orden de las cosas

> **El botón «Run workflow» solo aparece si el archivo está en la rama
> principal.** Es una regla de GitHub para los workflows manuales. Mientras
> `extraer-cpe-rango.yml` viva solo en una rama de trabajo, no se puede
> disparar desde la pestaña Actions.

### Paso 1 — correr en modo «solo mirar»

Actions → **SUNAT extraer rango (hoja aparte)** → Run workflow, con
`debug = true` (es lo que viene marcado). No baja nada. Entra, recorre el menú y
deja en el registro:

- los campos reales del formulario (`▚ FRAME …`, con el `name` de cada uno);
- las opciones que ofrece el «Tipo de Consulta» con este acceso;
- el código que quedó puesto (`tipo(hidden)=…`);
- cuántas filas ve en la tabla de resultados.

Más las capturas y el HTML de cada paso como artefacto `capturas-sunat-rango`.

### Paso 2 — anotar los códigos de boleta

Si el registro imprimió `· «BVE Recibidas» → tipoConsulta=XX`, conviene anotar
ese código en `cpe-consulta.ts`. Con el código puesto, la verificación pasa a
comparar contra el dato que de verdad viaja a SUNAT, en vez de contra el texto
que muestra el campo visible.

Si SUNAT renombra una entrada del menú, el input `menu_boletas` permite probar
otro camino sin tocar código: los textos separados por `>`.

### Paso 3 — correr de verdad

El mismo workflow con `debug = false`. Es seguro repetirlo: Drive detecta «ya
estaba» y la base actualiza en vez de duplicar.

---

## 5. Qué NO cambió

El workflow diario `descargar-cpe.yml` usa el mismo script, pero **no cambia de
comportamiento**: sigue con sus seis tipos, su ventana de dos días y la cuenta
del SIRE. Lo nuevo se prende con variables que solo pone el workflow nuevo
(`PARTIR_POR_MES`, `HOJA_DEL_RANGO`, `MENU_BOLETAS`, `SUNAT_SOL_*`).

Conviene dejarlo así hasta que la cuenta nueva esté probada. Cuando lo esté,
pasar el diario a la cuenta nueva es agregarle dos líneas de `env`.

---

## 6. Lo que sigue sin resolver

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
- **Los códigos de `tipoConsulta` de las boletas.** Los de facturas están
  confirmados (`10`, `11`, `13`, `14`, `15`, `16`); los de boleta todavía no se
  vieron, porque el primer run se cortó antes de elegir el tipo. Mientras sean
  desconocidos, lo que se verifica es que el combobox quede mostrando la
  etiqueta pedida: más flojo que comparar el código, pero atrapa el caso que
  importa. El próximo run los imprime.
- **La tabla de resultados de boletas.** Todavía no se llegó a verla desde el
  script. Puede ser la grilla dojox o una tabla común; el código se adapta a
  las dos y dice en el registro cuál encontró.
