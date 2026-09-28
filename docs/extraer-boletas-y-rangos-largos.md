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
| BE Emitidas | *BE Emitidas* | — | *Empresas › Consulta Integrada de Comprobantes de Pago* | **NO** |
| BE Recibidas | *BE Recibidas* | — | ídem | **NO** |

Las dos últimas filas están **en cursiva y sin confirmar a propósito**: son una
suposición. La pantalla que se usa hoy —«Consulta de Facturas y Notas
Electrónicas»— por diseño no lista boletas, y desde el código no hay forma de
saber si con el acceso nuevo las boletas aparecen como **opciones nuevas del
mismo combobox** o detrás de **otra entrada del menú**. Eso solo lo dice el
portal.

### La red de seguridad: no bajar un tipo por otro

El riesgo concreto de adivinar la etiqueta: si «BE Recibidas» no existe, el
combobox se queda con lo que tenía y la consulta baja **facturas**. El registro
diría «BE Recibidas: 112 comprobantes» y se archivarían facturas bajo el nombre
de boletas. Nadie lo notaría.

Por eso `elegirTipo` ahora **verifica antes de bajar**:

- si el tipo tiene código confirmado, compara contra el campo oculto
  `tipoConsulta` y abandona si no coincide;
- si no tiene código (las boletas), exige que la opción **exista de verdad** en
  la lista, y si no está **salta el tipo y lo dice** en el registro.

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

### Paso 1 — correr en modo «solo mirar»

Actions → **SUNAT extraer rango (hoja aparte)** → Run workflow, con
`debug = true` (es lo que viene marcado). No baja nada. Entra, recorre el menú y
deja en el registro:

- las entradas del menú que **este** acceso ofrece (`· menú visible en …`),
- las opciones reales del «Tipo de Consulta»
  (`· opciones del «Tipo de Consulta»: …`),

más las capturas y el HTML de cada paso como artefacto `capturas-sunat-rango`.

### Paso 2 — corregir el catálogo con lo que se vio

En `lib/sunat/cpe-consulta.ts`, poner la etiqueta y el menú reales de
`BE Emitidas` / `BE Recibidas`, y marcarlos `confirmado: true` cuando el run los
haya validado.

Para probar un camino de menú **sin tocar código**, el workflow tiene el input
`menu_boletas`: los textos separados por `>`, por ejemplo
`Empresas > Comprobantes de pago > Consultar Boleta`. Cuando uno funcione, se
escribe en el catálogo y el input vuelve a quedar vacío.

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

- **Las boletas que el técnico pidió a su nombre siguen sin aparecer.** Esto
  trae las boletas donde el **RUC de la empresa** es el adquiriente. Una boleta
  emitida al DNI del trabajador no está vinculada al RUC de la empresa en
  ningún registro de SUNAT, así que ninguna pantalla del portal la va a
  devolver. Es el mismo límite que ya está anotado en
  `docs/descarga-cpe-y-detalle-de-items.md`.
- **Los comprobantes anulados** siguen invisibles, como antes (§4 de
  `docs/scraper-cpe-hallazgos-tecnicos.md`).
