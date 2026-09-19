# Tablero de monitoreo para Contabilidad

Un panel dentro de una hoja de Google que lee la que publica la aplicación y
muestra el mes: cuánto IGV, cuántas notas de crédito y cuánto restan del
crédito fiscal, qué comprobantes cambiaron y quién factura más.

## Dónde va

**En la misma hoja que publica la aplicación** —COMPROBANTES SUNAT—, como una
pestaña más al lado de los datos.

Antes no se podía: la publicación diaria reescribía el archivo entero y se
habría llevado por delante el tablero, el script y cualquier fórmula que
alguien agregara. Ahora la aplicación escribe **solo dentro de la pestaña de
datos** —la que se llama como el archivo— y no toca nada más. Las otras
pestañas, el script que les cuelga, los formatos y los anchos de columna
sobreviven a la consulta de cada mañana.

La única regla que queda es la evidente: **no escribir en la pestaña de
datos**, porque esa sí se reemplaza entera todos los días a las 8. Lo que
Contabilidad quiera anotar va en otra pestaña.

## Instalación

### 1. Abrir la hoja

Abre **COMPROBANTES SUNAT**, la que publica la aplicación. No hay que crear
nada.

### 2. Pegar el código

En la hoja: **Extensiones · Apps Script**.

1. Borra lo que haya en `Código.gs` y pega el contenido de **`Codigo.gs`**.
2. Arriba a la izquierda, junto a «Archivos», el **+** · **HTML**. Llámalo
   exactamente **`Tablero`** (sin `.html`) y pega el contenido de
   **`Tablero.html`**.
3. Guarda con el disquete.

Si el archivo HTML se llama distinto, el menú no lo encuentra: el nombre lo
busca el código por «Tablero».

### 3. Dar permiso

Vuelve a la hoja y **recárgala**. Aparece el menú **Monitoreo SUNAT**.

La primera vez que abras el tablero, Google va a pedir autorización. Es
normal: el script necesita leer la otra hoja y, si activas los avisos, mandar
correo. Elige la cuenta, **Configuración avanzada**, **Ir a COMPROBANTES SUNAT**,
y **Permitir**.

### 4. Que Contabilidad pueda entrar

Comparte la hoja con quien la vaya a usar. Eso se hace desde la aplicación, en
**Sistema · Credenciales de SUNAT · Publicar y dar acceso a Contabilidad**.

Es una sola hoja, así que con ese acceso ven los datos y el tablero. El acceso
es de **lectura**: la pestaña de datos se reemplaza cada mañana y lo que
alguien editara encima se perdería sin aviso.

## El correo

En el menú, **Avisarme todos los días** deja un aviso a las 9 de la mañana.

**Solo llega los días que hay algo**: notas de crédito en el período o
comprobantes que llegaron distintos. Si no hay nada, no manda nada — un correo
diario que casi siempre dice «todo bien» se aprende a archivar sin abrir, y el
día que trae algo tampoco se abre.

Por omisión llega a quien instaló el script. Para mandarlo a otra dirección,
cambia `AVISAR_A` en la primera parte de `Codigo.gs`.

**Dejar de avisarme** lo quita.

## Qué muestra y qué no

Muestra lo que hay en el registro de compras de SUNAT:

- IGV del mes y su evolución en los meses cargados
- Notas de crédito, con la factura que corrige cada una y cuánto le restan al
  crédito fiscal
- Comprobantes que llegaron distintos entre dos consultas
- Qué proveedores facturan más

**No muestra detracciones ni retenciones.** Las retenciones no vienen en este
archivo —van por otro reporte de SUNAT— y la columna de detracción llega
vacía. Si Contabilidad las necesita, hace falta otra fuente.

**La columna «Lo rindió» sale vacía** mientras nadie capture comprobantes por
la aplicación. Cuando arranque el piloto se llena sola, y ahí el tablero
empieza a poder decir *quién* rindió la factura que una nota de crédito acaba
de anular. Esa es la pregunta que ninguna hoja puede responder por su cuenta.

## Desglose de comprobantes (los ítems de cada factura)

`Desglose.gs` agrega al mismo menú el desglose: convierte cada factura en sus
líneas —qué se compró, cuánto y a qué precio— y las escribe en una pestaña
**DETALLE**, una fila por ítem.

### Por qué así y no «scrapeando» SUNAT

El detalle de ítems **no lo devuelve ninguna API de SUNAT**: la única fuente
es el XML de cada comprobante. Se puede llegar al XML de dos maneras:

- **Scrapeando el portal SOL** desde el script. Es lo que hacen las macros que
  se venden. Funciona, pero es frágil (cualquier cambio del portal lo rompe),
  hay que guardar la Clave SOL dentro del script, y la descarga masiva es
  asíncrona —pide, espera un correo, y recién ahí baja—. Alto mantenimiento.
- **Sobre el ZIP ya bajado** (lo que hace esto). Una persona baja el ZIP en
  SUNAT una vez —un clic, lo mismo que ya hacían— y lo deja en una carpeta de
  Drive. El script hace todo lo demás, y no depende del HTML de SUNAT: solo
  del formato del XML, que es un estándar y cambia poco.

De la descarga en adelante es **automático de verdad**: con el disparador de
tiempo activado, nadie tiene que abrir el script.

### Cómo se usa

1. **La carpeta.** Crea una carpeta en Drive para los ZIP. Copia su ID de la
   URL (`.../folders/ESTE_ID`) y ponlo en `CARPETA_ZIPS`, al inicio de
   `Desglose.gs`. Revisa también que `RUC_EMPRESA` sea el de la empresa.
2. **Pega el archivo.** En Apps Script, el **+** · **Script**, llámalo
   `Desglose` y pega el contenido de `Desglose.gs`. Guarda y recarga la hoja.
3. **Baja el ZIP** en SUNAT (Comprobantes de pago → SEE-SOL → Consultar
   Factura y Nota → Descarga masiva, «Recibidas») y déjalo en la carpeta.
4. **Menú → «Desglosar ZIPs de Drive (ítems)»**. Lee los ZIP, escribe los
   ítems en DETALLE y mueve el ZIP a una subcarpeta `procesados`.
5. **Para que corra solo:** menú → «Activar desglose automático». Cada hora
   revisa la carpeta. Tú solo dejas el ZIP.

Reprocesar un ZIP no duplica: un ítem ya escrito se reconoce por
tipo-serie-número-proveedor-línea y se salta.

## Condición del RUC (Buen Contribuyente / Agente de Retención)

`PadronRuc.gs` agrega al mismo menú la consulta que hoy Contabilidad hace a
mano, RUC por RUC, en `e-consultaruc.sunat.gob.pe`: si el proveedor está en
el Padrón de Buenos Contribuyentes o es Agente de Retención/Percepción —de
eso depende si a esa factura le corresponde o no la retención del IGV—.

### Por qué la consulta en sí NO vive en Apps Script

Se intentó primero con `UrlFetchApp` —la Consulta RUC pública no pide Clave
SOL, así que parecía no necesitar navegador—, pero esa pantalla tiene
**reCAPTCHA v3**: el campo `token` del formulario llega vacío del servidor y
solo se llena cuando `grecaptcha.execute(...)` corre en un navegador de
verdad, al hacer clic en «Buscar». `UrlFetchApp` no ejecuta JavaScript, así
que no hay forma de conseguir ese token desde ahí — no es un detalle de
formato, es la barrera que SUNAT puso a propósito.

Por eso la consulta la hace un scraper de Playwright
(`scripts/consultar-padron-ruc.mts`), corriendo en GitHub Actions igual que
`descargar-cpe.mts` —un navegador real resuelve el captcha en silencio,
como lo haría una persona—, y guarda cada resultado en la tabla `padron_ruc`
de la base (migración `038_padron_de_ruc.sql`).

`PadronRuc.gs` hace la otra mitad, la que si le toca a Apps Script: **trae
esa tabla a una pestaña PADRÓN RUC** de esta misma hoja, para que
Contabilidad la vea ahí mismo sin entrar a la aplicación.

### Cómo se usa

1. En Apps Script, el **+** · **Script**, llámalo `PadronRuc` y pega el
   contenido de `PadronRuc.gs`. Guarda.
2. **Extensiones → Propiedades del proyecto → Propiedades del script**:
   agrega `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ROBOT_CORREO` y
   `ROBOT_CLAVE` —los mismos valores que ya usa `OrdenarCPE.gs`—. Recarga la
   hoja.
3. **Menú → «Traer el padrón de RUC desde la base»** para probarlo: reemplaza
   la pestaña PADRÓN RUC con lo que haya en `padron_ruc` en ese momento.
4. **Menú → «Activar sincronización automática diaria»** para que se ponga
   al día sola todas las mañanas, después de que corra el scraper.

Del lado de SUNAT, el workflow **«SUNAT padrón de RUC»** de GitHub Actions
—el que de verdad consulta a SUNAT y llena `padron_ruc`— corre **solo,
todos los días a las 9 de la mañana** (media hora después de «SUNAT
diario», para alcanzar a ver los proveedores que trajo esa madrugada). Cada
corrida consulta hasta 80 RUC —los nuevos o los que llevan más de 30 días
sin revisarse—, así que un registro de compras grande no se cubre en un
solo día, pero tampoco hace falta acordarse de correrlo: se va poniendo al
día solo. `PadronRuc.gs` solo refleja lo que ya haya en la base en ese
momento.

Para adelantar el primer barrido completo en vez de esperar varios días,
dispara el workflow a mano (pestaña Actions → «SUNAT padrón de RUC» → Run
workflow) con `debug=false` las veces que haga falta — cada corrida es
segura de repetir: nunca vuelve a consultar un RUC que ya quedó al día.

### Lo que esto NO decide

Dice la condición del proveedor. **No calcula si corresponde retener** ni
cuánto: para eso falta además confirmar que INROPRIN esté designada Agente
de Retención, que la operación supere S/ 700, y que no esté sujeta a
detracción (si hay detracción, no hay retención). Ese cálculo queda para más
adelante, sobre esta misma pestaña.

## Tablero del padrón de RUC (publicado, no dentro del Sheet)

`TableroPadron.gs` + `TableroPadron.html` arman un tablero aparte —cuánto del
registro ya se revisó, qué porcentaje son Buenos Contribuyentes o Agentes de
Retención/Percepción, cuántos «No Habido»— y lo **publican como su propia
URL**, con un botón para abrir la hoja de cálculo. A diferencia de
`Tablero.html` (que se abre como diálogo desde el menú de la hoja), este no
depende de tener el Sheet abierto: es una página que se comparte por enlace.

### Instalación

1. En el **mismo proyecto** de Apps Script donde ya está `PadronRuc.gs`
   (hereda sus mismas Propiedades del script: `SUPABASE_URL`,
   `SUPABASE_ANON_KEY`, `ROBOT_CORREO`, `ROBOT_CLAVE`): el **+** · **Script**,
   llámalo `TableroPadron`, pega `TableroPadron.gs`. El **+** · **HTML**,
   llámalo exactamente `TableroPadron` (sin `.html`), pega `TableroPadron.html`.
2. Guarda.
3. **Implementar → Nueva implementación → tipo «Aplicación web»**.
   - **Ejecutar como**: tu cuenta — así corre con tus permisos, sin pedirle
     nada a quien lo abra.
   - **Quién tiene acceso**: **«Cualquier usuario de tu organización»**, no
     «Cualquier usuario» — muestra información de proveedores, no hace falta
     que sea público en internet.
4. **Implementar** → copia la URL. Esa es la que se comparte.
5. **Cada vez que cambies el código** hay que volver a **«Gestionar
   implementaciones»** → el lápiz de editar → Versión: **«Nueva»** →
   Implementar. Una implementación ya publicada no se actualiza sola con el
   código nuevo — sin este paso, la URL sigue mostrando la versión vieja.

## Si algo falla

**«La hoja no trae estas columnas…»** — cambiaron los títulos en la fuente. El
mensaje dice cuáles. Se arreglan en `COL`, al principio de `Codigo.gs`.

**El tablero sale vacío** — la persona no tiene acceso a la hoja. Ver el
paso 4.

**«Faltan credenciales de la base» al sincronizar el padrón** — faltan las
Propiedades del script (paso 2 de la sección del padrón de RUC). No son las
mismas que las de `Codigo.gs`: van en Propiedades del proyecto, no en
variables del código.

**El padrón de RUC no trae ni un RUC nuevo** — el workflow «SUNAT padrón de
RUC» de GitHub Actions no ha corrido, o corrió en modo depuración (no
guarda nada). Revisa las Actions del repositorio.

**El scraper de Playwright ya no encuentra los datos en la página de
resultado** — SUNAT cambió las etiquetas de la Consulta RUC («Estado del
Contribuyente:», «Padrones:», …). Se ajustan en
`lib/sunat/consulta-ruc.ts` (función `ETIQUETAS_CONSULTA_RUC`), no en este
archivo.

**Se borró una pestaña que alguien agregó** — no debería volver a pasar: la
publicación escribe solo dentro de la pestaña de datos. Si pasa, avisa: es un
error nuestro, no de quien la agregó.

**Tarda en abrir la primera vez** — son trece mil filas. Después queda en
caché media hora.
