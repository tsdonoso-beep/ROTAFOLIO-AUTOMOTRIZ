# Tablero de monitoreo para Contabilidad

Un panel dentro de una hoja de Google que lee la que publica la aplicación y
muestra el mes: cuánto IGV, cuántas notas de crédito y cuánto restan del
crédito fiscal, qué comprobantes cambiaron y quién factura más.

## Por qué en una hoja aparte

La hoja que publica la aplicación —**COMPROBANTES SUNAT**— se reescribe entera
todos los días con lo que trae SUNAT. Cualquier cosa que alguien agregue
encima se perdería sin aviso: una fórmula, una columna, este mismo script.

Por eso el tablero vive en **otra hoja**, que solo la lee. Así Contabilidad
puede trabajar sobre ella sin miedo, y si algo se rompe, la fuente sigue
intacta.

## Instalación

### 1. Crear la hoja

En Google Drive: **Nuevo · Hoja de cálculo**. Ponle **TABLERO SUNAT**.

No necesita ningún dato: todo lo lee de la otra.

### 2. Pegar el código

En esa hoja: **Extensiones · Apps Script**.

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
correo. Elige la cuenta, **Configuración avanzada**, **Ir a TABLERO SUNAT**,
y **Permitir**.

### 4. Que Contabilidad pueda entrar

Comparte la hoja **TABLERO SUNAT** con quien la vaya a usar.

Y que cada persona tenga también acceso de lectura a **COMPROBANTES SUNAT**:
sin eso el tablero le sale vacío. Ese acceso se da desde la aplicación, en
**Sistema · Credenciales de SUNAT · Publicar y dar acceso a Contabilidad**.

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

## Si algo falla

**«La hoja no trae estas columnas…»** — cambiaron los títulos en la fuente. El
mensaje dice cuáles. Se arreglan en `COL`, al principio de `Codigo.gs`.

**El tablero sale vacío** — la persona no tiene acceso de lectura a
COMPROBANTES SUNAT. Ver el paso 4.

**Tarda en abrir la primera vez** — son trece mil filas. Después queda en
caché media hora.
