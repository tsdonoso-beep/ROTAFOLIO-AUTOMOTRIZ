/**
 * Lo que dice POR DENTRO un archivo de la carpeta de una OC, cuando el
 * nombre no alcanza («scan001.pdf», «WhatsApp Image…», «FACTURA LUCY.pdf»
 * sin número, una «INVOICE» en inglés).
 *
 * Son funciones puras sobre el texto ya extraído; sacar el texto (XML, PDF
 * con texto, OCR de un escaneo) lo hace `scripts/carpetas-oc.mts`. La regla
 * es la de `LegajoPorOC.gs` (`documentosEnTexto_`, `comprobanteEnTexto_`),
 * pasada a TypeScript para que el legajo y la carpeta madre lean igual, más
 * dos cosas que el legajo no tenía:
 *   · el RUC de quien emitió, validado con su dígito verificador (un RUC que
 *     el OCR leyó mal casi nunca pasa la verificación);
 *   · el XML del comprobante (o el ZIP que lo trae), que dice todo exacto.
 */

import { RUC_INROPRIN, esComprobante, textoPlano } from "./carpetas-oc.ts";
import { leerComprobanteXml, documentoPrincipal } from "../sunat/cpe-xml.ts";

export type Lectura = {
  /**
   * LEÍDO: se encontró un comprobante con su serie-número.
   * SIN COMPROBANTE: se leyó, pero no es (o no se reconoce) un comprobante.
   * SIN TEXTO: no salió texto (imagen en blanco, PDF protegido…).
   * ERROR: no se pudo bajar o leer.
   */
  estado: "LEÍDO" | "SIN COMPROBANTE" | "SIN TEXTO" | "ERROR";
  metodo: "XML" | "ZIP" | "TEXTO DEL PDF" | "OCR" | "DOCUMENTO DE GOOGLE" | "";
  /** FACTURA, BOLETA, NOTA DE CRÉDITO, NOTA DE DÉBITO, RECIBO POR HONORARIOS o INVOICE. */
  tipo: string;
  /** «F001-260» (sin ceros a la izquierda en el número); la de una INVOICE, como venga. */
  serie: string;
  /** RUC de quien emitió (no el de Inroprin), validado. Vacío si no se encontró. */
  ruc: string;
  /** Qué documentos trae el archivo: FACTURA, GUIA, DAM, ACTA, SWIFT, OC (un PDF puede traer varios). */
  claves: string[];
  /** La OC que cita el comprobante (el XML la trae en OrderReference). */
  ocReferencia: string;
  detalle: string;
};

// ── RUC ──

const PESOS_RUC = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

/** El dígito verificador de SUNAT (módulo 11): descarta los RUC que el OCR leyó mal. */
export function rucValido(ruc: string): boolean {
  if (!/^(10|15|16|17|20)\d{9}$/.test(ruc)) return false;
  const suma = PESOS_RUC.reduce((s, p, i) => s + p * Number(ruc[i]), 0);
  const resto = 11 - (suma % 11);
  const digito = resto === 10 ? 0 : resto === 11 ? 1 : resto;
  return digito === Number(ruc[10]);
}

/**
 * El RUC de quien emitió: el primero válido que no sea el de Inroprin. En
 * una factura el del emisor va arriba y el del cliente (Inroprin) después.
 * `P` es el texto en mayúsculas y sin tildes.
 */
export function rucEmisorEnTexto(P: string): string {
  // El OCR confunde O con 0 y I/l con 1 dentro de los números.
  const t = P.replace(/(?<=\d)[O](?=[\dO])|(?<=[\dO])[O](?=\d)/g, "0").replace(/(?<=\d)[IL](?=\d)/g, "1");
  for (const m of t.matchAll(/(?:^|\D)((?:10|15|16|17|20)\d{9})(?!\d)/g)) {
    if (m[1] !== RUC_INROPRIN && rucValido(m[1])) return m[1];
  }
  return "";
}

// ── El comprobante en el texto ──

// «FACTURA» aunque el OCR la parta o confunda letras: «FACTUR A», «FAC TURA», «FACIURA», «FACTUPA».
const RE_FACTURA = /F\s?A\s?[CG]\s?[TI1]\s?U\s?[RP]\s?A/;

/** Mayúsculas, sin tildes, espacios simples: como lo espera la regla. */
export function normalizarTexto(texto: string): string {
  return String(texto ?? "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}

/**
 * El comprobante que trae un texto (ya normalizado): tipo y serie-número.
 * Reconoce las electrónicas (F001-00113668, con los errores típicos del OCR:
 * FO01, F0O1, «F001 - 113668», «F001 N° 113668»), las físicas (FACTURA 001-
 * N° 0031388) y la «commercial invoice» del exterior. Las series de guía
 * (T001, EG07) se saltan: un comprobante suele citarlas.
 */
export function comprobanteEnTexto(P: string): { tipo: string; serie: string } {
  const esFactura = RE_FACTURA.test(P), esBoleta = /BOLETA\s+DE\s+VENTA/.test(P);
  const esRH = /RECIBO\s+POR\s+HONORARIOS/.test(P);
  const esNota = /NOTA\s+DE\s+(CREDITO|DEBITO)\s+ELECTRONICA/.test(P);
  // Serie electrónica: letra + 3, con guion o «N°» antes del número. El OCR
  // confunde 0 con O y 1 con I, L, |, ], [ o ! («BOO] - 0007781» es B001-7781).
  const re = /(?:^|[^A-Z0-9])([FBE][A-Z0-9|\][!]{3})\s*(?:[-–—_]\s*(?:N\s*[°ºO.]\s*)?|N\s*[°º.]\s*)0*(\d{1,8})(?!\d)/g;
  let serie = "";
  for (const m of P.matchAll(re)) {
    const s = m[1][0] + m[1].slice(1).replace(/O/g, "0").replace(/[IL|\][!]/g, "1");
    if (!/^[FBE][A-Z]?\d{2,3}$/.test(s) || /^EG/.test(s)) continue;
    serie = `${s}-${m[2]}`;
    break;
  }
  // Factura física: «FACTURA … 001 - N° 0031388».
  if (!serie && (esFactura || esBoleta)) {
    const f = /(?:FACTURA|BOLETA)[^]{0,80}?(?:^|[^A-Z0-9])(\d{3,4})\s*[-–—]\s*(?:N\s*[°ºO.]\s*)?0*(\d{3,8})(?!\d)/.exec(P);
    if (f && !/^20\d\d$/.test(f[1])) serie = `${f[1]}-${f[2]}`;
  }
  let tipo = "";
  if (esNota) tipo = /NOTA\s+DE\s+CREDITO/.test(P) ? "NOTA DE CRÉDITO" : "NOTA DE DÉBITO";
  else if (esRH && /^E/.test(serie)) tipo = "RECIBO POR HONORARIOS";
  else if (esFactura && (/F\s?A\s?C\s?T\s?U\s?R\s?A\s+E\s?L\s?E\s?C\s?T\s?R\s?O\s?N\s?I\s?C\s?A/.test(P) ||
    (serie && /R\s?\.?\s?U\s?\.?\s?C/.test(P)))) tipo = "FACTURA";
  else if (esBoleta && /^B/.test(serie)) tipo = "BOLETA";
  else if (/COMMERCIAL\s+INVOICE|\bINVOICE\s*(NO\b|N[°º]|#|NUMBER|DATE)/.test(P)) {
    tipo = "INVOICE";
    const inv = /INVOICE\s*(?:NO\.?|N[°º]|#|NUMBER)\s*[:.]?\s*([A-Z0-9][A-Z0-9/-]{2,20})/.exec(P);
    serie = inv ? inv[1] : "";
  }
  return { tipo, serie: tipo ? serie : "" };
}

/**
 * Qué documentos trae un texto leído, el comprobante y su emisor. Se pide el
 * rasgo propio de cada documento, no solo la palabra: una factura CITA su
 * guía, pero solo la guía trae punto de partida y de llegada; y una OC dice
 * «factura a 30 días» sin ser una factura.
 */
export function documentosEnTexto(texto: string): Omit<Lectura, "estado" | "metodo" | "detalle"> {
  const P = normalizarTexto(texto);
  const hay: string[] = [];
  const cpe = comprobanteEnTexto(P);
  if (cpe.tipo) hay.push("FACTURA");
  if (/PUNTO\s+DE\s+PARTIDA|PUNTO\s+DE\s+LLEGADA|MOTIVO\s+DEL?\s+TRASLADO|DATOS\s+DEL\s+TRASLADO/.test(P)) hay.push("GUIA");
  if (/DECLARACION\s+ADUANERA\s+DE\s+MERCANCIAS|\bDAM\b[^A-Z]{0,20}\d{3}\s*-\s*20\d\d\s*-\s*10\s*-\s*\d{3,6}/.test(P)) hay.push("DAM");
  if (/ACTA\s+DE\s+(CONFORMIDAD|RECEPCION)|CONFORMIDAD\s+DEL?\s+SERVICIO/.test(P)) hay.push("ACTA");
  if (/\bMT\s?103\b|SWIFT\s+(COPY|MESSAGE)|:32A:/.test(P)) hay.push("SWIFT");
  if (!hay.length && /^.{0,300}ORDEN\s+DE\s+(COMPRA|SERVICIO)/.test(P)) hay.push("OC");
  // El RUC solo importa si hay un comprobante peruano.
  const ruc = cpe.tipo && cpe.tipo !== "INVOICE" ? rucEmisorEnTexto(P) : "";
  return { tipo: cpe.tipo, serie: cpe.serie, ruc, claves: hay, ocReferencia: "" };
}

/** El resultado de leer un texto: LEÍDO si trae un comprobante con su número. */
export function lecturaDeTexto(texto: string, metodo: Lectura["metodo"]): Lectura {
  if (normalizarTexto(texto).replace(/[^A-Z0-9]/g, "").length < 20) {
    return { estado: "SIN TEXTO", metodo, tipo: "", serie: "", ruc: "", claves: [], ocReferencia: "", detalle: "" };
  }
  const d = documentosEnTexto(texto);
  return { ...d, estado: d.tipo && d.serie ? "LEÍDO" : "SIN COMPROBANTE", metodo, detalle: "" };
}

const TIPO_XML: Record<string, string> = {
  "01": "FACTURA", "03": "BOLETA", "07": "NOTA DE CRÉDITO", "08": "NOTA DE DÉBITO",
};

/**
 * Un XML de comprobante electrónico: todo exacto (tipo, serie, número, RUC y
 * hasta la OC que cita). Una constancia de SUNAT (CDR) no es el comprobante.
 */
export function lecturaDeXml(xmls: string[], metodo: "XML" | "ZIP"): Lectura {
  const vacia: Lectura = { estado: "SIN COMPROBANTE", metodo, tipo: "", serie: "", ruc: "", claves: [], ocReferencia: "", detalle: "" };
  const principal = documentoPrincipal(xmls);
  if (!principal || /<\s*(?:[\w-]+:)?ApplicationResponse[\s>]/.test(principal.slice(0, 4000))) {
    return { ...vacia, detalle: "constancia de SUNAT (CDR), no el comprobante" };
  }
  try {
    const c = leerComprobanteXml(principal);
    const tipo = TIPO_XML[c.tipoComprobante ?? ""] ?? "";
    if (!tipo || !c.serie || !c.numero) return { ...vacia, detalle: "el XML no trae tipo, serie o número" };
    return {
      estado: "LEÍDO", metodo, tipo,
      serie: `${c.serie.toUpperCase()}-${c.numero.replace(/^0+(?=\d)/, "")}`,
      ruc: c.proveedorRuc ?? "", claves: ["FACTURA"], ocReferencia: c.ordenCompra ?? "",
      detalle: c.adquirienteRuc && c.adquirienteRuc !== RUC_INROPRIN ? `emitido a ${c.adquirienteRuc}, no a Inroprin` : "",
    };
  } catch (e) {
    return { ...vacia, estado: "ERROR", detalle: `XML ilegible: ${e instanceof Error ? e.message : e}`.slice(0, 150) };
  }
}

// ── Qué vale la pena abrir ──

export type TipoDeLectura = "XML" | "ZIP" | "PDF" | "IMAGEN" | "DOCUMENTO DE GOOGLE";

/** Cómo se lee un archivo por su tipo, o null si no se lee (Excel, Word, video…). */
export function tipoDeLectura(nombre: string, mime: string): TipoDeLectura | null {
  const ext = (/\.([a-z0-9]{2,5})$/i.exec(nombre ?? "")?.[1] ?? "").toLowerCase();
  if (mime === "application/vnd.google-apps.document") return "DOCUMENTO DE GOOGLE";
  if (ext === "xml" || mime === "text/xml" || mime === "application/xml") return "XML";
  if (ext === "zip" || mime === "application/zip" || mime === "application/x-zip-compressed") return "ZIP";
  if (ext === "pdf" || mime === "application/pdf") return "PDF";
  if (/^image\/(jpeg|png|tiff|bmp|webp|gif)$/.test(mime) || /^(jpe?g|png|tiff?|bmp|webp)$/.test(ext)) return "IMAGEN";
  return null;
}

// Palabras de nombres que no dicen nada: «docs», «scan», «CamScanner»…
const NOMBRES_GENERICOS = new Set(["DOC", "DOCS", "DOSC", "DCOS", "DOCUMENTO", "DOCUMENTOS", "SCAN", "ESCANEO", "ESCANEADO",
  "CAMSCANNER", "IMG", "IMAGEN", "ADJUNTO", "ADJUNTOS", "WHATSAPP", "SUSTENTO", "SUSTENTOS", "ARCHIVO", "NUEVO",
  "SCANNED", "SCANNER", "FOTO", "PHOTO", "IMAGE", "DOCUMENT", "FILE", "COPIA", "COPY"]);

/**
 * Cuánto vale la pena abrir un archivo (más alto, antes); -1 si no se abre.
 *   4  XML o ZIP sin serie en el nombre: barato y exacto.
 *   3  El nombre dice que es un comprobante («FACTURA LUCY.pdf», «INVOICE»)
 *      pero no trae el número.
 *   2  El nombre no dice nada («scan001», «WhatsApp Image…», «OTRO»), o lo
 *      que dice lo dice la carpeta.
 *   1  Solo dice «OC» o el número de la OC: un escaneo de la factura suele
 *      llamarse «docs proveedor oc150-2026».
 * Lo que el nombre ya dice claro (cotización, guía, pago, ficha…) o ya trae
 * la serie no se abre.
 */
export function prioridadDeLectura(a: { nombre: string; mime: string; parece: string; serie: string; kb: number; pistas?: string[] }): number {
  const como = tipoDeLectura(a.nombre, a.mime);
  if (!como || a.serie || a.kb > 25 * 1024) return -1;
  if (/^CDR/.test(a.parece)) return -1;
  if (como === "XML" || como === "ZIP") return 4;
  if (esComprobante(a.parece)) return 3;
  const generico = textoPlano(a.nombre).split(" ").some(p => NOMBRES_GENERICOS.has(p));
  if (a.parece === "OTRO" || / \(por la carpeta\)$/.test(a.parece) || generico) return 2;
  const pistas = (a.pistas ?? []).join(" ");
  if (a.parece === "ORDEN DE COMPRA/SERVICIO" && !/ORDEN DE|PURCHASE ORDER/.test(pistas)) return 1;
  return -1;
}
