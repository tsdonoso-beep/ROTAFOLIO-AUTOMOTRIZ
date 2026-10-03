// Las fuentes de Compras, COMEX y Almacén, una fila por OC o por vale
//
// La hoja privada de Contabilidad (CopiarFuentes.gs) copia dos veces al día,
// de los archivos originales, solo las columnas que se usan:
//   NACIONALES      la base de datos de compras nacionales (una fila por ítem)
//   IMPO - BASE     la de importaciones (una fila por ítem)
//   IMPO - STATUS   el seguimiento de COMEX (una o más filas por OC: embarques)
//   IMPO - DUAS     las DUA de cada OC
//   KARDEX          los ingresos de Almacén (una fila por producto de un vale)
//   KARDEX - VALES  la cabecera de cada vale, con la guía o factura escaneada
//   COPIA - ESTADO  cuándo se copió cada pestaña
// Esto lo junta por OC (y por vale) para subirlo a la base, donde se cruza con
// las carpetas madre: quién compró, cuánto, la DAM, el costeo, si Almacén ya
// recibió con guía… aunque ese documento todavía no esté en la carpeta.
//
// Las celdas llegan sin formato (UNFORMATTED_VALUE): las fechas como número de
// serie de Sheets, los montos como número y los códigos como texto.

export type Procedencia = "Nacional" | "Importación";
export type Celda = string | number | boolean | null | undefined;

export type CompraOC = {
  oc: string; procedencia: Procedencia; ocOriginal: string; empresa: string; tipoDocumento: string;
  fecha: string | null; requerimiento: string; proveedorRuc: string; proveedor: string; pais: string;
  proyecto: string; concepto: string; moneda: string; total: number | null; totalSoles: number | null;
  formaPago: string; condicionPago: string; incoterm: string; lugarEntrega: string; tiempoEntrega: string;
  solicitado: string; elaborado: string; items: number;
};

export type Dua = { dua: string; fecha: string | null; encargado: string; subioOc: string; fechaSubida: string | null; observacion: string };

export type ComexOC = {
  oc: string; ocOriginal: string; empresa: string; comprador: string; estadoCompra: string; fechaOc: string | null;
  proveedor: string; origen: string; incoterm: string; modalidad: string; operador: string; awbBl: string;
  etd: string; eta: string; ata: string; fechaAproxPlanta: string; fechaRealPlanta: string;
  documentosEnviados: string; agenteAduanas: string; dam: string; costeo: string; observaciones: string;
  embarques: number; duas: Dua[];
};

export type Vale = {
  id: string; vale: string; fechaRegistro: string | null; fechaOperacion: string | null; movimiento: string;
  operacion: string; proveedor: string; tipoDocumento: string; numeroDocumento: string; tipoOrden: string;
  numeroOrden: string; oc: string | null; procedencia: Procedencia | null; proyecto: string; sede: string;
  responsable: string; recepcionado: string; documentoRuta: string; documentoUrl: string; valeUrl: string;
  items: number; cantidad: number;
};

export type EstadoCopia = { pestana: string; origen: string; filas: number | null; inicio: string | null; fin: string | null; resultado: string };

export type Fuentes = { compras: CompraOC[]; comex: ComexOC[]; vales: Vale[]; estado: EstadoCopia[]; avisos: string[] };

// ── Normalizar ────────────────────────────────────────────────────

/** Mayúsculas, sin tildes ni espacios de más: para comparar encabezados y textos. */
export function plano(t: Celda): string {
  return String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
}

/** El texto de una celda, sin espacios de más. */
export function texto(t: Celda): string {
  if (t == null || typeof t === "boolean") return t == null ? "" : t ? "SI" : "NO";
  return String(t).replace(/\s+/g, " ").trim();
}

/** Un número de una celda: 1250.5, «1,250.50», «S/ 1 250»; null si no hay. */
export function numero(t: Celda): number | null {
  if (typeof t === "number") return isFinite(t) ? t : null;
  const s = String(t ?? "").replace(/[^\d.,-]/g, "");
  if (!s || !/\d/.test(s)) return null;
  // «1.250,50» → 1250.50; «1,250.50» → 1250.50
  const n = /,\d{1,2}$/.test(s) && !/\.\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  const v = Number(n);
  return isFinite(v) ? v : null;
}

/**
 * Una fecha de una celda, como «aaaa-mm-dd»: número de serie de Sheets (días
 * desde el 30/12/1899), «dd/mm/aaaa», «aaaa-mm-dd…». Null si no es fecha
 * («POR CONFIRMAR», vacía).
 */
export function fecha(t: Celda): string | null {
  if (typeof t === "number") {
    if (t < 20000 || t > 80000) return null;   // entre 1954 y 2119
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(t) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = texto(t);
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/.exec(s);
  if (m) {
    const anio = m[3].length === 2 ? "20" + m[3] : m[3];
    const mes = Number(m[2]), dia = Number(m[1]);
    if (mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31) return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  }
  return null;
}

/** La fecha si es fecha; si no, el texto («POR CONFIRMAR»). Para ETA, ATA y demás de COMEX. */
function fechaOTexto(t: Celda): string {
  return fecha(t) ?? texto(t);
}

/**
 * La OC como la escribe la carpeta madre: nacional con 4 dígitos
 * («0200-2026»), importación con 3 («172-2026»). Acepta lo que se ve en las
 * fuentes: «00098-2026», «0068.1-2026», «625-2025(III)», «001-2026 (I)»,
 * «OC 1258-2026», y el año adelante «2023-040 (69)». Null si no parece OC.
 */
export function normalizarOc(t: Celda, procedencia: Procedencia): string | null {
  const s = plano(t);
  let num: number, anio: string;
  let m = /(?:^|[^\d])(\d{1,5})(?:\.\d+)?\s*-\s*(20\d\d)(?!\d)/.exec(s);
  if (m) { num = Number(m[1]); anio = m[2]; }
  else {
    m = /^(20\d\d)\s*-\s*(\d{1,4})(?!\d)/.exec(s);
    if (!m) return null;
    anio = m[1]; num = Number(m[2]);
  }
  if (!num) return null;
  const digitos = procedencia === "Importación" ? 3 : 4;
  return `${String(num).padStart(digitos, "0")}-${anio}`;
}

// ── Leer las pestañas ─────────────────────────────────────────────

/** Una pestaña como filas con acceso por nombre de columna. */
export function tabla(filas: Celda[][] | undefined): { get: (fila: Celda[], col: string) => Celda; filas: Celda[][]; tiene: (col: string) => boolean } {
  const cab = (filas?.[0] ?? []).map(plano);
  const idx = new Map<string, number>();
  cab.forEach((c, i) => { if (c && !idx.has(c)) idx.set(c, i); });
  return {
    get: (fila, col) => { const i = idx.get(plano(col)); return i == null ? undefined : fila[i]; },
    tiene: col => idx.has(plano(col)),
    filas: (filas ?? []).slice(1).filter(f => f.some(c => texto(c) !== "")),
  };
}

/** El primer valor no vacío. */
const primero = (xs: string[]) => xs.find(x => x) ?? "";
/** Los distintos no vacíos, unidos con « / ». */
const distintos = (xs: string[], max = 6) => {
  const u = [...new Set(xs.filter(Boolean))];
  return u.slice(0, max).join(" / ") + (u.length > max ? ` (+${u.length - max})` : "");
};
const suma = (xs: (number | null)[]) => xs.some(x => x != null) ? Math.round(xs.reduce<number>((a, x) => a + (x ?? 0), 0) * 100) / 100 : null;
const minFecha = (xs: (string | null)[]) => xs.filter((x): x is string => !!x).sort()[0] ?? null;

function agrupar<T>(xs: T[], clave: (x: T) => string | null): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = clave(x);
    if (!k) continue;
    const l = m.get(k);
    if (l) l.push(x); else m.set(k, [x]);
  }
  return m;
}

/** Las bases de Compras (nacional o importación): una fila por OC con su monto total. */
export function comprasPorOc(filas: Celda[][] | undefined, procedencia: Procedencia): CompraOC[] {
  const t = tabla(filas);
  const g = (f: Celda[], c: string) => texto(t.get(f, c));
  const imp = procedencia === "Importación";
  const porOc = agrupar(t.filas, f => normalizarOc(t.get(f, "N° OC/OS"), procedencia));
  return [...porOc].map(([oc, fs]) => {
    // Si una OC está en más de una empresa (INROPRIN y un consorcio), manda INROPRIN.
    const propias = fs.filter(f => /ROLAND PRINT S\.?A\.?C/.test(plano(t.get(f, "EMPRESA"))) && !/CONSORCIO/.test(plano(t.get(f, "EMPRESA"))));
    const xs = propias.length ? propias : fs;
    const col = (c: string) => xs.map(f => g(f, c));
    return {
      oc, procedencia,
      ocOriginal: distintos(col("N° OC/OS")),
      empresa: distintos(col("EMPRESA"), 2),
      tipoDocumento: primero(col("TIPO DE DOCUMENTO")),
      fecha: minFecha(xs.map(f => fecha(t.get(f, "FECHA")))),
      requerimiento: distintos(col("N° REQUERIMIENTO")),
      proveedorRuc: imp ? "" : primero(col("RUC").map(r => r.replace(/\D/g, "")).filter(r => r.length === 11)),
      proveedor: primero(col(imp ? "RAZON SOCIAL - SUPPLIER" : "RAZON SOCIAL")),
      pais: imp ? primero(col("PAIS - COUNTRY")) : "",
      proyecto: distintos(col("PROYECTO"), 3),
      concepto: distintos(col("CONCEPTO"), 3),
      moneda: distintos(col("MONEDA"), 2),
      total: suma(xs.map(f => numero(t.get(f, "COSTO TOTAL")))),
      totalSoles: suma(xs.map(f => numero(t.get(f, "COSTO TOTAL (SOLES)")))),
      formaPago: distintos(col("FORMA DE PAGO"), 2),
      condicionPago: imp ? distintos(xs.map(f => { const p = numero(t.get(f, "PORCENTAJE")); return p == null ? "" : `${Math.round(p * 1000) / 10}%`; }), 3)
        : distintos(col("DIAS O PORCENTAJE"), 2),
      incoterm: imp ? distintos(col("INCOTERM"), 2) : "",
      lugarEntrega: imp ? "" : primero(col("LUGAR DE ENTREGA")),
      tiempoEntrega: imp ? "" : primero(col("TIEMPO DE ENTREGA")),
      solicitado: distintos(col("SOLICITADO"), 3),
      elaborado: distintos(col(imp ? "ELABORADO POR" : "ELABORADO"), 2),
      items: xs.length,
    };
  });
}

/** Una DAM o DUA como número limpio: «"03819266» → «03819266»; «DUA 235-2025-10-186036» → «235-2025-10-186036». */
export function limpiarDam(t: Celda): string[] {
  return texto(t).replace(/["'`*]/g, "").replace(/^DUA\s*/i, "")
    .split(/\s*(?:\/\/|\/|;|,|\sY\s)\s*/i).map(x => x.trim()).filter(x => /\d{3,}/.test(x));
}

/** El seguimiento de COMEX (STATUS + DUAS): una fila por OC de INROPRIN. */
export function comexPorOc(status: Celda[][] | undefined, duas: Celda[][] | undefined): ComexOC[] {
  const t = tabla(status);
  const g = (f: Celda[], c: string) => texto(t.get(f, c));
  // INROPLAS tiene su propia numeración de OC: no se mezcla.
  const filas = t.filas.filter(f => !/INROPLAS/.test(plano(t.get(f, "EMPRESA"))));
  const porOc = agrupar(filas, f => normalizarOc(t.get(f, "NRO OC"), "Importación"));

  const d = tabla(duas);
  const duasPorOc = agrupar(d.filas, f => normalizarOc(d.get(f, "N° OC"), "Importación"));
  const de = (oc: string): Dua[] => (duasPorOc.get(oc) ?? []).flatMap(f => limpiarDam(d.get(f, "DUA")).map(dua => ({
    dua, fecha: fecha(d.get(f, "FECHA AFECTACION")), encargado: texto(d.get(f, "ENCARGADO")),
    subioOc: texto(d.get(f, "¿SUBIO OC?")), fechaSubida: fecha(d.get(f, "FECHA DE SUBIDA")), observacion: texto(d.get(f, "OBSERVACION")),
  })));

  const ocs = new Set([...porOc.keys(), ...duasPorOc.keys()]);
  return [...ocs].map(oc => {
    const xs = porOc.get(oc) ?? [];
    const col = (c: string) => xs.map(f => g(f, c));
    const fechas = (c: string) => distintos(xs.map(f => fechaOTexto(t.get(f, c))), 3);
    return {
      oc,
      ocOriginal: distintos(col("NRO OC")),
      empresa: distintos(col("EMPRESA"), 2),
      comprador: distintos(col("COMPRADOR"), 2),
      estadoCompra: distintos(col("ESTADO DE COMPRA"), 3),
      fechaOc: minFecha(xs.map(f => fecha(t.get(f, "FECHA OC")))),
      proveedor: primero(col("PROVEEDOR")),
      origen: distintos(col("ORIGEN"), 2),
      incoterm: distintos(col("INCOTERM"), 2),
      modalidad: distintos(col("MODALIDAD DE ENVIO"), 2),
      operador: distintos(col("OPERADOR LOGISTICO"), 2),
      awbBl: distintos(col("AWB O BL"), 4),
      etd: fechas("ETD"), eta: fechas("ETA"), ata: fechas("ATA"),
      fechaAproxPlanta: fechas("FECHA APROX EN PLANTA"),
      fechaRealPlanta: fechas("FECHA REAL EN PLANTA"),
      documentosEnviados: distintos(col("DOCUMENTOS ENVIADOS"), 2),
      agenteAduanas: distintos(col("AGENTE ADUANAS"), 2),
      dam: distintos(xs.flatMap(f => limpiarDam(t.get(f, "DAM"))), 6),
      costeo: distintos(col("COSTEO"), 3),
      observaciones: distintos(col("OBSERVACIONES"), 3).slice(0, 500),
      embarques: xs.length,
      duas: de(oc),
    };
  });
}

/** De qué procedencia es un vale: la compra importada va con la OC de 3 dígitos. */
function procedenciaDeVale(operacion: string, tipoOrden: string): Procedencia | null {
  const op = plano(operacion), to = plano(tipoOrden);
  if (/IMPORTAD/.test(op)) return "Importación";
  if (/COMPRA|ORDEN DE SERVICIO|DEVOLUCION/.test(op) || /COMPRA|SERVICIO/.test(to)) return "Nacional";
  return null;
}

/**
 * Los vales de Almacén: la cabecera (KARDEX - VALES) con cuántos productos y
 * unidades entraron (KARDEX). Un vale que solo está en el KARDEX (sin
 * cabecera) se arma con su primera fila.
 */
export function valesDeAlmacen(vales: Celda[][] | undefined, kardex: Celda[][] | undefined): Vale[] {
  const k = tabla(kardex);
  const items = agrupar(k.filas, f => texto(k.get(f, "ID DOCUMENTO")) || null);
  const v = tabla(vales);
  const arma = (t: ReturnType<typeof tabla>, f: Celda[], id: string): Vale => {
    const g = (c: string) => texto(t.get(f, c));
    const operacion = g("TIPO DE OPERACION"), tipoOrden = g("TIPO DE ORDEN"), numeroOrden = g("NUMERO ORDEN");
    const procedencia = procedenciaDeVale(operacion, tipoOrden);
    const its = items.get(id) ?? [];
    return {
      id, vale: g("VALE DE ALMACEN"),
      fechaRegistro: fecha(t.get(f, "FECHA REGISTRO")), fechaOperacion: fecha(t.get(f, "FECHA OPERACION")),
      movimiento: plano(t.get(f, "TIPO DE MOVIMIENTO")), operacion: plano(operacion),
      proveedor: plano(t.get(f, "TIPO ANEXO")) === "PROVEEDOR" ? g("DESCRIPCION") : "",
      tipoDocumento: plano(t.get(f, "TIPO DOCUMENTO")), numeroDocumento: g("NUMERO DOCUMENTO").toUpperCase(),
      tipoOrden: plano(tipoOrden), numeroOrden,
      oc: procedencia ? normalizarOc(numeroOrden, procedencia) : null, procedencia,
      proyecto: g("PROYECTO"), sede: g("SEDE"), responsable: g("RESPONSABLE DE REGISTRO"), recepcionado: g("RECEPCIONADO POR"),
      documentoRuta: g("DOCUMENTO"), documentoUrl: g("ENLACE DOCUMENTO"), valeUrl: g("ENLACE VALE"),
      items: its.length,
      cantidad: Math.round(its.reduce((a, x) => a + (numero(k.get(x, "INGRESO")) ?? 0), 0) * 1000) / 1000,
    };
  };
  const out = new Map<string, Vale>();
  for (const f of v.filas) {
    const id = texto(v.get(f, "ID"));
    if (id && !out.has(id)) out.set(id, arma(v, f, id));
  }
  for (const [id, fs] of items) if (!out.has(id)) out.set(id, { ...arma(k, fs[0], id), documentoRuta: "" });
  return [...out.values()];
}

/** COPIA - ESTADO: cuándo se copió cada pestaña y si salió bien. */
export function estadoDeCopia(filas: Celda[][] | undefined): EstadoCopia[] {
  const t = tabla(filas);
  const cuando = (c: Celda) => {
    if (typeof c === "number") return new Date(Date.UTC(1899, 11, 30) + c * 86400000 + 5 * 3600000).toISOString();   // hora de Lima
    return texto(c) || null;
  };
  return t.filas.map(f => ({
    pestana: texto(t.get(f, "Pestaña")), origen: texto(t.get(f, "Origen")), filas: numero(t.get(f, "Filas copiadas")),
    inicio: cuando(t.get(f, "Inicio")), fin: cuando(t.get(f, "Fin")), resultado: texto(t.get(f, "Resultado")),
  }));
}

export const PESTANAS = ["NACIONALES", "IMPO - BASE", "IMPO - STATUS", "IMPO - DUAS", "KARDEX", "KARDEX - VALES", "COPIA - ESTADO"] as const;

/** Todo junto, desde las pestañas de la hoja privada. */
export function leerFuentes(p: Partial<Record<(typeof PESTANAS)[number], Celda[][]>>): Fuentes {
  const avisos: string[] = [];
  for (const n of PESTANAS) if (!p[n]?.length) avisos.push(`La pestaña «${n}» no está o está vacía.`);
  const compras = [...comprasPorOc(p["NACIONALES"], "Nacional"), ...comprasPorOc(p["IMPO - BASE"], "Importación")];
  return {
    compras,
    comex: comexPorOc(p["IMPO - STATUS"], p["IMPO - DUAS"]),
    vales: valesDeAlmacen(p["KARDEX - VALES"], p["KARDEX"]),
    estado: estadoDeCopia(p["COPIA - ESTADO"]),
    avisos,
  };
}
