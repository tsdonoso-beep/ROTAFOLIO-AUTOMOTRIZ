# Hallazgos técnicos del scraper de CPE (Consultar Factura y Nota)

Notas de una sesión de depuración en vivo contra el portal real de SUNAT,
sobre `scripts/descargar-cpe.mts` (el que corre en el workflow **SUNAT
descargar XML**, `.github/workflows/descargar-cpe.yml`). El objetivo es que
si esto vuelve a fallar más adelante —o si SUNAT cambia el portal—, quien lo
retome no tenga que redescubrir todo esto desde cero.

Última revisión: 21 de setiembre de 2026.

---

## 1. El bug de fondo: la tabla de resultados es una grilla virtual

La pantalla «Consultar Factura y Nota» pinta sus resultados con un
**`dojox.grid.DataGrid`** (Dojo Toolkit 1.9, confirmado contra el HTML real
del frame: hojas de estilo `dojox/grid/resources/Grid.css`, ids de widget
como `recibido.facturasGrid`, `emitido.facturasGrid`,
`recibidoNC.facturasGrid`).

Ese tipo de grilla **virtualiza el DOM**: solo mantiene pintadas las filas
visibles (~24-25 a la vez) y recicla los nodos al scrollear. Contar
`<a>` en el DOM —lo que hacía el scraper original— nunca puede ver más que
ese puñado, sin importar cuánto se scrollee ni cuánto se espere.

**Cómo se descubrió:** comparando un mes real (marzo 2026) contra el
registro de compras (SIRE) en `comprobantes_sunat`, que mostraba ~1470
facturas «01» recibidas contra apenas 25 que el scraper reportaba. Ensayos
intermedios (esperar más, forzar `scrollTop` a mano) subieron el número a
lo sumo a 47 — mejor, pero seguía muy lejos del real.

### La solución: leer `rowCount` del widget, no contar el DOM

El widget en sí sí conoce el total real, sin depender de qué esté pintado:

```js
// dentro del frame de resultados
const widgets = window.dijit.registry.toArray();
const grid = widgets.find(w => typeof w.rowCount === "number");
grid.rowCount // el total real
```

Implementado en `rowCountDeGrid()` (`scripts/descargar-cpe.mts`). El script
sondea todos los frames buscando un widget con `rowCount` numérico antes de
decidir cuántos comprobantes hay.

**Respaldo:** si por algo no aparece ningún grid (el portal cambió, un
resultado vacío no llega a instanciar la grilla), el código vuelve al
conteo por enlaces de antes. No se borró esa rama — sigue sirviendo de red
de seguridad.

---

## 2. Bajar cada fila sin depender de que esté pintada

Aún sabiendo el total, faltaba bajar cada XML/PDF sin poder hacerle clic a
una fila que no está en el DOM. Se resolvió inspeccionando el `onclick` real
de los enlaces (mismo hallazgo sirvió para FE y para NC):

```html
<!-- FE Recibidas -->
<a onclick="consultaFactura.descargar('0')">Descargar Factura (XML)</a>
<a onclick="consultaFactura.descargarComprobantePdf('0')">Descargar PDF</a>

<!-- NC Recibidas: MISMA función, el índice es lo único que importa -->
<a onclick="consultaFactura.descargar('0')">Descargar NC (XML)</a>
```

El `onclick` no hace más que llamar a esa función global con el **índice**
de la fila (no un dato propio de esa fila). Como es un índice, no depende
de que la fila esté pintada ni de cómo se llame su botón — se puede llamar
`consultaFactura.descargar('300')` sin que esa fila se haya visto nunca en
pantalla.

Implementado en `descargarPorIndice()`: en vez de `xml.nth(i).click()`, se
hace `frame.evaluate(() => consultaFactura.descargar(String(i)))` para
`i = 0..rowCount-1`.

**Efecto colateral importante:** esto también arregló un bug separado que
nadie había notado. El conteo por texto («Descargar Factura») nunca
matcheaba en notas de crédito/débito, porque su botón dice **"Descargar NC
(XML)"** / **"Descargar ND (XML)"**, no "Descargar Factura". Todas las
corridas de esta sesión (y probablemente anteriores) reportaban **0** NC/ND
aunque sí hubiera — se confirmó contra la base: marzo tenía 6 NC emitidas y
26 NC recibidas reales, nunca vistas hasta este fix.

---

## 3. La condición de carrera al cruzar de tanda de 25

Con rowCount + descarga por índice funcionando, una corrida real (primera
semana de marzo, 93 comprobantes de FE Recibidas) bajó casi todo bien, pero
falló exactamente en las filas **26, 51 y 76** — cada 25, ni una vez en
medio — con:

```
TypeError: Cannot read properties of null (reading 'nroRucEmisor')
```

La grilla trae los datos del servidor en tandas de 25. La PRIMERA lectura
de una tanda nueva puede llegar antes de que SUNAT termine de traerla. El
PDF de esas mismas filas (pedido justo después, ya con la tanda cargada)
salió bien, lo que confirma que es una carrera, no un dato ausente de
verdad.

**Solución:** un reintento con una pausa corta (1.5s) alcanza. Implementado
directo en el bucle de descarga de `consultarUnTipo()`.

---

## 4. El botón «Imprimir» — probado, dejado en espera (on hold)

Idea aportada por el usuario a mitad de sesión: la consulta tiene un botón
«Imprimir» cuya URL es determinística:

```
https://ww1.sunat.gob.pe/ol-ti-itconscpemype/consultar.do?action=imprimirListado&periodoDesc=01/03/2026%20-%2031/03/2026&tipoConsulta=11
```

La hipótesis era: si el servidor **re-consulta** según los parámetros de la
URL (no solo reimprime lo último corrido con Aceptar), esa vista —una tabla
plana normal, sin la grilla `dojox` ni sus tandas de 25— podría reemplazar
todo el problema de `rowCount` + descarga por índice, y de paso trae una
columna que hoy no se captura en ningún lado: **"Comprobante Anulado"**.

### Lo que se probó

Se corrió una consulta real con Aceptar para **01/03 al 07/03/2026** (93
comprobantes reales, confirmado) y, en la misma sesión, se pidió
`imprimirListado` con un rango **distinto**: **01/03 al 31/03/2026** (el mes
completo, que se sabe ronda ~422).

### Resultado: es cosmético, no re-consulta

El HTML que volvió mostraba dos cosas contradictorias:

- El **título** de la página sí decía "01/03/2026 - 31/03/2026" (el rango
  pedido por URL).
- Pero las **filas de datos** seguían siendo las de la semana (fechas
  01/03 a 07/03 únicamente, 97 `<tr>` — casi exacto a los 93 reales de la
  semana más filas de encabezado/tabla).

**Conclusión: el parámetro `periodoDesc` de la URL solo cambia el texto del
título impreso. Los datos reales son los de la última consulta corrida de
verdad con Aceptar en esa sesión.** No hay atajo para pedir un rango nuevo
sin pasar por el flujo normal (Empresas → Consulta → llenar fechas →
Aceptar). Confirma lo que ya advertía quien compartió el hallazgo: "el
enlace existe habilitado solo si la página tiene abierta la consulta".

### Por qué queda en espera y no se implementó

- **No resuelve nada que `rowCount` + descarga por índice no resuelva ya.**
  Ya está probado contra datos reales y funcionando (ver §1-3).
- Agregar esto sumaría una llamada extra por tipo, HTML nuevo que parsear,
  y mantenimiento, para un beneficio que hoy es solo "una segunda forma de
  contar lo mismo" — no una necesidad.

### Por qué se documenta igual, para el futuro

Si más adelante hace falta el dato de **"Comprobante Anulado"** —hoy
invisible en toda la app: ni el scraper ni el RCE lo traen tal cual—, esta
vista sería el camino más simple para conseguirlo, **siempre pidiéndola
inmediatamente después del Aceptar real de esa misma consulta** (mismo
rango, misma sesión), nunca con un rango distinto al que se acaba de
correr. La implementación de referencia (apagada, no se usa en producción)
quedó en el propio script:

- Variables de entorno `PROBAR_IMPRIMIR` / `RANGO_PRUEBA_IMPRIMIR` en
  `scripts/descargar-cpe.mts` (buscar `PROBAR_IMPRIMIR` en el archivo).
- Input `rango_prueba_imprimir` en
  `.github/workflows/descargar-cpe.yml` (vacío = no hace nada).
- La prueba real corrida y su resultado: commit `a884a49` en adelante,
  run de GitHub Actions del 21/09/2026 (`FE Recibidas`, semana vs. mes).

Si se retoma, lo mínimo a resolver es: parsear la tabla `class="detalle"`
de ese HTML (columnas Nro. CPE, Receptor, Importe Total, Fecha de Emisión,
Comprobante Anulado) y decidir qué hacer con los anulados —¿se guardan
igual y se marcan, o se excluyen del detalle de ítems?— antes de escribir
código de producción sobre esto.

---

## 5. Qué queda pendiente después de estos fixes

- **Todo lo corrido antes de esta sesión (y buena parte de lo corrido
  durante ella, antes del fix de `rowCount`) está incompleto.** FE
  Recibidas se cortaba en 25-93 según el momento, y NC/ND siempre dieron 0
  aunque hubiera datos reales. Conviene volver a correr **cada mes ya
  hecho, completo**, no solo los que faltan — es seguro repetir: Drive
  detecta "ya estaba" y la base actualiza en vez de duplicar.
- **Ya no hace falta partir por semanas.** Esa costumbre era para no
  chocar con el límite de 25 de la grilla virtual, que es justo lo que se
  corrigió. Un mes cargado (~500 comprobantes contando los 6 tipos) cabe
  cómodo en el límite de 90 minutos del workflow (una semana de prueba con
  115 comprobantes tardó 9 minutos).
- **Los códigos de `tipoConsulta` confirmados contra el portal real:**
  `10` FE Emitidas, `11` FE Recibidas, `13` NC Emitidas, `14` NC Recibidas,
  `15` ND Emitidas, `16` ND Recibidas.

## 6. Commits de referencia (en orden)

1. `2616d33` — recargar el menú antes de cada tipo (bug distinto, de antes
   de esta tanda: el menú dejaba de abrir un formulario nuevo al tercer
   tipo).
2. `6f8ba89` → `35fa236` — primeros intentos (esperar más, forzar scroll):
   mejoraron el número pero no lo resolvieron. Quedaron reemplazados.
3. `e4362e2` — diagnóstico que confirmó el `rowCount` del grid dojox.
4. `a92dc8c` — **el fix real**: descarga por índice de fila
   (`consultaFactura.descargar(i)` / `descargarComprobantePdf(i)`) en vez
   de contar/clicar enlaces. Corrige NC/ND de paso.
5. `3684ea0` — reintento corto al cruzar de tanda de 25 (la condición de
   carrera de §3).
6. `a884a49` — prueba del botón Imprimir (§4), apagada por omisión.
