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

## Tablero SUNAT, publicado (no dentro del Sheet)

`CodigoPadron.gs` + `TableroPadron.html`: **una sola vista** del registro de
compras del SIRE (la hoja COMPROBANTES SUNAT), publicada como su propia URL,
con el mismo lenguaje que la vista del DETALLE y el tablero del legajo.
Desde octubre de 2026 lee **solo la hoja** —que ya trae la columna «Buen
Contribuyente»—: no se conecta a la base ni necesita Propiedades del script.

- **Buscar una factura** (todo el registro): serie-número, número, RUC,
  proveedor o monto, con su IGV y si el proveedor es buen contribuyente.
  Incluye lo que todavía no tiene XML; el PDF y los productos están en la
  vista del DETALLE.
- **Filtro por mes** (por omisión, el último) e indicadores: compras, IGV
  (crédito fiscal), notas de crédito y **% del monto comprado a buenos
  contribuyentes**, con la variación contra el mes anterior.
- **IGV por mes** (clic = filtro), la barra **¿son buenos contribuyentes?**
  (monto y proveedores: sí / no / sin consultar) con los que más se les
  compró y no lo son (clic = los busca), las **notas de crédito** con la
  factura que corrigen, y los **comprobantes que SUNAT cambió**.

Los montos van en soles con el tipo de cambio del mismo SIRE, y las notas de
crédito restan.

### Instalación
1. En el proyecto: Script `CodigoPadron` (pega `CodigoPadron.gs`) y HTML
   `TableroPadron` (pega `TableroPadron.html`). No hace falta nada más.
2. **Implementar → Nueva implementación → Aplicación web**: Ejecutar como
   tu cuenta; acceso «Cualquier usuario de tu organización».
3. Cada vez que cambies el código: **Gestionar implementaciones** → lápiz →
   Versión **Nueva** → Implementar (si no, la URL sigue con la versión vieja).

## Vista ejecutiva (para compartir de forma formal)

`VistaEjecutiva.gs` es distinto a todo lo anterior: no es una pestaña dentro
de la hoja, es un **sitio aparte** —un enlace propio que se manda por correo
o WhatsApp— con un resumen visual (cuánto, de quién, por tipo de
comprobante, mes a mes) y un botón que abre la hoja real para quien
necesite el desglose. Pensado para mostrar, no para trabajar sobre él.

Son dos archivos, mismo patrón que `TableroPadron.gs` + `TableroPadron.html`:
el script calcula los números una vez por visita y el HTML solo los pinta
(se los pide con `google.script.run`, no hay que tocar nada de eso).

Desde octubre de 2026 es un **tablero interactivo**, con el mismo lenguaje
que el del legajo por OC: el servidor manda cada comprobante en forma
compacta (≈1.4 MB para todo el año) y el navegador arma los totales al
instante según el filtro.

- **Filtros fijos arriba:** mes, compras o ventas, y moneda (no se convierten).
- **Indicadores:** compras con su evolución, proveedores, notas de crédito (ya
  restadas), detracción, % unido a su OC, % con centro de costo,
  importaciones y productos distintos.
- **Compras por mes** (clic en un mes = filtro) y **dona por tipo**.
- **Buscar una factura** (arriba, sin filtros): por serie-número (F001-123,
  «F001 123» o solo el número), RUC, proveedor o monto. Cada resultado trae
  el PDF y el XML, y al abrirlo muestra sus líneas, la OC, su legajo y la
  carpeta (el detalle se trae en el momento con `detalleDelComprobante`, que
  busca con TextFinder y no vuelve a leer toda la hoja). Sirve aunque SUNAT
  esté caída.
- **Buscador de compras** («¿Cuánto pagamos por…?»): todo lo comprado, no
  solo lo que se repite, por palabras sueltas y sin tildes («pollo brasa»,
  «impresora»), con veces, último precio, su línea en el tiempo, la
  variación y el **PDF de la última compra**. Viajan los 7 000 productos de
  más gasto (`VISTA_MAX_PRODUCTOS`).
- **Proveedores mes a mes** como mapa de calor, y los principales del período.
- **Importaciones** (gastos con factura en SUNAT por OC, con su legajo) y
  **centros de costo**.

Cada comprobante se suma una sola vez (la hoja trae una fila por ítem) y la
nota de crédito resta. El mes es el de emisión; el SIRE lo anota en el mes en
que se registra, así que un mes puede diferir un poco del SIRE.

### Instalación

1. Abre **COMPROBANTES SUNAT - DETALLE** → **Extensiones · Apps Script**.
2. El **+** junto a «Archivos» → **Script** → llámalo **`VistaEjecutiva`** →
   borra el contenido de ejemplo y pega el de **`VistaEjecutiva.gs`**.
3. El **+** → **HTML** → llámalo **exactamente `VistaEjecutivaPagina`**
   (sin `.html` al crearlo, Apps Script se lo agrega solo) → pega el
   contenido de **`VistaEjecutivaPagina.html`**. Tiene que ser un nombre
   **distinto** al del script: Apps Script comparte un solo espacio de
   nombres entre todos los archivos del proyecto sin importar el tipo, así
   que un script y un HTML no pueden llamarse igual. Si el nombre no calza
   exacto, `doGet()` no lo encuentra.
4. Guarda con el disquete.
5. **Implementar** (arriba a la derecha) → **Nueva implementación** → el
   engranaje → **Aplicación web**.
   - Ejecutar como: **Yo** (tu cuenta).
   - Quién tiene acceso: **Cualquier usuario con el enlace** (o la variante
     de Workspace si solo debe verlo gente de la empresa).
6. **Implementar**. La primera vez pide autorización: elige tu cuenta,
   **Configuración avanzada** → **Ir a (nombre del proyecto)** → **Permitir**.
7. Copia la URL que termina en **`/exec`** — esa es la que se comparte, no
   la del editor de Apps Script.

### Si se edita el código después

Cada cambio necesita una implementación nueva para que el enlace ya
compartido lo refleje: **Implementar** → **Gestionar implementaciones** →
el lápiz sobre la implementación activa → **Versión: Nueva versión** →
**Implementar**. La URL no cambia.

## Captura de archivos en las carpetas de OC

`CapturaCarpetasOC.gs` recorre el **LINK DE CARPETA** de cada OC de la base
de Control de Gestión («Bd ventas, costo y gastos», pestaña **3. Registro
Compras Grupo**) y anota cada archivo que encuentra: dónde está, cómo se
llama, su enlace y qué parece ser (factura, guía, pago, OC…). Es el primer
paso para unir cada factura de SUNAT con su OC y, por la OC, con su centro de
costo. **No abre los archivos**: solo mira nombres.

La base original **solo se lee**. El script va en una hoja aparte, de tu
unidad, y escribe ahí tres pestañas: **CARPETAS** (una fila por OC),
**ARCHIVOS** (una fila por archivo) y **RESUMEN**.

Busca a fondo:

- **Todas las subcarpetas**, a cualquier profundidad.
- **Palabras parecidas**: FACTURA, FACT, FT, `F001-…`, `E001-…`, y errores de
  tipeo (FATURA, FACTRUA, FACUTAS).
- **Por la carpeta**: un `scan001.pdf` dentro de una subcarpeta «Facturas»
  (o «Facutas») cuenta como factura.
- **Fuera de la carpeta** (apagado por omisión, `BUSCAR_FUERA`): si una OC
  no tiene nada que parezca factura adentro, busca archivos con su número de
  OC en la carpeta superior y en todo el Drive. Esos quedan marcados
  «(confirmar)», porque el número de OC puede repetirse entre empresas. En la
  primera corrida aportó poco y hace la revisión más lenta.

### Cómo se usa

1. Crea una hoja nueva en tu unidad → **Extensiones · Apps Script** → pega
   `CapturaCarpetasOC.gs` → guarda.
2. Revisa la **Configuración** al inicio: `EMPRESAS` (por omisión INROPRIN)
   y `ANIOS` (por omisión 2026).
3. Recarga la hoja → menú **Carpetas OC** → **1. Armar lista de carpetas**.
4. **2. Revisar siguiente tanda**, o **Revisar solo cada 10 minutos** para que
   avance solo por tandas de ~5 minutos (Apps Script corta a los 6). Se
   detiene al terminar.

## Lectura de facturas (segundo paso de la captura)

`LecturaFacturas.gs` va **en el mismo proyecto** que `CapturaCarpetasOC.gs`
(usa sus funciones y su pestaña ARCHIVOS). Abre los archivos que parecen
factura pero no traen el número en el nombre («FACTURA OC 0115-2026.pdf») y,
en las carpetas sin factura, hasta 5 archivos «OTRO» por si alguno lo es.
Anota en una pestaña nueva, **LECTURA**, lo que dice el documento: RUC del
emisor, tipo, serie-número, fecha, total y la OC si aparece escrita.

Lee con la conversión de Drive (la misma lectura OCR que hace Drive con PDF e
imágenes): hace una copia temporal como documento de Google en la carpeta
`_lectura_facturas_temporal`, saca el texto y la borra. El original no se
toca.

### Cómo se usa

1. En el proyecto de la captura: **+ · Script** → `LecturaFacturas` → pega
   el archivo → guarda.
2. **Servicios (+) · Drive API · Agregar.**
3. Recarga la hoja → menú **Leer facturas** → **1. Preparar lista de
   facturas a leer** → **Leer solo cada 10 minutos**.

## Subir la captura a la base (tercer paso)

`SubirCapturaOC.gs` va en el mismo proyecto que los dos anteriores. Manda a
la base de la aplicación la pestaña ARCHIVOS (con lo leído en LECTURA) y el
centro de costo de cada OC según Control de Gestión (tablas `oc_archivo` y
`oc_base_cg`, migración `039_la_oc_de_cada_comprobante.sql`). Cada subida
reemplaza a la anterior.

El cruce con SUNAT lo hace la base, en vivo, con `vinculos_oc()`: una factura
que SUNAT reporta después de capturada se une sola. Las hojas COMPROBANTES
SUNAT y DETALLE suman al final **OC (carpeta)**, **Centro de costo (CG)** y
**Código CONCAR** (y COMPROBANTES SUNAT, **Revisar vínculo OC**). El código
CONCAR sale **solo si la equivalencia está confirmada** en
`equivalencia_centro_costo`; si hay duda, queda en blanco.

### Cómo se usa

1. **+ · Script** → `SubirCapturaOC` → pega el archivo → guarda.
2. **Engranaje · Propiedades del script**: `SUPABASE_URL`,
   `SUPABASE_ANON_KEY`, `ROBOT_CORREO`, `ROBOT_CLAVE` (los mismos de
   `OrdenarCPE.gs`).
3. Recarga la hoja → menú **Base de datos** → **Subir captura a la base**.

## Legajo por OC (la tabla objetivo de un proyecto)

`LegajoPorOC.gs` arma, para **un** proyecto (el piloto es EPT), una fila por
OC con los 11 documentos que Contabilidad necesita para registrar la compra
en CONCAR, y marca cuál está y cuál falta en la carpeta de cada OC:

| # | Documento | Le corresponde a |
|---|---|---|
| 1 | Factura | todas |
| 2 | OC | todas |
| 3 | SWIFT | solo importaciones |
| 4 | Guía de remisión | bienes (no servicios) |
| 5 | DAM | solo importaciones |
| 6 | Requerimiento | todas (basta el N° del plan) |
| 7 | Contrato (CECO) | uno por centro de costo, no por OC |
| 8 | Cotización | todas |
| 9 | Proforma | opcional |
| 10 | Correos | opcional |
| 11 | Acta de conformidad | solo servicios |

Marcas: **✓ n** (hay n archivos; el enlace abre el primero), **✗** (falta),
**—** (no le corresponde), **○** (opcional y no está).

Las OC salen de cuatro fuentes, cruzadas en los dos sentidos:

- **Plan de compras** del proyecto (Plan de Compras y SEGUIMIENTO
  NACIONALES / IMPORTACIONES): la fuente de verdad.
- **Base de OC de Compras**, que viene dentro del plan (BD_NAC 26, BASE DE
  DATOS NACIONAL / IMPORTACIONES): RUC, requerimiento y código SIDIGE.
- **Cuadros de aprobaciones**: el del plan (2025) y el general (2026), con el
  enlace de la carpeta.
- **Control de Gestión**: centro de costo.

La columna «Revisar el cruce» dice qué OC está en una fuente y no en otra.
RESUMEN da el % de cada documento por área: **Compras nacionales** y
**COMEX**.

Las OC nacionales (4 dígitos, `0172-2026`) y las de importación (3 dígitos,
`172-2026`) son **numeraciones distintas** que se repiten. El script las
separa por la procedencia; no hay que juntarlas.

El mismo script también arma la lista de **todas las OC 2026**. Cada fuente
aporta lo suyo:

| Fuente | Qué aporta |
|---|---|
| **Base de datos nacionales 2026** de Compras (pestaña `BD-2026`, `NACIONALES_ID`) | La lista completa de OC **nacionales** de Inroprin: se arma sola con los archivos de OC de cada comprador. Proyecto, RUC, requerimiento; y, si la OC no pasó por el cuadro, fecha, comprador, moneda y forma de pago. |
| **Cuadro de aprobaciones 2026** | Las **importaciones** y las OC de las otras unidades; de las nacionales que pasaron por él, la aprobación, la situación del pago y el enlace de la carpeta. |
| **Control de Gestión** (Registro Compras Grupo) | Solo el **centro de costo** y la **carpeta** cuando el cuadro no la trae. No agrega OC. |

El cuadro tiene más o menos la mitad de las OC nacionales: las compras de los
proyectos PRONIED y los gastos administrativos chicos no pasan por él. Esas
salen con la situación del pago «NO ESTÁ EN EL CUADRO DE APROBACIONES» (no se
cuentan como «sin pagar»: el pago no se sabe). Y si una OC nacional de
Inroprin está en el cuadro pero no en la base de nacionales, «Revisar el
cruce» lo avisa (suele ser un número mal escrito). Quien corre el script
necesita acceso de lectura a la base de nacionales.

Como la misma OC puede existir en Inroprin y en Inroplas, la unidad va en la
clave. «1296.1-2025» y «1296.2-2025» son partes de la OC 1296.

Si el enlace apunta a una subcarpeta del legajo («01 PROVEEDOR»), se sube a
la carpeta de la OC. Si ni así hay factura, se miran los archivos de la
carpeta de arriba que llevan el número de la OC.

Si a la OC le falta factura, guía, DAM o acta, se **leen por dentro** (OCR de
Drive) hasta 4 PDF o imágenes cuyo nombre no lo dice: los de nombre genérico
(«docs…», «scan…») y los que pasaron por OC solo por decir «OC» o llevar su
número. Un «docs solpack oc150-2026.pdf» escaneado trae factura y guía, y
cuenta para las dos. La factura se reconoce por «FACTURA ELECTRÓNICA» (o
«factura» + serie F… + RUC, o «commercial invoice»); la guía, por el punto de
partida y de llegada, no por la palabra: la factura cita su guía. Necesita el
servicio **Drive API** (Servicios + → Drive API); sin él, funciona sin leer.
La serie-número que lee (F001-113668, con los errores típicos del OCR como
«FO01» o «FACTUR A», y también facturas físicas «001- N° 0031388») queda en
la celda de la factura: «✓ 1 · F001-113668». Un nombre como
«01F0010031388.pdf» (tipo pegado a serie y número) ya se reconoce sin leer.

**En vivo, cada noche.** «Programar actualización cada noche (20:00)» vuelve
a leer las fuentes (base de nacionales, cuadro de aprobaciones y CG) a las 8 PM (zona horaria del proyecto de
Apps Script): suma las OC nuevas, actualiza estatus, aprobaciones y montos, y
conserva lo ya revisado. Solo vuelven a revisarse las carpetas nuevas, las que
cambiaron de enlace, las sin acceso, las que aún no tienen factura y las que
tienen faltantes revisados hace más de 7 días (`DIAS_PARA_REVISAR_FALTANTES`).
La revisión vieja se lee por el nombre de sus columnas, así que la misma
opción sirve para pasar a una versión nueva del script sin perder nada.

Las columnas del cuadro se buscan **por nombre, o por uno parecido**
(`parecidoDeTitulos_`: mismas palabras sin contar «de», «la», «N°», con
plurales y un error de tipeo; «Aprobación GAF» no se confunde con «Aprobación
GOP»). La pestaña COLUMNAS dice dónde encontró cada campo. Para Contabilidad
se traen: situación del pago (pagada, aprobada con pago pendiente, falta
aprobación, legajo incompleto, anulada…), estatus, estado y tipo de
aprobación, aprobaciones Ppto/GOP/GAF, VB de Control de Gestión, montos,
moneda, forma de pago, adelanto, días de crédito, legajo para pago, OC
cerrada, observaciones de finanzas, compras y Control de Gestión. Las OC
anuladas no cuentan en los porcentajes de documentos.

Menú: **Probar la lectura por dentro (OCR)** confirma que Drive API y los
permisos están bien; **Volver a revisar las que NO tienen factura** repite solo
esas OC (y limpia sus filas viejas de ARCHIVOS).

### Cómo se usa

1. Una hoja **nueva** en tu unidad → Extensiones → Apps Script → pega el
   archivo (no en el proyecto de la captura: los nombres chocarían).
2. Para otro proyecto, cambia `PROYECTO` al principio (el de Especializado
   está escrito al lado).
3. Recarga → menú **Legajo por OC** → **1. Armar tabla del proyecto EPT** o
   **1. Armar tabla de TODAS las OC 2026 (base de nacionales + cuadro)** → **Revisar solo
   (3 en paralelo)**. Para tener las dos, una hoja nueva para cada una.

La revisión corre con **tres revisores a la vez**: cada uno toma una OC de
cada tres, recorre sus carpetas sin bloquear a los otros y solo se turnan
para escribir. Ojo con la cuota de Google: los relojes de un usuario tienen
un tope diario de tiempo de ejecución (unas 6 horas en cuentas de empresa, 90
minutos en Gmail). Si aparece «Service using too much computer time», se
sigue solo al día siguiente.

## Tablero del legajo (vista para Contabilidad)

`VistaLegajo.gs` + `TableroLegajo.html` van en el **mismo proyecto** que
`LegajoPorOC.gs` (usan sus constantes) y solo leen TABLA y RESUMEN. Muestran:

- **La lectura**: si la actualización de las 8 PM está programada, cuánto
  falta para la próxima, la última actualización y si los revisores están
  trabajando ahora (se refresca sola cada 2 minutos mientras trabajan).
- **La analítica**, con filtros por unidad, área, mes y situación del pago:
  legajo completo, factura, guía, pagadas sin factura, monto con legajo
  incompleto, aún sin pagar; un mapa de calor documento × área (clic → las
  OC a las que les falta), situación del pago, completitud por unidad,
  evolución mensual y «quién debe completar» por comprador.
- **El buscador**: qué le falta a cada OC y a quién le toca (la guía a
  Almacén; lo demás al área que compró), con el enlace a cada archivo y a
  la carpeta.

### Cómo se usa

1. En el proyecto de Apps Script de la hoja: **+ → Script** «VistaLegajo»
   (pega el `.gs`) y **+ → HTML** «TableroLegajo» (pega `TableroLegajo.html`).
   Apps Script no deja que un `.gs` y un `.html` se llamen igual: por eso
   tienen nombres distintos.
2. Dentro de la hoja: menú **Legajo por OC → 📊 Abrir el tablero**.
3. Enlace propio para compartir: **Implementar → Nueva implementación →
   Aplicación web**, «Ejecutar como: Yo» y acceso para tu organización. El
   estado de los relojes que muestra es el de quien lo implementó.

## El legajo en las hojas de SUNAT

`SubirLegajo.gs` va en el **mismo proyecto** que `LegajoPorOC.gs` y manda el
legajo de Inroprin (la empresa con comprobantes de SUNAT) a la base: una
fila por OC (tabla `oc_legajo`) y los archivos que traen la factura o una
serie-número (tabla `oc_archivo`, origen `LEGAJO`). No toca lo que subió la
captura de carpetas: cada una reemplaza solo lo suyo (migración 042).

La base cruza esos archivos con SUNAT y COMPROBANTES SUNAT y el DETALLE
suman al final cinco columnas:

| Columna | De dónde sale |
| --- | --- |
| Situación del pago (OC) | la misma del legajo: PAGADA, APROBADA PAGO PENDIENTE, FALTA APROBACIÓN, ANULADA… |
| Comprador (OC) | el cuadro de aprobaciones |
| Área que completa el legajo | Compras nacionales o COMEX (importaciones) |
| Legajo de la OC | «Completo», «Falta: Guía de remisión, DAM», «Sin acceso a la carpeta» o «Por revisar» |
| Carpeta de la OC | el enlace de la carpeta en Drive |

Además, el centro de costo sale del legajo (que distingue nacional de
importación) y «Alertas» avisa si la OC está anulada en el cuadro.

### Cómo se usa

1. En el proyecto de Apps Script de la hoja: **+ → Script** «SubirLegajo» y
   pega el archivo.
2. Engranaje → **Propiedades del script**: `SUPABASE_URL`,
   `SUPABASE_ANON_KEY`, `ROBOT_CORREO`, `ROBOT_CLAVE` (las mismas de
   `SubirCapturaOC.gs`).
3. Menú **Legajo por OC → Subir el legajo a la base (hojas de SUNAT)**. Al
   terminar dice cuántas OC y archivos subió y cuántas facturas quedaron
   unidas con su OC.
4. Desde ahí se sube solo cada noche, cuando los revisores terminan. Las
   columnas aparecen con la siguiente publicación diaria de las hojas.

## La carpeta madre en GENERAL

`CarpetaMadre.gs` va en el proyecto de Apps Script de la hoja **GENERAL**.
Trae de la base (`legajo_de_carpetas()`, migración 051) lo que el robot de
las 02:00 (`carpetas-oc`) leyó de las dos carpetas madre de compras, y deja
dos pestañas que reemplaza cada vez:

- **CARPETA MADRE**: una fila por carpeta de OC (nacionales e importaciones)
  con su legajo (documentos, qué le falta, estado), centro de costo y de
  dónde salió, las facturas de SUNAT ya unidas, si está en CG y el último
  cambio que vio el robot. El nombre de la carpeta es un enlace.
- **CARPETA MADRE - RESUMEN**: cuántas completas, incompletas, qué les falta,
  cuántas con factura de SUNAT y de dónde sale el centro de costo.

### Cómo se instala

1. Hoja GENERAL → **Extensiones → Apps Script → + → Script** «CarpetaMadre» y
   pega el archivo.
2. Engranaje → **Propiedades del script**: `SUPABASE_URL`,
   `SUPABASE_ANON_KEY`, `ROBOT_CORREO`, `ROBOT_CLAVE` (si ya están por
   `SubirLegajo.gs`, no hay que hacer nada).
3. En la lista de funciones elige **instalarCarpetaMadre → Ejecutar** y
   acepta los permisos. Trae los datos en ese momento, agrega el menú
   **Carpeta madre** y la deja programada cada mañana a las 7:00.

El DETALLE de SUNAT suma, al final, «Proyecto de la OC», «Centro de costo
según» y «Documentos de la OC», de la misma carpeta madre
(`detalle_cpe_carpeta()`, migración 051).

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
