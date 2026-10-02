/**
 * Lo que dicen los NOMBRES en la carpeta madre de compras nacionales
 * («5. Ordenes de Compra»): qué OC es cada carpeta y qué parece cada archivo.
 *
 * La carpeta madre está ordenada así:
 *
 *   5. Ordenes de Compra /
 *     01) TALLERES ESPECIALIZADOS /                       ← proyecto
 *       OC 2026 - 0200 COMERCIALIZADORA LUCY - TALLERES ESPECIALIZADOS /
 *         Factura y Guía / 20603268467-01-F001-260.pdf
 *       OS 0911 -2026 SERVICIOS GENERALES J.VARGAS - TALLERES ESPECIALIZADOS /
 *
 * Solo se miran nombres (no se descarga nada): el nombre de la carpeta trae
 * la OC, el proveedor y el proyecto; el del archivo, casi siempre la serie y
 * el número del comprobante. Es lo mismo que hace `LegajoPorOC.gs` con las
 * carpetas del cuadro de aprobaciones —`clasificarArchivo` y `serieEnNombre`
 * son la misma regla, pasada a TypeScript—, para que las dos fuentes
 * clasifiquen igual.
 */

/** RUC de Industrias Roland Print: aparece en nombres de archivo, pero nunca es el proveedor. */
export const RUC_INROPRIN = "20512201611";

export type CarpetaDeOC = {
  /** «OC» (orden de compra) u «OS» (orden de servicio). Comparten la numeración. */
  tipo: "OC" | "OS";
  /**
   * Nacional con 4 dígitos («0200-2026»), importación con 3 («172-2026»):
   * son numeraciones distintas que se cruzan, como en el resto del sistema.
   */
  oc: string;
  proveedor: string;
  /** Lo que va después del último « - » («TALLERES ESPECIALIZADOS»); vacío si no hay. */
  proyecto: string;
};

export type Procedencia = "Nacional" | "Importación";

// «IMP», «IMPO», «IMPORTACIÓN» van delante (o detrás de «OC») en las carpetas de importaciones.
const IMPO = String.raw`(?:IMP(?:O|ORTACI[OÓ]N)?\.?)`;
// «0C 101-2026» (con cero en vez de O) aparece en las carpetas de importaciones.
const PREFIJO = String.raw`(?:(?:[O0]\.?\s*C\.?|[O0]\.?\s*S\.?|ORDEN\s+DE\s+COMPRA|ORDEN\s+DE\s+SERVICIO)(?:\s*${IMPO})?|${IMPO}(?:\s*O\.?\s*C\.?)?)`;
const NUM = String.raw`(\d{1,5})(?:\.\d{1,2})?`;
const ANIO = String.raw`(20[2-3]\d)`;
const SEP = String.raw`\s*[-_]\s*`;

/**
 * La OC del nombre de una carpeta, o null si la carpeta no es de una OC.
 *   «OC 2026 - 0200 COMERCIALIZADORA LUCY - TALLERES ESPECIALIZADOS»
 *     → { tipo: OC, oc: 0200-2026, proveedor: COMERCIALIZADORA LUCY, proyecto: TALLERES ESPECIALIZADOS }
 *   «OS 0911 -2026 SERVICIOS GENERALES J.VARGAS - TALLERES ESPECIALIZADOS» → OS 0911-2026
 *
 * `estricto` pide que el nombre EMPIECE con OC/OS: así se reconoce una OC
 * dentro de otra sin confundir una subcarpeta «Factura 0123-2026».
 */
export function carpetaDeOC(nombre: string, estricto = false, procedencia: Procedencia = "Nacional"): CarpetaDeOC | null {
  const t = String(nombre ?? "").normalize("NFC").trim().replace(/\s+/g, " ");
  // Sin «OC» delante solo vale si el nombre arranca con el número: «0200-2026 LUCY».
  const m = new RegExp(
    String.raw`^(${PREFIJO}\s*(?:N[°ºo.]?\s*)?)?(?:${ANIO}${SEP}${NUM}|${NUM}${SEP}${ANIO})(?!\d)\s*(.*)$`, "i",
  ).exec(t);
  if (!m || (estricto && !m[1])) return null;
  const [, , anioA, numA, numB, anioB, resto] = m;
  const num = numA ?? numB, anio = anioA ?? anioB;
  if (!num || !anio || Number(num) === 0) return null;
  // Sin prefijo, «2026-01 ENERO» no es la OC 1: se piden al menos 3 dígitos.
  if (!m[1] && num.length < 3) return null;

  const tipo: "OC" | "OS" = /^([O0]\.?\s*S|ORDEN\s+DE\s+SERVICIO)/i.test(t) ? "OS" : "OC";
  const limpio = (resto ?? "").replace(/^[\s\-_–—:.]+/, "").trim();
  const corte = limpio.lastIndexOf(" - ");
  const proveedor = (corte > 0 ? limpio.slice(0, corte) : limpio).trim();
  const proyecto = corte > 0 ? limpio.slice(corte + 3).trim() : "";
  const ancho = procedencia === "Importación" ? 3 : 4;
  return { tipo, oc: `${String(Number(num)).padStart(ancho, "0")}-${anio}`, proveedor, proyecto };
}

/** Los RUC (10… o 20…) que aparecen en un nombre de archivo, sin el de Inroprin. */
export function rucsEnNombre(nombre: string): string[] {
  const vistos = new Set<string>();
  for (const m of String(nombre ?? "").matchAll(/(?:^|\D)((?:10|15|17|20)\d{9})(?!\d)/g)) {
    if (m[1] !== RUC_INROPRIN) vistos.add(m[1]);
  }
  return [...vistos];
}

/**
 * F001-00018178, E001 179, FE010001380 → «F001-18178». Vacío si no trae una.
 * En «PDF-DOC-E001-37320547523939» SUNAT pega el RUC del emisor al número:
 * se le quitan esos 11 dígitos del final. (Igual que `serieEnNombre_` en LegajoPorOC.gs.)
 */
export function serieEnNombre(nombre: string): string {
  const t = String(nombre ?? "").toUpperCase().replace(/\.[A-Z0-9]{2,5}$/, "");
  // «01F0010031388»: el tipo de SUNAT (01, 03, 07, 08) pegado a serie y número.
  const pegado = /(?:^|[^A-Z0-9])0[1378]([FBE][A-Z]?\d{2,3})(\d{4,8})(?!\d)/.exec(t);
  if (pegado && pegado[1].length === 4) return pegado[1] + "-" + pegado[2].replace(/^0+(?=\d)/, "");
  const m = /(?:^|[^A-Z0-9])([FBE][A-Z0-9]{3})(\s*[-_ ]?\s*)(\d{1,19})(?!\d)/.exec(t);
  if (!m || !/\d/.test(m[1])) return "";
  if (!/[-_ ]/.test(m[2]) && !/^[FBE][A-Z]?0\d{1,2}$/.test(m[1])) return "";
  let num = m[3];
  if (num.length > 11 && /[12]\d{10}$/.test(num)) num = num.slice(0, -11);
  num = num.replace(/^0+(?=\d)/, "");
  if (num.length > 8) return "";
  return m[1] + "-" + num;
}

// ── Qué parece cada archivo (la misma lista que LegajoPorOC.gs) ──

type Categoria = { parece: string; frases: string[]; palabras: string[]; parecidas?: string[] };

// En orden: gana la primera que calce. «PAGO SWIFT» sale SWIFT y no PAGO;
// «FACTURA OC 0123» sale factura.
const CATEGORIAS: Categoria[] = [
  // El cuadro de costeo de COMEX («COSTEO FINAL OC 012-2026.xlsx»): antes que
  // la OC, que también aparece en el nombre.
  { parece: "CUADRO DE COSTEO", frases: ["CUADRO DE COSTEO", "FORMATO DE COSTEO"], palabras: ["COSTEO", "COSTEOS"], parecidas: ["COSTEO"] },
  { parece: "NOTA DE CRÉDITO", frases: ["NOTA DE CREDITO", "NOTA CREDITO"], palabras: ["NC"] },
  { parece: "NOTA DE DÉBITO", frases: ["NOTA DE DEBITO", "NOTA DEBITO"], palabras: ["ND"] },
  // Antes que FACTURA: una «proforma invoice» o «factura proforma» no es la factura.
  { parece: "PROFORMA", frases: ["PROFORMA INVOICE", "PERFORMA INVOICE", "PRO FORMA"], palabras: ["PROFORMA", "PROFORMAS", "PERFORMA"], parecidas: ["PROFORMA"] },
  { parece: "FACTURA", frases: ["FACTURA ELECTRONICA", "COMMERCIAL INVOICE"], palabras: ["FACTURA", "FACTURAS", "FACT", "FAC", "FACTU", "FACTS", "FE", "INVOICE", "INVOICES", "INV"], parecidas: ["FACTURA", "FACTURAS", "FACTURACION", "INVOICE"] },
  // «FT_…» resultó ser ficha técnica, no factura (así las nombran los proveedores).
  { parece: "FICHA TÉCNICA", frases: ["FICHA TECNICA", "FICHAS TECNICAS"], palabras: ["FT", "FTS"] },
  { parece: "BOLETA", frases: [], palabras: ["BOLETA", "BOLETAS", "BV"], parecidas: ["BOLETA"] },
  { parece: "RECIBO POR HONORARIOS", frases: ["RECIBO POR HONORARIOS", "RECIBO HONORARIOS", "R X H"], palabras: ["RH", "RHE", "RXH", "HONORARIOS"], parecidas: ["HONORARIOS"] },
  { parece: "COMPROBANTE (revisar)", frases: [], palabras: ["COMPROBANTE", "COMPROBANTES", "CPE"], parecidas: ["COMPROBANTE"] },
  { parece: "DETRACCIÓN", frases: [], palabras: ["DETRACCION", "DETRACCIONES", "SPOT"], parecidas: ["DETRACCION"] },
  { parece: "SWIFT", frases: ["TT COPY", "BANK SLIP", "PAYMENT SLIP", "TRANSFERENCIA INTERNACIONAL", "MT 103"], palabras: ["SWIFT", "MT103", "TT"], parecidas: ["SWIFT"] },
  { parece: "DAM", frases: ["DECLARACION ADUANERA", "DECLARACION ADUANERA DE MERCANCIAS"], palabras: ["DAM", "DAMS", "DUA", "LEVANTE"] },
  { parece: "PAGO", frases: [], palabras: ["PAGO", "PAGOS", "VOUCHER", "TRANSFERENCIA", "CONSTANCIA", "DEPOSITO", "ABONO", "ADELANTO"], parecidas: ["TRANSFERENCIA"] },
  { parece: "GUÍA", frases: ["GUIA DE REMISION", "GUIA REMISION"], palabras: ["GUIA", "GUIAS", "GR", "GRE", "REMISION"], parecidas: ["REMISION"] },
  { parece: "ACTA DE CONFORMIDAD", frases: ["ACTA DE CONFORMIDAD", "ACTA CONFORMIDAD", "CONFORMIDAD DE SERVICIO", "ACTA DE RECEPCION"], palabras: ["ACTA", "ACTAS", "CONFORMIDAD"], parecidas: ["CONFORMIDAD"] },
  { parece: "DOCUMENTO DE IMPORTACIÓN", frases: ["BILL OF LADING", "PACKING LIST", "AGENTE DE ADUANA"], palabras: ["BL", "AWB", "PACKING", "DESADUANAJE", "ADUANA", "ADUANAS"] },
  { parece: "CONTRATO", frases: [], palabras: ["CONTRATO", "CONTRATOS"], parecidas: ["CONTRATO"] },
  { parece: "COTIZACIÓN", frases: [], palabras: ["COTIZACION", "COTIZACIONES", "COT", "QUOTATION", "QUOTE"], parecidas: ["COTIZACION"] },
  { parece: "ORDEN DE COMPRA/SERVICIO", frases: ["ORDEN DE COMPRA", "ORDEN DE SERVICIO", "PURCHASE ORDER"], palabras: ["OC", "OS", "PO"] },
  { parece: "REQUERIMIENTO", frases: [], palabras: ["REQUERIMIENTO", "REQ", "RQ"], parecidas: ["REQUERIMIENTO"] },
  { parece: "CORREO / CAPTURA", frases: ["CAPTURA DE PANTALLA", "SCREEN SHOT"], palabras: ["CORREO", "CORREOS", "EMAIL", "MAIL", "GMAIL", "OUTLOOK", "CAPTURA", "PANTALLAZO", "SCREENSHOT", "WHATSAPP"], parecidas: ["CORREO"] },
  { parece: "DATOS BANCARIOS", frases: ["CUENTA BANCARIA", "CUENTAS BANCARIAS"], palabras: ["CCI"] },
];

const TIPO_SUNAT: Record<string, string> = {
  "01": "FACTURA", "03": "BOLETA", "07": "NOTA DE CRÉDITO", "08": "NOTA DE DÉBITO",
  "09": "GUÍA", "R01": "RECIBO POR HONORARIOS",
};

const NO_SON = ["FACTOR", "FACTORES", "FACIL", "FACHADA", "BOLETIN", "REMISOR", "CONTRATISTA", "CORRER"];

/** Sin tildes, en mayúsculas, solo letras y números, y «F001» separado en «F 001». */
export function textoPlano(s: string): string {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/\.[A-Z0-9]{2,5}$/, "").replace(/[^A-Z0-9]+/g, " ")
    .replace(/([A-Z])(\d)/g, "$1 $2").replace(/(\d)([A-Z])/g, "$1 $2").trim();
}

function distancia(a: string, b: string): number {
  const d: number[][] = [];
  for (let i = 0; i <= a.length; i++) d[i] = [i];
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** Error de tipeo tolerado: 1 letra en palabras de 5 o más, 2 si además empieza igual. */
function seParece(p: string, q: string): boolean {
  if (p.length < 5 || NO_SON.includes(p)) return false;
  const d = distancia(p, q);
  return d <= 1 || (d <= 2 && p.length >= 6 && p.slice(0, 3) === q.slice(0, 3));
}

type Pista = { parece: string; palabra: string };

function pistasEn(texto: string): Pista[] {
  const palabras = texto.split(" ").filter(Boolean);
  const salida: Pista[] = [];
  for (const cat of CATEGORIAS) {
    let hallada = cat.frases.find(fr => (" " + texto + " ").includes(" " + fr + " ")) ?? "";
    for (const p of palabras) {
      if (hallada) break;
      if (cat.palabras.includes(p)) hallada = p;
      else if ((cat.parecidas ?? []).some(q => seParece(p, q))) hallada = `${p} (≈${cat.parecidas![0]})`;
    }
    if (hallada) salida.push({ parece: cat.parece, palabra: hallada });
  }
  return salida;
}

export type Clasificacion = { parece: string; serie: string; pistas: string[] };

/**
 * Qué parece un archivo por su nombre y, si el nombre no dice nada, por la
 * subcarpeta donde está («Guías / scan001.pdf» cuenta como guía).
 * `ubicacion` son solo las subcarpetas DEBAJO de la de la OC: el nombre de la
 * carpeta de la OC («OC 2026 - 0200 …») diría «orden de compra» de todo.
 */
export function clasificarArchivo(nombre: string, ubicacion = "", mime = ""): Clasificacion {
  const n = textoPlano(nombre);
  const ext = (/\.([a-z0-9]{2,5})$/i.exec(nombre ?? "")?.[1] ?? "").toUpperCase();
  const serie = serieEnNombre(nombre);
  let pistas = pistasEn(n);

  let parece = "";
  // Solo el XML de verdad: el tipo interno de un Excel también contiene «xml».
  const esXml = ext === "XML" || mime === "text/xml" || mime === "application/xml";
  if (esXml) parece = /^R-/i.test(nombre) ? "CDR (constancia SUNAT)" : "XML";
  else if (ext === "ZIP" && /^R-/i.test(nombre)) parece = "CDR (constancia SUNAT)";
  if (!parece && (ext === "EML" || ext === "MSG")) parece = "CORREO / CAPTURA";
  // Número de DAM: aduana-año-régimen-número (118-2025-10-123456).
  if (!parece && /(^|\D)\d{3}[- _]20\d\d[- _]10[- _]\d{4,6}(\D|$)/.test(String(nombre))) {
    parece = "DAM";
    pistas.unshift({ parece: "DAM", palabra: "número de DAM" });
  }
  // Nombre como lo baja SUNAT, RUC-TIPO-SERIE-NÚMERO: el tipo lo dice todo.
  const codigo = /(?:^|\D)[12]\d{10}[-_ ](01|03|07|08|09|R01)[-_ ]/.exec(String(nombre).toUpperCase())?.[1];
  const sunat = codigo ? TIPO_SUNAT[codigo] : "";
  if (!parece && sunat) { parece = sunat; pistas.unshift({ parece: sunat, palabra: "tipo SUNAT en el nombre" }); }
  if (!parece && pistas.length) parece = pistas[0].parece;
  // «FT F001-123» o «PROFORMA F001-123» con serie de SUNAT sí son factura.
  if ((parece === "FICHA TÉCNICA" && serie && !/^EG/.test(serie)) ||
    (parece === "PROFORMA" && /^F/.test(serie))) parece = "FACTURA";
  if (!parece && serie) {
    parece = /^F/.test(serie) ? "FACTURA" : /^B/.test(serie) ? "BOLETA" : "FACTURA o RH (serie E)";
    pistas.push({ parece, palabra: serie });
  }
  if (!parece) {
    const enCarpeta = pistasEn(textoPlano(ubicacion));
    if (enCarpeta.length) {
      parece = enCarpeta[0].parece + " (por la carpeta)";
      pistas = pistas.concat(enCarpeta);
    }
  }
  return {
    parece: parece || "OTRO",
    pistas: [...new Set(pistas.map(p => p.palabra))],
    serie,
  };
}

/** Si lo que parece el archivo es un comprobante de pago (lo que se busca para cruzar con SUNAT). */
export function esComprobante(parece: string): boolean {
  return /^(FACTURA|BOLETA|NOTA DE|RECIBO POR|COMPROBANTE|XML)/.test(parece);
}
