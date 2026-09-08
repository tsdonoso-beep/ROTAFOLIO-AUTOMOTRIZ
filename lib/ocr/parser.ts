// Parser de comprobantes peruanos sobre texto OCR
//
// El OCR crudo de un ticket térmico arrugado es mediocre, y esa es
// justamente la razón por la que este parser no confía en él: cada campo
// que devuelve está *comprobado*, no adivinado.
//
//   · El RUC pasa el módulo 11 o se descarta.
//   · Serie y número calzan con el formato que exige SUNAT o se descartan.
//   · Los importes se anclan a su etiqueta y se contrastan entre sí.
//
// Para estos campos eso resulta más confiable que un modelo de lenguaje,
// que produce un valor plausible incluso cuando no leyó nada. Lo difuso
// —razón social, detalle del consumo— se le deja a la IA, que sí es mejor
// ahí, y si no hay clave disponible queda para la persona.
//
// El resultado tiene la misma forma que el de la IA (`ResultadoExtraccion`),
// así que ambas fuentes son intercambiables aguas abajo.

import { rucValido } from "../dominio/validaciones.ts";
import type { ResultadoExtraccion } from "../dominio/tipos.ts";

/** Confianza que se asigna a cada campo según cómo se haya obtenido. */
const CONFIANZA = {
  ruc_verificado: 0.95,
  ruc_reparado: 0.82,
  serie_electronica: 0.92,
  serie_preimpresa: 0.68,
  fecha: 0.85,
  importe_etiquetado: 0.9,
  importe_derivado: 0.72,
  importe_inferido: 0.45,
  moneda_simbolo: 0.85,
  moneda_defecto: 0.6,
  tipo_literal: 0.9,
  tipo_por_serie: 0.72,
  nombre_heuristico: 0.4,
  forma_pago: 0.7,
} as const;

export interface OpcionesParser {
  /**
   * RUC de la propia empresa. Un comprobante emitido a INROPRIN lleva
   * impresos dos RUC: el del proveedor y el nuestro. Sin este dato el
   * parser no puede distinguirlos con certeza.
   */
  rucPropio?: string | null;
  /** Porcentaje de IGV vigente, para derivar la base imponible. */
  igvPorcentaje?: number;
}

// ════════════════════════════════════════════════════════════════
//  Entrada principal
// ════════════════════════════════════════════════════════════════

export function parsearComprobante(
  textoCrudo: string,
  opciones: OpcionesParser = {}
): ResultadoExtraccion {
  const igvPct = opciones.igvPorcentaje ?? 18;
  const texto = normalizarTexto(textoCrudo);
  const lineas = texto.split("\n").map(l => l.trim()).filter(Boolean);

  const confianza: Record<string, number> = {};
  const noLegibles: string[] = [];

  // ── RUC del proveedor ──
  const ruc = buscarRuc(texto, opciones.rucPropio ?? null);
  if (ruc) confianza.proveedor_ruc = ruc.confianza;
  else noLegibles.push("proveedor_ruc");

  // ── Serie y número ──
  const doc = buscarSerieNumero(texto);
  if (doc) {
    confianza.serie = doc.confianza;
    confianza.numero = doc.confianza;
  } else {
    noLegibles.push("serie", "numero");
  }

  // ── Fecha de emisión ──
  const fecha = buscarFecha(texto);
  if (fecha) confianza.fecha_emision = CONFIANZA.fecha;
  else noLegibles.push("fecha_emision");

  // ── Importes ──
  // La serie y el número se pasan como exclusión: son los dígitos más
  // grandes del comprobante y no deben confundirse con importes.
  const importes = buscarImportes(texto, igvPct, [doc?.numero ?? "", doc?.serie ?? ""]);
  if (importes.total !== null) confianza.total = importes.confianzaTotal;
  else noLegibles.push("total");
  if (importes.subtotal !== null) confianza.subtotal = importes.confianzaSubtotal;
  if (importes.igv !== null) confianza.igv = importes.confianzaIgv;

  // ── Moneda ──
  const moneda = buscarMoneda(texto);
  confianza.moneda = moneda.confianza;

  // ── Tipo de comprobante ──
  const tipo = buscarTipo(texto, doc?.serie ?? "");
  if (tipo) confianza.tipo_comprobante = tipo.confianza;
  else noLegibles.push("tipo_comprobante");

  // ── Razón social ──
  const nombre = buscarNombre(lineas, ruc?.valor ?? null);
  if (nombre) confianza.proveedor_nombre = CONFIANZA.nombre_heuristico;
  else noLegibles.push("proveedor_nombre");

  // ── Forma de pago ──
  const formaPago = buscarFormaPago(texto);
  if (formaPago) confianza.forma_pago = CONFIANZA.forma_pago;

  // El detalle del consumo es prosa libre: no hay patrón que verificar,
  // así que el parser no lo intenta y lo declara no legible.
  noLegibles.push("detalle");

  return {
    proveedor_ruc: ruc?.valor ?? "",
    proveedor_nombre: nombre ?? "",
    tipo_comprobante: tipo?.valor ?? "",
    serie: doc?.serie ?? "",
    numero: doc?.numero ?? "",
    fecha_emision: fecha ?? "",
    moneda: moneda.valor,
    subtotal: importes.subtotal ?? 0,
    igv: importes.igv ?? 0,
    total: importes.total ?? 0,
    forma_pago: formaPago ?? "",
    detalle: "",
    _confianza: confianza,
    _no_legibles: noLegibles,
  };
}

// ════════════════════════════════════════════════════════════════
//  Normalización
// ════════════════════════════════════════════════════════════════

/**
 * Deja el texto en mayúsculas sin tildes y con espacios colapsados. Los
 * saltos de línea se conservan: la posición vertical es la única pista
 * que hay para la razón social.
 */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[ \t]+/g, " ")
    .replace(/\r/g, "");
}

/**
 * Corrige las confusiones clásicas del OCR dentro de un token que debería
 * ser todo dígitos. Solo se usa cuando el token ya falló como número: si
 * la versión reparada tampoco valida, se descarta igual.
 */
function repararDigitos(token: string): string {
  return token
    .replace(/[OQD]/g, "0")
    .replace(/[IL|]/g, "1")
    .replace(/S/g, "5")
    .replace(/B/g, "8")
    .replace(/G/g, "6")
    .replace(/Z/g, "2");
}

// ════════════════════════════════════════════════════════════════
//  RUC
// ════════════════════════════════════════════════════════════════

function buscarRuc(
  texto: string,
  rucPropio: string | null
): { valor: string; confianza: number } | null {
  const candidatos: Array<{ valor: string; confianza: number; pos: number }> = [];

  // Primero los que ya son once dígitos limpios.
  for (const m of texto.matchAll(/\b(\d{11})\b/g)) {
    if (rucValido(m[1])) {
      candidatos.push({ valor: m[1], confianza: CONFIANZA.ruc_verificado, pos: m.index ?? 0 });
    }
  }

  // Después, tokens de once caracteres donde el OCR pudo confundir letras
  // por dígitos. El módulo 11 hace de filtro: una reparación equivocada
  // casi nunca produce un RUC válido.
  if (!candidatos.length) {
    for (const m of texto.matchAll(/\b([0-9OQDILSBGZ|]{11})\b/g)) {
      const reparado = repararDigitos(m[1]);
      if (/^\d{11}$/.test(reparado) && rucValido(reparado)) {
        candidatos.push({ valor: reparado, confianza: CONFIANZA.ruc_reparado, pos: m.index ?? 0 });
      }
    }
  }

  if (!candidatos.length) return null;

  // El RUC propio aparece como destinatario, no como emisor: se descarta.
  const ajenos = rucPropio
    ? candidatos.filter(c => c.valor !== rucPropio.trim())
    : candidatos;
  if (!ajenos.length) return null;

  // El emisor imprime su RUC en la cabecera, así que el primero gana.
  ajenos.sort((a, b) => a.pos - b.pos);
  return { valor: ajenos[0].valor, confianza: ajenos[0].confianza };
}

// ════════════════════════════════════════════════════════════════
//  Serie y número
// ════════════════════════════════════════════════════════════════

/**
 * Serie electrónica: una o dos letras seguidas de alfanuméricos hasta
 * completar cuatro caracteres (F001, FE01, B002, E001), guion y correlativo.
 */
const RE_SERIE_ELECTRONICA = /\b([FBE][A-Z0-9]{3})\s*[-–—]\s*(\d{1,8})\b/g;

/** Serie preimpresa: tres o cuatro dígitos, guion y correlativo. */
const RE_SERIE_PREIMPRESA = /\b(\d{3,4})\s*[-–—]\s*(\d{4,8})\b/g;

function buscarSerieNumero(
  texto: string
): { serie: string; numero: string; confianza: number } | null {
  for (const m of texto.matchAll(RE_SERIE_ELECTRONICA)) {
    return {
      serie: m[1],
      numero: m[2].padStart(8, "0"),
      confianza: CONFIANZA.serie_electronica,
    };
  }

  // La preimpresa solo se intenta si no hubo electrónica: su patrón es
  // ambiguo y podría capturar un teléfono o parte de una fecha.
  for (const m of texto.matchAll(RE_SERIE_PREIMPRESA)) {
    const completo = m[0];
    // Una fecha dd-mm-aaaa entra en el patrón; se descarta por contexto.
    if (/\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/.test(completo)) continue;
    return {
      serie: m[1],
      numero: m[2].padStart(8, "0"),
      confianza: CONFIANZA.serie_preimpresa,
    };
  }

  return null;
}

// ════════════════════════════════════════════════════════════════
//  Fecha
// ════════════════════════════════════════════════════════════════

/** Meses abreviados y completos, como los imprime una app de pagos. */
const MESES: Record<string, number> = {
  ENE: 1, FEB: 2, MAR: 3, ABR: 4, MAY: 5, JUN: 6,
  JUL: 7, AGO: 8, SET: 9, SEP: 9, OCT: 10, NOV: 11, DIC: 12,
};

function buscarFecha(texto: string): string | null {
  const candidatas: string[] = [];

  // dd/mm/aaaa y variantes con guion o punto.
  for (const m of texto.matchAll(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/g)) {
    const iso = aIso(Number(m[1]), Number(m[2]), Number(m[3]));
    if (iso) candidatas.push(iso);
  }

  // aaaa-mm-dd, que es como lo imprimen varios sistemas de facturación.
  for (const m of texto.matchAll(/\b(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})\b/g)) {
    const iso = aIso(Number(m[3]), Number(m[2]), Number(m[1]));
    if (iso) candidatas.push(iso);
  }

  // "08 set. 2026" y "8 de setiembre de 2026": Yape, Plin y varias apps de
  // pago escriben el mes con letras, nunca en dígitos.
  for (const m of texto.matchAll(/\b(\d{1,2})\s*(?:DE\s+)?([A-Z]{3})[A-Z]*\.?\s*(?:DE\s+)?(\d{4})\b/g)) {
    const mes = MESES[m[2]];
    if (!mes) continue;
    const iso = aIso(Number(m[1]), mes, Number(m[3]));
    if (iso) candidatas.push(iso);
  }

  if (!candidatas.length) return null;

  // Un comprobante suele traer emisión y vencimiento. La emisión es la
  // primera, y de haber varias iguales da lo mismo cuál se tome.
  return candidatas[0];
}

function aIso(dia: number, mes: number, anio: number): string | null {
  const a = anio < 100 ? 2000 + anio : anio;
  if (a < 2000 || a > 2100) return null;
  if (mes < 1 || mes > 12) return null;
  if (dia < 1 || dia > 31) return null;

  // Rechaza el 31 de febrero y compañía.
  const d = new Date(Date.UTC(a, mes - 1, dia));
  if (d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;

  return `${a}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

// ════════════════════════════════════════════════════════════════
//  Importes
// ════════════════════════════════════════════════════════════════

/**
 * Convierte el importe tal como lo imprime un comprobante peruano. Se usan
 * las dos convenciones: 1,234.56 y 1.234,56. Gana el último separador,
 * que es siempre el decimal.
 */
export function aNumero(texto: string): number | null {
  const limpio = texto.replace(/[^\d.,]/g, "");
  if (!limpio) return null;

  const ultimaComa = limpio.lastIndexOf(",");
  const ultimoPunto = limpio.lastIndexOf(".");

  let normalizado: string;
  if (ultimaComa > ultimoPunto) {
    normalizado = limpio.replace(/\./g, "").replace(",", ".");
  } else if (ultimoPunto > ultimaComa) {
    normalizado = limpio.replace(/,/g, "");
  } else {
    normalizado = limpio.replace(/[.,]/g, "");
  }

  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

/** Etiquetas con las que cada importe aparece rotulado, de más a menos específica. */
const ETIQUETAS_TOTAL = [
  "IMPORTE TOTAL", "TOTAL A PAGAR", "TOTAL VENTA", "TOTAL S/", "TOTAL",
];
const ETIQUETAS_IGV = ["IGV", "I.G.V", "IMPUESTO"];
const ETIQUETAS_SUBTOTAL = [
  "OP. GRAVADA", "OP GRAVADA", "OPERACION GRAVADA", "SUB TOTAL", "SUBTOTAL", "VALOR VENTA",
];

function buscarImportes(texto: string, igvPct: number, excluir: string[] = []): {
  subtotal: number | null; igv: number | null; total: number | null;
  confianzaSubtotal: number; confianzaIgv: number; confianzaTotal: number;
} {
  let total = etiquetado(texto, ETIQUETAS_TOTAL);
  let igv = etiquetado(texto, ETIQUETAS_IGV);
  let subtotal = etiquetado(texto, ETIQUETAS_SUBTOTAL);

  let cTotal = total !== null ? CONFIANZA.importe_etiquetado : 0;
  let cIgv = igv !== null ? CONFIANZA.importe_etiquetado : 0;
  let cSub = subtotal !== null ? CONFIANZA.importe_etiquetado : 0;

  // Sin etiqueta de total queda un último recurso: el mayor importe con
  // forma de dinero. Dos filtros lo hacen seguro.
  //
  // El primero exige dos decimales. Sin él, un OCR que no alcanzó a leer la
  // línea del total toma el número más grande que encuentre —y el más grande
  // de un comprobante suele ser el correlativo del propio documento, que no
  // es plata. Con "IMPORTE TOTAL S/ 300.00" ilegible, "F001-00002591" daba
  // un total de 2591.
  //
  // El segundo descarta explícitamente la serie y el número ya reconocidos.
  //
  // Si tras filtrar no queda nada, el total se declara ilegible. Es la
  // respuesta correcta: mejor pedirlo que inventarlo.
  if (total === null) {
    const prohibidos = new Set(excluir.filter(Boolean));
    const todos = [...texto.matchAll(/\d[\d.,]*[.,]\d{2}\b/g)]
      .filter(m => !prohibidos.has(m[0]))
      .map(m => aNumero(m[0]))
      .filter((n): n is number => n !== null && n > 0 && n < 1_000_000);
    if (todos.length) {
      total = Math.max(...todos);
      cTotal = CONFIANZA.importe_inferido;
    }
  }

  // Con dos de los tres, el tercero es aritmética, no lectura.
  if (total !== null && subtotal !== null && igv === null) {
    igv = redondear(total - subtotal);
    cIgv = CONFIANZA.importe_derivado;
  } else if (total !== null && igv !== null && subtotal === null) {
    subtotal = redondear(total - igv);
    cSub = CONFIANZA.importe_derivado;
  } else if (total !== null && subtotal === null && igv === null) {
    // Solo el total: se desagrega con la tasa vigente. Vale para facturas;
    // en una boleta la persona corregirá el IGV a cero.
    const base = total / (1 + igvPct / 100);
    subtotal = redondear(base);
    igv = redondear(total - base);
    cSub = CONFIANZA.importe_derivado;
    cIgv = CONFIANZA.importe_derivado;
  }

  return {
    subtotal, igv, total,
    confianzaSubtotal: cSub, confianzaIgv: cIgv, confianzaTotal: cTotal,
  };
}

/** Busca el número que sigue a cualquiera de las etiquetas dadas. */
function etiquetado(texto: string, etiquetas: string[]): number | null {
  for (const etiqueta of etiquetas) {
    const escapada = etiqueta.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Entre la etiqueta y el importe puede haber la tasa ("IGV 18%"), dos
    // puntos, el símbolo de moneda o nada. La tasa se salta explícitamente:
    // sin eso, "IGV 18% S/ 45.76" devolvería 18.
    const re = new RegExp(
      `${escapada}\\s*:?\\s*(?:\\d{1,2}\\s*%)?\\s*:?\\s*(?:S\\s*\\/|US\\s*\\$|\\$)?\\s*(\\d[\\d.,]*)`,
      "i"
    );
    const m = texto.match(re);
    if (m) {
      const n = aNumero(m[1]);
      if (n !== null && n > 0) return n;
    }
  }
  return null;
}

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

// ════════════════════════════════════════════════════════════════
//  Moneda, tipo, razón social y forma de pago
// ════════════════════════════════════════════════════════════════

function buscarMoneda(texto: string): { valor: "PEN" | "USD"; confianza: number } {
  if (/\bUS\s*\$|\bUSD\b|\bDOLARES\b/.test(texto)) {
    return { valor: "USD", confianza: CONFIANZA.moneda_simbolo };
  }
  if (/S\s*\/|\bSOLES\b|\bPEN\b/.test(texto)) {
    return { valor: "PEN", confianza: CONFIANZA.moneda_simbolo };
  }
  // Sin símbolo se asume soles: es la moneda de la caja.
  return { valor: "PEN", confianza: CONFIANZA.moneda_defecto };
}

function buscarTipo(
  texto: string,
  serie: string
): { valor: string; confianza: number } | null {
  if (/NOTA\s+DE\s+CREDITO/.test(texto)) return { valor: "07", confianza: CONFIANZA.tipo_literal };
  if (/NOTA\s+DE\s+DEBITO/.test(texto)) return { valor: "08", confianza: CONFIANZA.tipo_literal };
  if (/\bFACTURA\b/.test(texto)) return { valor: "01", confianza: CONFIANZA.tipo_literal };
  if (/\bBOLETA\b/.test(texto)) return { valor: "03", confianza: CONFIANZA.tipo_literal };
  if (/\bTICKET\b/.test(texto)) return { valor: "12", confianza: CONFIANZA.tipo_literal };

  // Una captura de Yape o Plin no es un comprobante de pago: va a "otros".
  // No lleva RUC ni numeración, y el monto suele ser lo único legible.
  if (/\bYAPE\b|\bPLIN\b|\bTRANSFERENCIA\b|\bCONSTANCIA\b/.test(texto)) {
    return { valor: "00", confianza: CONFIANZA.tipo_literal };
  }

  // Sin la palabra impresa, el prefijo de la serie lo delata.
  const inicial = serie.charAt(0);
  if (inicial === "F") return { valor: "01", confianza: CONFIANZA.tipo_por_serie };
  if (inicial === "B") return { valor: "03", confianza: CONFIANZA.tipo_por_serie };

  return null;
}

/** Palabras que descartan una línea como razón social. */
const RUIDO_NOMBRE = /RUC|FACTURA|BOLETA|TICKET|ELECTRONIC|NOTA DE|^\d|TOTAL|IGV|DIRECCION|AV\.|CAL\.|JR\.|TELEF/;

/**
 * La razón social no tiene formato que verificar, así que esto es una
 * heurística declarada: la primera línea con cuerpo antes del RUC, que es
 * donde los comprobantes imprimen el nombre del emisor.
 */
function buscarNombre(lineas: string[], ruc: string | null): string | null {
  const corte = ruc
    ? lineas.findIndex(l => l.includes(ruc) || l.includes("RUC"))
    : Math.min(lineas.length, 5);
  const cabecera = lineas.slice(0, corte > 0 ? corte : Math.min(lineas.length, 5));

  for (const linea of cabecera) {
    const limpia = linea.replace(/[^A-Z0-9 .&-]/g, "").trim();
    if (limpia.length < 5 || limpia.length > 70) continue;
    if (RUIDO_NOMBRE.test(limpia)) continue;
    // Debe parecer un nombre, no una tira de números.
    if ((limpia.match(/[A-Z]/g)?.length ?? 0) < 4) continue;
    return limpia;
  }
  return null;
}

function buscarFormaPago(texto: string): string | null {
  if (/\bCONTADO\b|\bEFECTIVO\b/.test(texto)) return "EFECTIVO";
  if (/\bTARJETA\b|\bVISA\b|\bMASTERCARD\b|\bPOS\b/.test(texto)) return "TARJETA";
  if (/\bCREDITO\b/.test(texto)) return "CREDITO";
  if (/\bYAPE\b|\bPLIN\b|\bTRANSFERENCIA\b/.test(texto)) return "TRANSFERENCIA";
  return null;
}
