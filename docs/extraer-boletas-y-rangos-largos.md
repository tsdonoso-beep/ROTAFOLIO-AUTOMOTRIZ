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
| BVE Emitidas | BVE Emitidas | `17` | Empresas › Comprobantes de pago › SEE - SOL › Boleta de Venta Electrónica › Consultar Boleta de Venta y Nota | sí |
| BVE Recibidas | BVE Recibidas | `18` | ídem | sí |
| NC-BVE Emitidas | NC-BVE Emitidas | `20` | ídem | sí |
| ND-BVE Emitidas | ND-BVE Emitidas | `22` | ídem | sí |

Las cuatro etiquetas de boleta son **las que ofrece el desplegable**, leídas de
la captura del portal. Que las notas de boleta solo existan **Emitidas** no es
un olvido: el portal no ofrece «NC-BVE Recibidas» ni «ND-BVE Recibidas», y
agregarlas por simetría serían dos consultas condenadas a fallar.

### De dónde salieron los códigos de boleta

Del propio portal: el botón **Imprimir** de la tabla de resultados arma un
enlace que lleva el código en la URL.

```
…/ol-ti-itconscpemypebve/consultar.do?action=imprimirListado
   &periodoDesc=22/09/2026 - 25/09/2026&tipoConsulta=18
```

Así se confirmaron `17` (BVE Emitidas), `18` (BVE Recibidas) y `20` (NC-BVE
Emitidas). El de **ND-BVE Emitidas** no estaba en esos enlaces, así que quedó
en `null` —con el script imprimiéndolo en cuanto lo viera— en vez de anotar la
conjetura. El run del 28/09/2026 lo mostró:

```
· «ND-BVE Emitidas» → tipoConsulta=22  ← anotá este código
· form [ND-BVE Emitidas]: fec_desde=01/09/2026 fec_hasta=30/09/2026 tipo(hidden)=22
```

Era `22`. Los diez tipos quedan con código confirmado.

Lo que **no** se anota es lo que no se vio: el hueco en `19` y el `21` siguen
sin identificar, igual que el `12` del bloque de facturas. La conjetura que
acertó con el `22` se escribió como conjetura, y solo pasó al catálogo cuando
el portal la confirmó.

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

- **con código conocido** (nueve de los diez): contra el campo oculto
  `tipoConsulta`, que es el dato que de verdad viaja a SUNAT. Se abandona si no
  coincide con `10`, `11`, `13`, `17`, `18`, `20`…
- **sin código** (hoy solo ND-BVE Emitidas): se comprueba que el campo oculto
  **no haya quedado con el código de OTRO tipo** del catálogo. No sabemos cuál
  le toca a este, pero sí los de los otros nueve: si quedó puesto uno de esos,
  el combobox no resolvió lo que se tecleó y estaríamos por bajar ese otro tipo
  con el nombre de este.

Esa segunda regla nació de una lección del run del 28/09/2026. Ahí se vio que
en este portal la opción **casi nunca se encuentra en la lista**, y que lo
normal es entrar por el respaldo —teclear la etiqueta y pulsar Enter—:

```
⚠ no vi la opción «BVE Recibidas» en la lista; se teclea y se verifica.
· form [BVE Recibidas]: fec_desde=22/09/2026 fec_hasta=25/09/2026 tipo(hidden)=18
```

Para un tipo con código eso da igual: se verifica contra el `18` y listo. Pero
para uno sin código, comparar el campo visible contra la etiqueta sería
**vacío**: la etiqueta la acabamos de escribir nosotros en ese campo, así que
siempre coincidiría. Una verificación que no verifica es peor que ninguna,
porque da confianza.

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

### Paso 2 — anotar el código que falta

Si el registro imprimió `· «ND-BVE Emitidas» → tipoConsulta=XX`, anotarlo en
`cpe-consulta.ts`. Con el código puesto, la verificación pasa a comparar contra
el dato que de verdad viaja a SUNAT en vez de contra el texto que se ve.

Si SUNAT renombra una entrada del menú, el input `menu_boletas` permite probar
otro camino sin tocar código: los textos separados por `>`.

### Paso 3 — correr de verdad

El mismo workflow con `debug = false`. Es seguro repetirlo: Drive detecta «ya
estaba» y la base actualiza en vez de duplicar.

---

## 5. Qué NO cambió

*(Esto valía mientras la cuenta nueva no estuviera probada. Ya lo está — ver
abajo.)*

El workflow diario `descargar-cpe.yml` usa el mismo script. Durante el
desarrollo se lo dejó a propósito con sus seis tipos, su ventana de dos días y
la cuenta del SIRE, y lo nuevo se prendía solo con variables que ponía el
workflow nuevo (`PARTIR_POR_MES`, `HOJA_DEL_RANGO`, `MENU_BOLETAS`,
`SUNAT_SOL_*`).

### Desde el 28/09/2026 el diario también pide boletas

Se hizo el cambio recién con la cuenta nueva probada, que era la condición:

- «SUNAT extraer rango» bajó agosto y setiembre con ella, 8 consultas sin una
  falla;
- y el volcado del menú de esas corridas confirmó que esa misma cuenta **ve
  también la pantalla de facturas** («Consultar Factura y Nota» y «Consulta de
  Facturas y Notas Electrónicas» aparecen en su menú). Sin esa confirmación,
  pasarle el diario habría arriesgado lo que ya funcionaba.

Qué cambió, concretamente:

| | antes | ahora |
|---|---|---|
| tipos | 6 (FE/NC/ND) | **10** (+ BVE/NC-BVE/ND-BVE) |
| acceso | el del SIRE | `SUNAT_SOL_*`, con respaldo en el del SIRE |
| tope de tiempo | 90 min | **120 min** |

El tope sube porque una consulta que devuelve **cero** igual tarda ~90 s en
concluirlo: espera a que aparezca la grilla —que en un mes cargado puede
demorar 51 s— antes de caer al conteo de enlaces. Con diez tipos son ~15
minutos de esperas aunque no se baje nada.

Lo que **sigue sin cambiar**: la ventana de dos días, que es lo que evita
repetir cientos de descargas a diario y chocar con el límite de SUNAT; y que el
diario no publica la hoja del rango (`HOJA_DEL_RANGO` sigue apagado), solo la
histórica.

Si los secretos `SUNAT_SOL_*` se borraran, el diario **no se rompe**: el script
cae a los del SIRE y las cuatro consultas de boleta se saltan solas, diciéndolo
en el registro.

---

## 6. La trampa de «ÚLTIMOS ACCESOS»

Vale documentarlo porque cuesta un run entero y el síntoma miente.

El 28/09/2026 una corrida de agosto+setiembre con los cuatro tipos de boleta
terminó **en verde sin haber bajado nada**. Las ocho consultas fallaron igual:

```
· evidencia: menu-boleta-de-venta-electronica
⚠ no encontré «Consultar Boleta de Venta y Nota» en el menú de este acceso.
```

Pero el volcado del menú, en esa misma corrida, la mostraba:

```
– ÚLTIMOS ACCESOS
– Consultar Boleta de Venta y Nota      ← ahí está
...
– Boleta de Venta Electrónica           ← y el submenú de acá no se desplegó
```

**Qué pasaba.** Tras entrar una vez a esa opción, SOL la agrega a su panel
«ÚLTIMOS ACCESOS», arriba de la página. Ese panel está plegado: la entrada
existe en el documento pero no se puede clicar. Y como aparece ANTES en el
documento que la del árbol del menú, el `.first()` del buscador de clics caía
siempre en ella; Playwright esperaba a que se volviera clicable, no pasaba, y
a los 20 s se rendía — **sin haber probado nunca la del árbol, que sí
funciona**.

Tres cosas lo hacen especialmente feo:

1. **El síntoma miente**: dice «no encontré el texto» y el texto está ahí.
2. **Aparece solo después del primer uso exitoso.** El run que funciona es el
   que rompe el siguiente. Por eso la simulación de un solo tipo pasó y la
   corrida grande, al día siguiente, falló entera.
3. **Terminaba en verde.** Desde la lista de Actions era idéntico a «no había
   comprobantes en ese rango».

**Los tres arreglos**, que van juntos:

- `clicEnAlgunMarco` prueba **todas** las coincidencias de cada marco y se
  queda con la primera que se pueda clicar, en vez de apostar a la primera del
  documento.
- `marcoConsulta` devuelve `null` cuando el formulario no aparece, en vez de
  caer al marco con más campos de texto. Ese respaldo parecía prudente y era lo
  contrario: devolvía el marco del MENÚ, y después cada escritura de fecha
  agotaba sus 30 s contra un campo inexistente — minuto y medio por consulta
  diciendo «no se pudo escribir la fecha» en lugar de «el módulo no abrió».
- Una corrida donde **ninguna** consulta llega a la tabla de resultados ahora
  **falla** (rojo en Actions). Se distingue `null` («no se pudo consultar») de
  `[]` («se consultó y no había nada»), que es un resultado legítimo.

## 7. El resultado de la primera extracción completa

Run del 28/09/2026, agosto y setiembre, los cuatro tipos de boleta. 25 minutos,
8 consultas, ninguna fallida.

| Tipo | Agosto | Setiembre |
|---|---|---|
| BVE Emitidas | 0 | 0 |
| BVE Recibidas | **66** | **39** |
| NC-BVE Emitidas | 0 | 0 |
| ND-BVE Emitidas | 0 | 0 |

```
Archivados en Drive: 186 nuevos, 24 ya estaban.
Detalle guardado: 93 nuevos, 12 actualizados, 135 ítems.
Hoja «COMPROBANTES SUNAT - DETALLE 2026-08 a 2026-09»: 716 ítems
  · ítems por tipo de comprobante: 01=506 03=135 07=75
```

Los números cierran entre sí: 66 + 39 = 105 boletas, de las que 12 ya estaban
(la prueba del 22 al 25 de setiembre) y 93 eran nuevas; 93 × 2 archivos = los
186 de Drive.

**Dos cosas que conviene mirar:**

- **`BVE Emitidas` dio 0 en los dos meses.** Puede ser cierto —que la empresa
  no emita boletas electrónicas— o puede ser un cero silencioso. Se comprueba
  en un segundo abriendo el enlace de Imprimir del portal con
  `tipoConsulta=17` para ese rango y viendo si trae filas.
- **La carrera de las tandas de 25 apareció, y el reintento la resolvió:**
  `Cannot read properties of null (reading 'nroRucEmisor')` en las filas 26 y
  51, exactamente los bordes de tanda descritos en
  `docs/scraper-cpe-hallazgos-tecnicos.md` §3. Ninguna descarga se perdió.

Una consulta que devuelve 0 tarda ~90 s en concluirlo: espera a que aparezca la
grilla (que en un mes cargado puede tardar 51 s) antes de caer al conteo de
enlaces. Son 6 de los 25 minutos. Es el precio de no confundir «vacío» con
«todavía cargando», y por ahora se paga.

## 8. Lo que sigue sin resolver

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
- **El código de `tipoConsulta` de ND-BVE Emitidas.** Los otros nueve están
  confirmados. Mientras falte, ese tipo se verifica contra la etiqueta del
  combobox y el script imprime su código en cuanto lo vea.
- ~~**La tabla de resultados de boletas.**~~ Resuelto: el run del 28/09/2026
  dice `12 comprobantes (rowCount de la grilla)`. Es la **misma grilla dojox**
  que la de facturas, así que todo el mecanismo de descarga por índice aplica
  igual. El conteo coincidió con lo que muestra el portal para ese rango.
