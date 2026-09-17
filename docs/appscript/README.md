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

## Si algo falla

**«La hoja no trae estas columnas…»** — cambiaron los títulos en la fuente. El
mensaje dice cuáles. Se arreglan en `COL`, al principio de `Codigo.gs`.

**El tablero sale vacío** — la persona no tiene acceso a la hoja. Ver el
paso 4.

**Se borró una pestaña que alguien agregó** — no debería volver a pasar: la
publicación escribe solo dentro de la pestaña de datos. Si pasa, avisa: es un
error nuestro, no de quien la agregó.

**Tarda en abrir la primera vez** — son trece mil filas. Después queda en
caché media hora.
