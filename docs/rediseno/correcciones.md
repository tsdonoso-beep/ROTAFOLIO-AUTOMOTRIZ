# Correcciones al handoff del rediseño (dirección 1a)

Este documento **no reemplaza** el handoff del rediseño —`handoff-original.md`,
en esta misma carpeta, junto con `reference.html`—: lo corrige. La
dirección visual, los principios y los tokens siguen valiendo tal cual — se
verificaron uno por uno contra `app/globals.css` y existen todos.

Lo que cambió es la aplicación. El handoff se escribió contra una app de seis
secciones y cuatro pantallas; hoy tiene **nueve secciones** y tres flujos
nuevos que no están dibujados. Implementar `reference.html` tal como está
produciría pantallas que muestran números equivocados.

Cada corrección dice dónde se comprueba, para que no haya que creerle a nadie.

---

## 1. Lo que ya es falso en `reference.html`

### 1.1 El correlativo no cabe

La referencia usa `MEM-2026-0412`, 13 caracteres. El real tiene **23**:

```
INROPRIN-2026-CCH-00003     ← el que genera la app
594-2026                    ← los 199 importados del seguimiento
```

Conviven los dos formatos y van a seguir conviviendo. El badge mono de la
tarjeta y la celda «Persona · memo» de la tabla tienen que sobrevivir a 23
caracteres sin romper la rejilla ni truncar en mitad del año.

> Se comprueba con: `select correlativo from memos order by length(correlativo) desc`

### 1.2 «Te queda por rendir» es por persona, no por memo

La tarjeta del rendidor dice «S/ 1,246.50 rendido de S/ 1,800.00». Eso supone
que el memo es de una persona.

El memo 594-2026 autoriza **S/ 9,064.00 a once personas**, con tres tramos de
fecha distintos. A Wilmer Zamora le tocaron **S/ 212.00**. Si su tarjeta
muestra el monto del memo, le está diciendo que le sobran ocho mil ochocientos
soles.

La cifra que manda en móvil sale de la fila del anexo de esa persona
(`memo_asignados.monto`), no de `memos.monto_autorizado`. Ya está resuelto en
el código: `VistaMemo.tsx` recibe `asignado` y consolida contra eso.

Cuando el memo cubre a más de una persona, debajo va una línea que lo diga
—«Este memo cubre a 11 personas por S/ 9,064.00; lo de arriba es lo tuyo»—
porque si no, el número parece un error.

> Se comprueba en: `components/v2/VistaMemo.tsx`, constante `autorizado`.

### 1.3 Falta el crédito fiscal en el panel de detalle

El panel desglosa comprobantes formales / movilidad / declaración jurada. Le
falta el número que Contabilidad necesita: **cuánto de lo rendido da derecho a
crédito fiscal**, que es menos que el total.

De los S/ 201.80 que rindió Wilmer, sólo S/ 132.90 son factura. La planilla de
movilidad y la declaración jurada son gasto deducible pero no descuentan IGV.
El formato de rendición lo pide con todas sus letras: «monto rendido (solo
FT)».

`consolidar()` ya lo devuelve como `credito_fiscal`. No hay que calcular nada,
sólo mostrarlo.

> Se comprueba en: `lib/dominio/tipos.ts`, campo `credito_fiscal` de
> `ConsolidadoMemo`.

### 1.4 «Devuelves S/ 553.50» ya no es una promesa

La devolución dejó de ser un número calculado y pasó a ser un hecho
registrado, con su número de operación bancaria. Wilmer devolvió S/ 10.20 con
la operación 10394730.

El panel tiene que distinguir tres estados, no uno:

| | Qué mostrar |
|---|---|
| Debe devolver y no lo hizo | la cifra, en acento |
| Devolvió | la cifra tachada o en gris + «op. 10394730 · 27/08» |
| Devolvió en partes | cuánto falta |

> Se comprueba en: tabla `devoluciones`, componente `PanelDevolucion.tsx`.

### 1.5 No hay nada sobre si la persona cobró

Ni en móvil ni en el panel. Y es el hueco más caro que encontramos.

**Un memo se paga en más de una planilla: una por banco.** El 594-2026 se pagó
con la planilla de haberes 1439 del BCP —S/ 5,292.00 a siete personas— y los
otros **S/ 3,772.00** salieron por una operación aparte contra el CCI de
Interbank. Leer una constancia y dar el memo por pagado deja a cuatro personas
esperando sin que nadie lo sepa.

Hace falta:

- **En móvil**: si a esta persona todavía no le llegó su plata, decírselo. Hoy
  el rendidor no tiene forma de saber si el problema es del banco o suyo.
- **En el panel del admin**: «pagado S/ 5,292 de S/ 9,064 · faltan cobrar
  4 personas», con nombres. Y una fila **rechazada** por el banco marcada
  aparte: esa persona no cobró y por lo tanto **no tiene nada que rendir**.

> Se comprueba en: `lib/dominio/pago.ts`, función `cobertura()`, y sus tests,
> que reproducen el caso con el número exacto.

### 1.6 Las pestañas de escritorio están incompletas

La referencia dibuja seis: Administrar · Revisar · Contabilidad ·
Liquidaciones · Caja chica · Sistema.

Hoy son **nueve**, y el orden importa porque es el del proceso:

```
Mis memos · Pedidos · Administrar · Revisar · Contabilidad ·
Liquidaciones · Caja chica · Movilidad · Tablero · Sistema
```

El README ya dice lo correcto —generarlas desde `seccionesDe()`— así que esto
es sólo un aviso de que el dibujo se quedó corto y de que **con diez pestañas
la fila ya no cabe cómoda en 1300px**. Hay que decidir si se agrupan o si
algunas viven en un menú.

> Se comprueba en: `lib/dominio/navegacion.ts`, constante `SECCIONES`.

---

## 2. Tres pantallas que faltan, y un actor

### 2.1 Pedidos — y es la más importante

Es la **nueva entrada al sistema**, y no está dibujada.

Hasta hace poco el proceso empezaba en Administración: alguien tecleaba el
memo. El primer paso real —el personal pide, su jefatura autoriza— ocurría
«por fuera de todo sistema, en una conversación que no deja rastro». Ahora
está dentro.

Esto cambia el inicio móvil del rendidor: hoy su único CTA es «Capturar
comprobantes», y ahora su primera acción del mes puede ser **pedir un memo**.
Habría que decidir si son dos CTA, uno primario y otro secundario, o si pedir
vive en otro lado.

Un pedido no es un memo: no tiene correlativo, no compromete plata, y puede
estar esperando firma, autorizado sin emitir, rechazado o retirado. Necesita
sus propios estados visuales.

### 2.2 Movilidad

La planilla del talonario con **una fila por desplazamiento**, no una línea
con el total. Y con la regla legal visible, que es lo que decide el diseño:

> «La falta de consignación de la fecha, nombres, DNI, motivo y destino …
> **sólo inhabilita la planilla para la sustentación del gasto que corresponde
> a tal desplazamiento**.»

**Se cae la fila, no la planilla.** Por eso la pantalla muestra tres cifras
—lo anotado, lo que sustenta, lo que está en riesgo— y cada fila incompleta
dice qué le falta, en vez de rechazar todo. Más la firma AUTORIZADO, que la da
la jefatura y nunca el dueño de la planilla.

### 2.3 Caja chica

Aparece como pestaña en el dibujo pero **no tiene pantalla**, y no es una
lista de memos: es una lista de **fondos**. Cada fondo tiene un responsable,
un ciclo abierto con su saldo, y una historia de reposiciones.

Ojo con un dato que contradice lo que se dijo en la pizarra: **no se repone
mensualmente**. Los seis ciclos reales de Gestión de Proyectos se repusieron
cada 8 a 12 días. La pantalla muestra la cadencia real medida, no una
supuesta.

### 2.4 Falta la Jefatura como actor

El rediseño cubre dos roles: el rendidor en móvil y el admin de memos en
escritorio. La **jefatura** es hoy un actor de primera: firma los pedidos y
autoriza las planillas de movilidad. No tiene ni una pantalla.

Y es un rol que va a usar la app **desde el teléfono**, porque firma entre
reuniones. Probablemente necesite una bandeja móvil de «cosas que esperan mi
firma», no una versión reducida del escritorio.

---

## 3. Donde discrepo del spec, con razón

### 3.1 `Promise.all` para las acciones en lote (README línea 65)

Si fallan 3 de 10, `Promise.all` rechaza y pierdes cuáles fallaron y cuáles
alcanzaron a aplicarse. En algo que mueve plata, un lote a medias sin decir
qué falló es peor que no tener lote.

Debe ser `Promise.allSettled` con reporte por fila: «7 abiertos · 3 no se
pudieron, por esto». La barra de selección se queda con los que fallaron
marcados.

### 3.2 El id del panel fuera de la URL (README línea 66)

Mantener el detalle en `useState` y la URL en `/administrar` tiene una ventaja
real —no se pierde la lista— pero un costo que no está evaluado: **se pierde
«mándame el link de ese memo»**, que es exactamente como esta gente coordina.

Un query param (`/administrar?memo=<id>`) conserva las dos cosas: la lista no
se recarga y el link se puede pegar en un WhatsApp. `history.replaceState` o
el router de Next con `scroll: false` lo resuelven sin navegar de verdad.

### 3.3 «Me frena a mí» se quedó corto (README línea 67)

La definición actual es: observadas + alertas bloqueantes + sin asignar. Con
lo que la app creció, le faltan tres:

- **pedidos esperando mi firma** — si soy jefatura, es lo que más frena;
- **planillas de movilidad sin autorizar**;
- **memos pagados en parte**, donde el banco rechazó una fila o falta una
  planilla de otro banco.

Sin esto, el filtro que promete «lo que requiere tu acción» deja fuera tres
cosas que sí la requieren.

---

## 4. Lo que el handoff acertó y conviene no perder

Verificado contra el código, no por cortesía:

- **Todos los tokens existen** en `app/globals.css`: `.cifra-xl`, `.cifra-l`,
  `.badge`, `.medidor`, `.stagger`, `--tinta`, `--accent-texto`, `--radio-s`,
  `--sombra1`, `--rapido`. Ninguno hay que inventarlo.
- **Todos los archivos citados existen**: `lib/extraccion/gemini.ts`,
  `lib/ocr/`, `components/Logo.tsx`, `Captura.tsx`, `GastoFila.tsx`,
  `seccionesDe()` y `seccionInicial()` en `navegacion.ts`.
- **«Me frena a mí» como filtro por defecto** es la mejor decisión del
  documento y ataca el dolor declarado. Se mantiene, sólo se le amplía la
  definición.
- **El CTA deshabilitado pero visible, con el motivo arriba**, ya es el patrón
  del código y es el correcto.
- **La cola de captura masiva** describe cómo trabaja de verdad la gente en
  obra: dispara varias fotos y sigue caminando.
- **No recalcular en el cliente** lo que `consolidar()` ya da. Sigue siendo
  válido, y ahora `consolidar()` da una cosa más.

---

## 5. Orden sugerido para implementar

1. **La bandeja del admin**, que es el dolor que motivó el rediseño — con
   «Me frena a mí» ampliado y el panel con crédito fiscal, pago y devolución.
2. **El inicio móvil del rendidor**, con la cifra por persona y el estado de
   pago.
3. **Presentar** y la **cola de captura**, que ya están bien definidas.
4. **Las tres pantallas nuevas** y la vista de jefatura, que necesitan diseño
   antes que código.

El buscador global atraviesa todo y no depende de ninguna pantalla: se puede
construir en paralelo desde el primer día.
