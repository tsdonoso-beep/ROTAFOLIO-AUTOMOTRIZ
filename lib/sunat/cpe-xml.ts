// Leer el XML de un comprobante y sacarle el detalle de ítems
//
// El registro de compras (RCE) trae la cabecera: cuánto, de quién, cuándo.
// No trae en qué se gastó. Eso —"4 CONTENEDOR DE BASURA 240L a 287.29 c/u"—
// solo vive en el XML del comprobante, que se baja de la pantalla de SUNAT
// «Consultar Factura y Nota → Descarga masiva → Recibidas».
//
// El XML es UBL 2.1, el estándar de la factura electrónica peruana. Es
// verboso pero regular: la cabecera arriba y una línea por producto en
// bloques `cac:InvoiceLine` (o `CreditNoteLine` / `DebitNoteLine` según el
// tipo). No hace falta una librería de XML —el proyecto no la tiene y sus
// otros lectores, el de CSV y el de zip, están escritos a mano por la misma
// razón—: se extrae por nombre de etiqueta, ignorando el prefijo del espacio
// de nombres, que SUNAT no siempre escribe igual.
//
// Como el resto de `lib/sunat`, no lanza: devuelve lo que entendió. Un XML
// raro tiene que poder mirarse, no tumbar la importación de las otras mil
// facturas del lote.

export interface ItemCpe {
  /** El orden de la línea dentro del comprobante. */
  linea: number | null;
  descripcion: string | null;
  cantidad: number | null;
  /** El código de unidad de SUNAT: NIU (unidad), GLL (galón), ZZ (servicio)... */
  unidad: string | null;
  precioUnitario: number | null;
  /** Lo que suma la línea. */
  importe: number | null;
}

export interface ComprobanteCpe {
  /** Código SUNAT: 01 factura, 03 boleta, 07 nota de crédito, 08 nota de débito. */
  tipoComprobante: string | null;
  serie: string | null;
  numero: string | null;
  /** yyyy-mm-dd */
  fechaEmision: string | null;
  moneda: string | null;
  /** RUC de quien emitió: el proveedor. */
  proveedorRuc: string | null;
  proveedorNombre: string | null;
  /** RUC a nombre de quien se emitió: debe ser la empresa. */
  adquirienteRuc: string | null;
  adquirienteNombre: string | null;
  /** Base imponible: la suma de las líneas antes de impuestos. */
  subtotal: number | null;
  igv: number | null;
  total: number | null;
  items: ItemCpe[];
}

// ════════════════════════════════════════════════════════════════
// Primitivas de lectura, por nombre local de etiqueta
//
// Todas ignoran el prefijo del espacio de nombres: `<cbc:ID>`, `<ID>` y
// `<n1:ID>` se leen igual. SUNAT y sus proveedores de emisión no son
// consistentes, y atarse a un prefijo hace que un XML válido se lea vacío.

/** Un nombre de etiqueta, con prefijo opcional, listo para meter en un regex. */
function conPrefijo(nombre: string): string {
  return `<(?:[\\w.-]+:)?${nombre}\\b`;
}

/**
 * El contenido de una etiqueta hoja: texto plano o CDATA.
 *
 * SUNAT envuelve todo el texto libre —razón social, descripción del ítem— en
 * `<![CDATA[...]]>`, porque puede llevar `&`, `<` o comillas sin escapar. Una
 * captura de «todo lo que no sea `<`» se corta en el `<` del CDATA y devuelve
 * vacío. Por eso la captura admite tramos CDATA además de texto suelto.
 *
 * Que sea una secuencia de (CDATA | no-`<`) y no un `.*` es lo que mantiene a
 * salvo las etiquetas vacías: ante un `<cbc:ID/>` la captura no cruza hasta un
 * cierre lejano, sino que no encaja y el buscador sigue de largo.
 */
const CONTENIDO = `((?:<!\\[CDATA\\[[\\s\\S]*?\\]\\]>|[^<])*)`;

/** Quita los marcadores de CDATA y los espacios de alrededor. */
function limpiar(s: string): string | null {
  const t = s.replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "").trim();
  return t || null;
}

/**
 * El texto de la primera etiqueta hoja con ese nombre, dentro de un tramo.
 *
 * Sirve para valores sueltos —un ID, una fecha, un monto, un nombre—.
 */
export function valor(xml: string, nombre: string): string | null {
  const re = new RegExp(`${conPrefijo(nombre)}[^>]*>${CONTENIDO}</(?:[\\w.-]+:)?${nombre}>`);
  const m = re.exec(xml);
  return m ? limpiar(m[1]) : null;
}

/** Todos los textos hoja con ese nombre, en el orden en que aparecen. */
export function valores(xml: string, nombre: string): string[] {
  const re = new RegExp(`${conPrefijo(nombre)}[^>]*>${CONTENIDO}</(?:[\\w.-]+:)?${nombre}>`, "g");
  const out: string[] = [];
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const t = limpiar(m[1]);
    if (t) out.push(t);
  }
  return out;
}

/**
 * El valor de un atributo en la primera etiqueta con ese nombre.
 *
 * La cantidad guarda su unidad ahí: `<cbc:InvoicedQuantity unitCode="NIU">`.
 */
export function atributo(xml: string, nombre: string, attr: string): string | null {
  const re = new RegExp(`${conPrefijo(nombre)}[^>]*\\b${attr}="([^"]*)"`);
  const m = re.exec(xml);
  return m ? m[1].trim() || null : null;
}

/**
 * El contenido de los elementos con ese nombre, respetando el anidamiento.
 *
 * Cortar por el primer cierre no sirve: un `cac:InvoiceLine` contiene otros
 * `cac:` dentro, y si el nombre buscado se repite anidado, el primer `</...>`
 * cierra el de adentro y el bloque sale partido. Se lleva la cuenta de
 * apertura y cierre para cerrar el que corresponde.
 *
 * Las etiquetas vacías (`<x/>`) no abren nada y se saltan.
 */
export function bloques(xml: string, nombre: string): string[] {
  const tag = new RegExp(`<(/?)(?:[\\w.-]+:)?${nombre}\\b([^>]*)>`, "g");
  const out: string[] = [];
  let profundidad = 0;
  let inicio = -1;

  for (let m = tag.exec(xml); m; m = tag.exec(xml)) {
    const esCierre = m[1] === "/";
    const autocierre = /\/\s*$/.test(m[2]);
    if (autocierre) continue;

    if (!esCierre) {
      if (profundidad === 0) inicio = m.index + m[0].length;
      profundidad++;
    } else if (profundidad > 0) {
      profundidad--;
      if (profundidad === 0 && inicio >= 0) {
        out.push(xml.slice(inicio, m.index));
        inicio = -1;
      }
    }
  }
  return out;
}

/** El primer bloque con ese nombre, o cadena vacía si no hay. */
export function bloque(xml: string, nombre: string): string {
  return bloques(xml, nombre)[0] ?? "";
}

// ════════════════════════════════════════════════════════════════
// Conversión de valores

/**
 * Un monto de UBL. Siempre viene con punto decimal y sin separador de miles,
 * pero se limpia por si un emisor se sale del estándar.
 */
export function aMonto(v: string | null): number | null {
  if (v == null) return null;
  const s = v.replace(/\s/g, "");
  if (!s) return null;
  const limpio = s.includes(",") && s.includes(".") ? s.replace(/,/g, "")
    : s.includes(",") ? s.replace(",", ".") : s;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

/** La fecha de emisión de UBL ya viene como yyyy-mm-dd; se valida y se pasa. */
export function aFechaXml(v: string | null): string | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Parte el ID del comprobante en serie y número.
 *
 * Viene como «F001-00000123». La serie es lo de antes del guion; el número,
 * lo de después, sin los ceros de relleno para que compare igual que el del
 * registro, que tampoco los trae.
 */
export function partirSerieNumero(id: string | null): { serie: string | null; numero: string | null } {
  if (!id) return { serie: null, numero: null };
  const m = /^([A-Za-z0-9]{1,4})-(\d+)$/.exec(id.trim());
  if (!m) return { serie: null, numero: null };
  return { serie: m[1].toUpperCase(), numero: m[2].replace(/^0+/, "") || "0" };
}

// ════════════════════════════════════════════════════════════════
// El comprobante entero

/**
 * De qué tipo de comprobante es el XML, según su elemento raíz.
 *
 * La factura y la boleta comparten raíz `Invoice` y se distinguen por el
 * `InvoiceTypeCode` (01 factura, 03 boleta). Las notas tienen raíz propia:
 * el código de tipo de nota que traen adentro es el motivo, no el tipo de
 * documento, así que ese se fija por la raíz.
 */
function tipoDe(xml: string): { tipo: string | null; lineaTag: string; cantidadTag: string } {
  if (/<(?:[\w.-]+:)?CreditNote\b/.test(xml)) {
    return { tipo: "07", lineaTag: "CreditNoteLine", cantidadTag: "CreditedQuantity" };
  }
  if (/<(?:[\w.-]+:)?DebitNote\b/.test(xml)) {
    return { tipo: "08", lineaTag: "DebitNoteLine", cantidadTag: "DebitedQuantity" };
  }
  // Factura o boleta: el código lo dice el propio documento.
  const cod = valor(xml, "InvoiceTypeCode");
  return { tipo: cod, lineaTag: "InvoiceLine", cantidadTag: "InvoicedQuantity" };
}

/** El RUC y el nombre de una de las partes (emisor o adquiriente). */
function parte(bloqueParte: string): { ruc: string | null; nombre: string | null } {
  const ident = bloque(bloqueParte, "PartyIdentification");
  const ruc = valor(ident, "ID");
  // La razón social vive en PartyLegalEntity; algunos emisores la repiten en
  // PartyName. Se toma la legal primero, que es la que SUNAT valida.
  const nombre =
    valor(bloque(bloqueParte, "PartyLegalEntity"), "RegistrationName") ??
    valor(bloque(bloqueParte, "PartyName"), "Name");
  return { ruc, nombre };
}

/** Una línea de detalle, a partir de su bloque. */
function itemDe(bloqueLinea: string, cantidadTag: string): ItemCpe {
  const linea = valor(bloqueLinea, "ID");
  return {
    linea: linea == null ? null : Number(linea) || null,
    descripcion: valor(bloque(bloqueLinea, "Item"), "Description"),
    cantidad: aMonto(valor(bloqueLinea, cantidadTag)),
    unidad: atributo(bloqueLinea, cantidadTag, "unitCode"),
    precioUnitario: aMonto(valor(bloque(bloqueLinea, "Price"), "PriceAmount")),
    importe: aMonto(valor(bloqueLinea, "LineExtensionAmount")),
  };
}

/**
 * Lee un XML de comprobante y devuelve su cabecera y sus ítems.
 *
 * No valida ni cruza: solo lee. Quién es el proveedor de verdad y si el
 * comprobante es válido lo deciden capas de arriba, con lo que este devuelve.
 */
export function leerComprobanteXml(xml: string): ComprobanteCpe {
  const { tipo, lineaTag, cantidadTag } = tipoDe(xml);

  // El ID del documento es el primer cbc:ID con forma «serie-número». Buscarlo
  // por patrón y no por posición evita confundirlo con el ID de una parte o
  // de la firma, que también son cbc:ID.
  const idDoc = valores(xml, "ID").find(v => /^[A-Za-z0-9]{1,4}-\d+$/.test(v)) ?? null;
  const { serie, numero } = partirSerieNumero(idDoc);

  const proveedor = parte(bloque(xml, "AccountingSupplierParty"));
  const adquiriente = parte(bloque(xml, "AccountingCustomerParty"));

  const totales = bloque(xml, "LegalMonetaryTotal");
  // El primer TaxTotal es el del documento; los de cada línea vienen dentro
  // de su InvoiceLine y no llegan acá porque se lee sobre el XML completo,
  // donde el de documento aparece primero.
  const igv = aMonto(valor(bloque(xml, "TaxTotal"), "TaxAmount"));

  const items = bloques(xml, lineaTag)
    .map(b => itemDe(b, cantidadTag))
    .sort((a, b) => (a.linea ?? 0) - (b.linea ?? 0));

  return {
    tipoComprobante: tipo,
    serie,
    numero,
    fechaEmision: aFechaXml(valor(xml, "IssueDate")),
    moneda: valor(xml, "DocumentCurrencyCode"),
    proveedorRuc: proveedor.ruc,
    proveedorNombre: proveedor.nombre,
    adquirienteRuc: adquiriente.ruc,
    adquirienteNombre: adquiriente.nombre,
    subtotal: aMonto(valor(totales, "LineExtensionAmount")),
    igv,
    total: aMonto(valor(totales, "PayableAmount")),
    items,
  };
}
