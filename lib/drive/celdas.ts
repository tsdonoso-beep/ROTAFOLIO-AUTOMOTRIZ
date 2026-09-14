// De filas de texto a celdas con tipo
//
// El CSV manda todo como texto y deja que la hoja adivine qué era. Escribiendo
// por la API se puede decir, y hay que decirlo: adivinando se pierden datos en
// silencio. Acá se hace esa traducción, sin hablar con Google, para poder
// probarla.

import type { TipoColumna } from "../export/comprobantes-sunat.ts";
import { neutralizarFormula } from "../export/csv.ts";

/** Lo que acepta Sheets en una celda cuando se escribe sin interpretar. */
export type Celda = string | number;

/**
 * La fecha como la cuenta una hoja de cálculo: días desde el 30/12/1899.
 *
 * Ese origen absurdo viene de un error de Lotus 1-2-3 que Excel copió para ser
 * compatible y Sheets copió de Excel. No se puede arreglar, solo respetar.
 *
 * Devuelve null si no es una fecha dd/mm/aaaa válida —incluido el 31 de
 * febrero, que pasa el formato y no existe—, y entonces la celda se escribe
 * como texto: es mejor ver la fecha rara que verla convertida en otra.
 */
export function aSerieDeFecha(texto: string): number | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto.trim());
  if (!m) return null;

  const [dia, mes, anio] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  if (
    d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia
  ) return null;

  const ORIGEN = Date.UTC(1899, 11, 30);
  return Math.round((d.getTime() - ORIGEN) / 86400000);
}

/** El número, o null si no lo es. Vacío no es cero: es que no se sabe. */
export function aNumeroDeCelda(texto: string): number | null {
  const t = texto.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Convierte una fila de texto en celdas del tipo que corresponde.
 *
 * Si un valor no calza con su tipo declarado no se fuerza: se deja como texto.
 * Un total que llegó como «—» tiene que verse, no volverse cero y sumar mal.
 */
export function aCeldas(fila: string[], tipos: TipoColumna[]): Celda[] {
  return fila.map((valor, i) => {
    const v = valor ?? "";
    switch (tipos[i]) {
      case "numero": return aNumeroDeCelda(v) ?? neutralizarFormula(v);
      case "fecha":  return aSerieDeFecha(v) ?? neutralizarFormula(v);
      default:       return neutralizarFormula(v);
    }
  });
}

/**
 * La tabla entera, con la cabecera intacta.
 *
 * La primera fila son títulos y van como texto aunque la columna sea de
 * números: «IGV» no es un número, y convertir la cabecera la borraría.
 */
export function aTabla(filas: string[][], tipos: TipoColumna[]): Celda[][] {
  return filas.map((f, i) => (i === 0 ? f.map(neutralizarFormula) : aCeldas(f, tipos)));
}

/** En qué columnas hay fechas, contando desde 0. */
export function columnasDeFecha(tipos: TipoColumna[]): number[] {
  return tipos.flatMap((t, i) => (t === "fecha" ? [i] : []));
}
