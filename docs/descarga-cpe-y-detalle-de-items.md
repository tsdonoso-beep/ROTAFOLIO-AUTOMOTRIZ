# Descargar el CPE y su detalle de ítems

Plan técnico para bajar de SUNAT el comprobante físico (XML/PDF/CDR) de cada
factura de compra y, del XML, las líneas de detalle —cuánto de cada cosa,
a qué precio—, y sacarlas a una hoja de Google como ya se hace con la
cabecera.

**Regla de este documento:** separa lo que ya existe de lo que hay que
construir, y marca lo que todavía hay que verificar contra la doc de SUNAT.
Nada de lo que dice «verificar» debería codearse creyendo que está confirmado.

Última revisión: 16 de setiembre de 2026.

---

## 1. Qué se quiere y por qué

Hoy la app trae de SUNAT el **registro de compras** (RCE): una fila por
comprobante con RUC, serie, número, fecha, base, IGV y total. Es la cabecera.
No trae dos cosas que Contabilidad y Control de Gestión sí necesitan:

1. **El archivo físico de cada comprobante** —XML, PDF, CDR—, que es el
   sustento legal y hoy se baja a mano del portal, uno por uno.
2. **El detalle de ítems**: qué se compró en cada factura, cantidad y precio
   unitario. Es lo que permite responder «¿en qué se gastó?», no solo
   «¿cuánto?». Es lo que muestra la captura de Excel Negocios («DETALLE DE
   ITEMS»).

El objetivo es que las dos cosas caigan **por el mismo camino que ya usa el
histórico**: guardadas en la base, publicadas como hoja de Google, sin
descargar nada a mano.

---

## 2. Lo que ya existe y se reutiliza

No hay que reconstruir el circuito. Se apoya en lo hecho:

| Pieza | Archivo | Se reutiliza para |
|---|---|---|
| Token de SUNAT | `lib/sunat/token.ts` | Auth (pero necesita un segundo scope, ver §4) |
| Patrón de ticket asíncrono | `lib/sunat/sire.ts` | El RCE ya lo resuelve; el CPE **no** usa ticket |
| Almacén de comprobantes | tabla `comprobantes_sunat` (mig. 016) | De aquí sale la lista de qué CPE bajar |
| Publicar a Sheets | `lib/drive/servidor.ts` → `publicarHoja()` | La nueva pestaña de ítems usa la misma función |
| Subir archivo a Drive | `app/api/drive-upload/route.ts` | Guardar el XML/PDF/CDR físico |
| Cron fuera de Vercel | `scripts/sunat-diario.mts` + GitHub Actions | Bajar los CPE del día en el mismo proceso |

**Lo importante:** la lista de comprobantes a descargar ya la tenemos. Cada
fila de `comprobantes_sunat` trae RUC del proveedor, tipo, serie y número —los
cuatro datos que el servicio de CPE pide para entregar el archivo—. No hay que
descubrir qué facturas existen; ya están guardadas.

---

## 3. El servicio nuevo de SUNAT (verificar antes de codear)

La descarga del CPE **no es SIRE**. Es otro servicio, en otro host:

- **Host:** `api-cpe.sunat.gob.pe`
- **Recurso:** `consultacpe`
- **Parámetros:** RUC del emisor (el proveedor), tipo de comprobante, serie,
  número, y el origen de la consulta.
- **Qué devuelve, según el sufijo de la URL:**
  - sin sufijo → metadata en JSON (estado/validez del comprobante, ya parseada)
  - `/01` → PDF
  - `/02` → **XML** ← el que trae el detalle de ítems
  - `/03` → CDR
- **Permite** bajar CPE propios o de terceros (los que se emitieron contra el
  RUC de la empresa), que es justo el caso de las compras de INROPRIN.

> **A verificar contra la doc vigente de SUNAT antes de escribir código:**
> 1. La ruta exacta del endpoint (`/v1/contribuyente/...`) y el nombre literal
>    del recurso.
> 2. El **scope del token**: `consultacpe` va habilitado aparte en la app de
>    SOL. Confirmar el valor de `scope` que espera el `api-seguridad` para
>    este host.
> 3. Si el JSON sin sufijo trae el detalle de ítems o solo la validación. La
>    hipótesis de este plan es que **el detalle sale del XML** (`/02`), no del
>    JSON. Si el JSON ya lo trae, nos ahorra el parseo de UBL.
> 4. Límites de cuota: cuántas descargas por minuto tolera antes del 429.

---

## 4. Cambio en el token: un segundo scope

Hoy `lib/sunat/token.ts` fija el scope en SIRE:

```ts
scope: SIRE,  // "https://api-sire.sunat.gob.pe"
```

y hay un test (`lib/sunat/__tests__/sunat.test.ts:119`) que afirma que un
token de SIRE **no sirve** para consultar comprobantes. Es correcto: son
scopes distintos.

El cambio es hacer el scope un parámetro, no una constante:

```ts
export function cuerpoDeToken(c: CredencialesSunat, scope = SIRE): URLSearchParams {
  return new URLSearchParams({ grant_type: "password", scope, /* ... */ });
}
```

y añadir la constante `export const CPE = "https://api-cpe.sunat.gob.pe";`.
`obtenerToken` cachea por clave; hay que **cachear por (clave, scope)** para no
pisar un token de SIRE con uno de CPE. Es un cambio chico y con test.

---

## 5. Parsear el XML: de UBL a ítems

El XML de la factura electrónica peruana es UBL 2.1. Cada línea vive en un
`<cac:InvoiceLine>` (o `<cac:CreditNoteLine>` para notas de crédito):

- `cbc:Description` → descripción del ítem
- `cbc:InvoicedQuantity` → cantidad (y su atributo `unitCode`: UNIDAD, GALON…)
- `cac:Price/cbc:PriceAmount` → precio unitario
- `cbc:LineExtensionAmount` → importe de la línea

Es **determinista, sin IA**: se lee el XML y se extraen los campos. Va en un
módulo nuevo `lib/sunat/cpe-xml.ts`, escrito como el resto de `lib/sunat` —una
función pura que recibe el texto del XML y devuelve `{ cabecera, items[] }`, con
tests contra un XML de muestra real—. El estilo del parser del RCE
(`lib/sunat/rce.ts`: tolerante, guiado por nombres, sin lanzar) es el modelo a
seguir.

---

## 6. Modelo de datos nuevo

Hoy es 1 fila = 1 comprobante. El detalle es uno-a-muchos, así que necesita
tablas nuevas (migraciones `027`, `028`):

```sql
-- Los archivos físicos de un comprobante, en Drive.
create table cpe_archivos (
  comprobante_id  uuid references comprobantes_sunat(id) on delete cascade,
  tipo            text not null,   -- 'XML' | 'PDF' | 'CDR'
  drive_url       text,
  bajado_en       timestamptz not null default now(),
  primary key (comprobante_id, tipo)
);

-- Las líneas de detalle de un comprobante, del XML.
create table items_comprobante_sunat (
  id              uuid primary key default gen_random_uuid(),
  comprobante_id  uuid not null references comprobantes_sunat(id) on delete cascade,
  linea           int  not null,   -- orden dentro del comprobante
  descripcion     text,
  cantidad        numeric(14,4),
  unidad          text,
  precio_unitario numeric(14,4),
  importe         numeric(14,2)
);
```

El XML se guarda en Drive (no en la base: pesa), y sus ítems parseados en
`items_comprobante_sunat`, que es lo que alimenta la hoja. Guardar los ítems
—y no solo el XML— es lo que permite filtrar y sumar por producto sin volver
a parsear miles de archivos.

---

## 7. La nueva pestaña del Sheet

`lib/export/comprobantes-sunat.ts` ya define el layout de la cabecera. El
detalle es otra hoja, **una fila por ítem**, en la misma línea de diseño
(cabeceras + descripción de columnas, orden fijo). Columnas propuestas:

```
Período · RUC proveedor · Proveedor · Tipo · Serie · Número · Fecha ·
Descripción · Cantidad · Unidad · Precio unitario · Importe · Enlace XML
```

Se publica en el archivo «COMPROBANTES SUNAT» que ya existe, como pestaña
aparte (`publicarHoja` ya sabe escribir por pestaña sin pisar las demás), para
no romper el tablero de Contabilidad que vive en otra pestaña del mismo
archivo.

---

## 8. Entregables, en orden

Incremental, cada paso sirve solo:

1. **Potenciar lo que ya sale** (cabecera de compras). Esfuerzo ~0: ya
   funciona `publicarHistoricoEnDrive()`. Quick win.
2. **Añadir ventas (RVIE)** al mismo circuito SIRE. Mismo patrón, otro libro
   (`RVIE` en vez de `080000`). Bajo esfuerzo, alto valor.
3. **Descargar el CPE físico** (XML+PDF+CDR) a Drive, por comprobante.
   Requiere §3 verificado y §4. Esfuerzo medio.
4. **Detalle de ítems** a la pestaña nueva, parseando el XML del paso 3. Así
   el ítem sale del archivo ya bajado, sin una consulta extra por factura.
   Esfuerzo medio-alto.

---

## 9. Riesgos y límites

- **Volumen.** Cada factura tiene N líneas; 13.000 comprobantes son decenas
  de miles de ítems. La app ya pagina 13.000 filas y publica a Sheets, así que
  el patrón aguanta, pero la pestaña de ítems será la más pesada del archivo.
- **Cuota de SUNAT.** El RCE ya devuelve 429 al pedir varios períodos
  seguidos. Una descarga por comprobante multiplica las llamadas: hay que
  bajar en lote con espera, reintento y espaciado —el manejo de 429 ya está en
  `sire.ts` y se reaprovecha—.
- **Solo desde la obligación SIRE.** El RCE existe desde que INROPRIN entró
  como obligado (cronograma 2023). El CPE por `consultacpe` puede alcanzar más
  atrás, pero el «lo rindió» y el cruce solo aplican a lo que tenemos.
- **Boletas de viático no aparecen.** Igual que hoy: lo que el técnico pidió a
  su nombre, o un Yape, nunca se declaró contra la empresa. Esto refuerza las
  facturas, no reemplaza la captura por foto.

---

## 10. Decisiones pendientes (para el usuario)

1. ¿Arrancamos por el **quick win** (paso 1) o vamos directo al **detalle de
   ítems** (pasos 3-4)?
2. ¿Se quiere **ventas (RVIE)** además de compras, o solo compras por ahora?
3. ¿El XML/PDF/CDR físico va a Drive **siempre**, o solo el XML (que basta
   para el detalle) y el resto bajo demanda?
