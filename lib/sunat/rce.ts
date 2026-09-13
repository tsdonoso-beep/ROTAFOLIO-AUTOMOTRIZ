// Leer la propuesta del RCE
//
// Es el listado de lo que los proveedores le declararon a SUNAT a nombre de
// la empresa durante un período. Llega como CSV dentro de un zip.
//
// Está escrito para un archivo que todavía no hemos visto en producción, y
// eso manda sobre el diseño: en vez de fijar posiciones ("la columna 5 es la
// serie") se guía por los títulos. Si SUNAT agrega una columna al medio, un
// lector por posición empieza a leer mal sin avisar; uno por título sigue
// funcionando o dice que no encontró la columna.
//
// Lo que no reconoce no lo tira: queda en `sinMapear` y la pantalla lo
// muestra. Es la forma de aprender el formato real sin tener que adivinarlo.

/** Un comprobante tal como SUNAT lo tiene registrado. */
export interface FilaRce {
  /**
   * RUC del proveedor: quien emitió el comprobante.
   *
   * Sale de «Nro Doc Identidad», no de «RUC». El archivo empieza cada fila
   * con el RUC del generador —la propia empresa, repetido 3163 veces en el
   * período 202608— y recién más adelante trae la contraparte. Tomar el
   * primero hacía que todo el registro de compras saliera a nombre de quien
   * compra.
   */
  ruc: string | null;
  razonSocial: string | null;
  /** RUC de quien generó el registro, que es la propia empresa. */
  rucGenerador: string | null;
  razonGenerador: string | null;
  /** Código SUNAT: 01 factura, 03 boleta, 07 nota de crédito... */
  tipoComprobante: string | null;
  serie: string | null;
  numero: string | null;
  /** yyyy-mm-dd */
  fechaEmision: string | null;
  total: number | null;
  moneda: string | null;
  /** La fila entera, por si hace falta mirarla. */
  cruda: Record<string, string>;
}

export interface LecturaRce {
  filas: FilaRce[];
  /** Títulos que sí se reconocieron, y con qué campo se emparejaron. */
  mapeo: Array<{ titulo: string; campo: keyof FilaRce }>;
  /** Títulos que llegaron y no se supo qué eran. */
  sinMapear: string[];
  /**
   * Títulos que apuntaban a un campo ya tomado por otra columna.
   *
   * El RCE trae dos identidades —la del generador y la del proveedor— y las
   * dos encajan en «ruc» y «razón social». Quedarse con la primera y callar
   * la segunda hizo que las 3163 filas del período 202608 salieran a nombre
   * de la propia empresa. Ahora se listan, porque una columna descartada en
   * silencio es un dato perdido que nadie va a buscar.
   */
  duplicadas: Array<{ titulo: string; campo: keyof FilaRce }>;
  /** Los títulos en el orden en que llegaron. */
  titulos: string[];
  /** La primera fila con datos, para ver qué hay en cada columna. */
  ejemplo: string[];
  /** Campos que esperábamos y no aparecieron en el archivo. */
  faltantes: string[];
  /** Filas que se descartaron por no tener nada aprovechable. */
  descartadas: number;
}

/** Quita acentos, baja a minúsculas y junta espacios, para comparar títulos. */
export function normalizar(s: string): string {
  return s
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Varias formas de llamar a lo mismo. SUNAT no es consistente entre
// reportes, y estos títulos salen de su documentación y de sus ejemplos.
const ALIAS: Array<{ campo: keyof FilaRce; titulos: string[] }> = [
  // La contraparte va primero en la lista para que gane cuando el archivo
  // trae las dos identidades, que es el caso del RCE completo.
  { campo: "ruc", titulos: [
    "nro doc identidad", "numero documento identidad", "ruc proveedor",
    "nro de documento de identidad", "documento identidad", "nro doc identidad proveedor",
  ] },
  { campo: "razonSocial", titulos: [
    "apellidos nombres razon social", "apellidos nombres razon social denominacion",
    "nombre proveedor", "razon social proveedor",
  ] },
  { campo: "rucGenerador", titulos: ["ruc", "ruc generador"] },
  { campo: "razonGenerador", titulos: [
    "apellidos y nombres o razon social", "razon social", "razon social nombres",
    "apellidos nombres o razon social",
  ] },
  { campo: "tipoComprobante", titulos: [
    "tipo cp doc", "tipo de cdp o documento", "tipo comprobante", "tipo cp",
    "cod tipo cp", "tipo documento", "tipo de comprobante",
  ] },
  { campo: "serie", titulos: [
    "serie del cdp", "serie", "nro serie cdp", "serie cdp", "serie comprobante",
  ] },
  { campo: "numero", titulos: [
    "nro cp o doc nro inicial documento referencia", "nro cp", "numero cp",
    "nro comprobante", "numero comprobante", "numero", "nro del cdp", "nro cdp",
  ] },
  { campo: "fechaEmision", titulos: [
    "fecha de emision", "fecha emision", "fecha emision cp", "fec emision",
    "fecha de emision del cp",
  ] },
  { campo: "total", titulos: [
    "total cp", "importe total cp", "importe total", "total comprobante", "total",
  ] },
  { campo: "moneda", titulos: [
    "moneda", "cod moneda", "codigo moneda", "tipo moneda",
  ] },
];

const ESPERADOS: Array<keyof FilaRce> = [
  "ruc", "tipoComprobante", "serie", "numero", "fechaEmision", "total",
];

function campoDe(titulo: string): keyof FilaRce | null {
  const n = normalizar(titulo);
  if (!n) return null;
  for (const a of ALIAS) {
    if (a.titulos.some(t => t === n)) return a.campo;
  }
  // Segunda vuelta, más laxa: el título contiene al alias. Se hace después
  // para que una coincidencia exacta siempre gane a una parcial.
  for (const a of ALIAS) {
    if (a.titulos.some(t => n.includes(t))) return a.campo;
  }
  return null;
}

/** Parte una línea de CSV respetando las comillas. */
export function partirLinea(linea: string, sep: string): string[] {
  const out: string[] = [];
  let actual = "";
  let enComillas = false;

  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (enComillas) {
      if (c === '"') {
        if (linea[i + 1] === '"') { actual += '"'; i++; }
        else enComillas = false;
      } else actual += c;
    } else if (c === '"') {
      enComillas = true;
    } else if (c === sep) {
      out.push(actual); actual = "";
    } else actual += c;
  }
  out.push(actual);
  return out.map(s => s.trim());
}

/**
 * Adivina el separador mirando la primera línea.
 *
 * SUNAT usa punto y coma en sus reportes, pero también aparecen pipes. Se
 * elige el que más columnas produzca en vez de fijarlo: equivocarse aquí
 * deja una sola columna con toda la fila dentro, que es un fallo silencioso.
 */
export function separadorDe(primeraLinea: string): string {
  const candidatos = ["|", ";", "\t", ","];
  let mejor = ";";
  let max = 0;
  for (const c of candidatos) {
    const n = partirLinea(primeraLinea, c).length;
    if (n > max) { max = n; mejor = c; }
  }
  return mejor;
}

/** Un número como lo escribe SUNAT. */
export function aNumero(v: string): number | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  // Puede venir "1,234.56" o "1234,56". Si hay coma y punto, la coma
  // separa miles; si solo hay coma, es el decimal.
  let limpio = s.replace(/\s/g, "");
  if (limpio.includes(",") && limpio.includes(".")) limpio = limpio.replace(/,/g, "");
  else if (limpio.includes(",")) limpio = limpio.replace(",", ".");
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

/** Una fecha como la escribe SUNAT, devuelta siempre como yyyy-mm-dd. */
export function aFecha(v: string): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;

  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  // dd/mm/yyyy y dd-mm-yyyy, que es lo habitual en los reportes de SUNAT.
  m = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;

  return null;
}

/**
 * El código de tipo de comprobante, a dos dígitos.
 *
 * SUNAT lo escribe unas veces como "1" y otras como "01". Se rellena para
 * poder compararlo — cuidando que un valor vacío quede en null y no se
 * convierta en el código "00", que existe y significa otra cosa.
 */
export function codigoTipo(v: string): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  return /^\d{1,2}$/.test(s) ? s.padStart(2, "0") : s.toUpperCase();
}

/** Deja el número del comprobante comparable: sin ceros a la izquierda. */
export function normalizarNumero(v: string | null): string | null {
  if (v == null) return null;
  const s = v.trim().replace(/^0+/, "");
  return s === "" ? (v.trim() === "" ? null : "0") : s;
}

/**
 * Lee el CSV de la propuesta.
 *
 * No lanza si el archivo viene raro: devuelve qué entendió y qué no, para
 * que la pantalla pueda mostrarlo. Un error aquí significaría no poder ver
 * el archivo que justamente hace falta mirar para arreglarlo.
 */
export function leerPropuestaRce(texto: string): LecturaRce {
  const limpio = texto.replace(/^﻿/, "");
  const lineas = limpio.split(/\r?\n/).filter(l => l.trim() !== "");

  if (lineas.length === 0) {
    return {
      filas: [], mapeo: [], sinMapear: [], duplicadas: [], titulos: [], ejemplo: [],
      faltantes: [...ESPERADOS], descartadas: 0,
    };
  }

  const sep = separadorDe(lineas[0]);
  const titulos = partirLinea(lineas[0], sep);

  const mapeo: LecturaRce["mapeo"] = [];
  const sinMapear: string[] = [];
  const porCampo = new Map<keyof FilaRce, number>();

  const duplicadas: LecturaRce["duplicadas"] = [];

  titulos.forEach((titulo, i) => {
    const campo = campoDe(titulo);
    if (campo && !porCampo.has(campo)) {
      porCampo.set(campo, i);
      mapeo.push({ titulo, campo });
    } else if (campo) {
      // Ya había otra columna para ese campo. Antes esto se descartaba sin
      // decir nada; ahora se dice, porque puede ser la columna correcta.
      duplicadas.push({ titulo, campo });
    } else if (titulo) {
      sinMapear.push(titulo);
    }
  });

  const dame = (celdas: string[], campo: keyof FilaRce): string => {
    const i = porCampo.get(campo);
    return i == null ? "" : (celdas[i] ?? "");
  };

  const filas: FilaRce[] = [];
  let descartadas = 0;

  for (let i = 1; i < lineas.length; i++) {
    const celdas = partirLinea(lineas[i], sep);
    const cruda: Record<string, string> = {};
    titulos.forEach((t, j) => { if (t) cruda[t] = celdas[j] ?? ""; });

    // Si el archivo trae una sola identidad —formatos más simples que el RCE
    // completo— esa es la contraparte y se usa como tal.
    const fila: FilaRce = {
      ruc: (dame(celdas, "ruc").trim() || dame(celdas, "rucGenerador").trim()) || null,
      razonSocial: (dame(celdas, "razonSocial").trim() || dame(celdas, "razonGenerador").trim()) || null,
      rucGenerador: dame(celdas, "rucGenerador").trim() || null,
      razonGenerador: dame(celdas, "razonGenerador").trim() || null,
      tipoComprobante: codigoTipo(dame(celdas, "tipoComprobante")),
      serie: dame(celdas, "serie").trim().toUpperCase() || null,
      numero: normalizarNumero(dame(celdas, "numero")),
      fechaEmision: aFecha(dame(celdas, "fechaEmision")),
      total: aNumero(dame(celdas, "total")),
      cruda,
      moneda: dame(celdas, "moneda").trim().toUpperCase() || null,
    };

    // Una fila sin RUC y sin número no sirve para cruzar contra nada. Suele
    // ser un pie de página con totales.
    if (!fila.ruc && !fila.numero) { descartadas++; continue; }
    filas.push(fila);
  }

  return {
    filas,
    mapeo,
    sinMapear,
    duplicadas,
    titulos,
    ejemplo: lineas.length > 1 ? partirLinea(lineas[1], sep) : [],
    // La identidad del generador sirve de respaldo cuando el archivo trae
    // una sola: no hay que reportarla como faltante si está cubierta.
    faltantes: ESPERADOS.filter(c => {
      if (porCampo.has(c)) return false;
      if (c === "ruc") return !porCampo.has("rucGenerador");
      return true;
    }),
    descartadas,
  };
}

/**
 * Comprueba que la identidad leída sea la del proveedor y no la de la empresa.
 *
 * Un registro de COMPRAS no puede tener comprobantes emitidos por quien
 * compra. Si casi todas las filas traen el RUC de la propia empresa, la
 * columna elegida es la equivocada — que es exactamente lo que pasó con el
 * período 202608: 3163 filas a nombre de INROPRIN.
 *
 * Existe para que el error se denuncie solo. La forma del archivo se dedujo
 * de una muestra; si SUNAT la cambia, o si otra empresa recibe otro formato,
 * esto lo dice en vez de devolver un cruce que no significa nada.
 */
export function revisarIdentidad(
  filas: FilaRce[], rucEmpresa: string
): { ok: true } | { ok: false; motivo: string; cuantas: number; total: number } {
  const conRuc = filas.filter(f => f.ruc);
  if (conRuc.length === 0) return { ok: true };

  const propias = conRuc.filter(f => f.ruc === rucEmpresa.trim()).length;
  // Un puñado puede ser legítimo: hay comprobantes que una empresa se emite a
  // sí misma. Que lo sean casi todos no.
  if (propias / conRuc.length < 0.9) return { ok: true };

  return {
    ok: false,
    cuantas: propias,
    total: conRuc.length,
    motivo: `${propias} de ${conRuc.length} comprobantes salen a nombre de la propia empresa `
      + `(RUC ${rucEmpresa}). En un registro de compras eso es imposible: se está leyendo la `
      + `columna del generador y no la del proveedor. Los conteos de este cruce no valen.`,
  };
}
