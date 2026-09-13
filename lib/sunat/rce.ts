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
  /** RUC de quien emitió el comprobante. */
  ruc: string | null;
  razonSocial: string | null;
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
  { campo: "ruc", titulos: [
    "ruc", "nro doc identidad", "numero documento identidad", "ruc proveedor",
    "nro de documento de identidad", "documento identidad",
  ] },
  { campo: "razonSocial", titulos: [
    "razon social", "apellidos nombres razon social denominacion",
    "apellidos y nombres o razon social", "razon social nombres",
    "apellidos nombres o razon social", "nombre proveedor",
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
    return { filas: [], mapeo: [], sinMapear: [], faltantes: [...ESPERADOS], descartadas: 0 };
  }

  const sep = separadorDe(lineas[0]);
  const titulos = partirLinea(lineas[0], sep);

  const mapeo: LecturaRce["mapeo"] = [];
  const sinMapear: string[] = [];
  const porCampo = new Map<keyof FilaRce, number>();

  titulos.forEach((titulo, i) => {
    const campo = campoDe(titulo);
    // Si dos títulos apuntan al mismo campo se queda el primero: en los
    // reportes de SUNAT las columnas del comprobante van antes que las del
    // documento que modifican.
    if (campo && !porCampo.has(campo)) {
      porCampo.set(campo, i);
      mapeo.push({ titulo, campo });
    } else if (!campo && titulo) {
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

    const fila: FilaRce = {
      ruc: dame(celdas, "ruc").trim() || null,
      razonSocial: dame(celdas, "razonSocial").trim() || null,
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
    faltantes: ESPERADOS.filter(c => !porCampo.has(c)),
    descartadas,
  };
}
