// Cómo se le nombra a Sheets un pedazo de hoja
//
// La API de Sheets no recibe "la pestaña entera": recibe un rango escrito
// como lo escribiría una persona —'COMPROBANTES SUNAT'!A1:U500— y hay que
// armarlo a mano. Estas funciones son puras a propósito: el armado del rango
// y el corte en bloques es donde se cuelan los errores de uno, y así se
// prueban sin hablar con Google.

/**
 * La letra de una columna, contando desde 1.
 *
 * No es base 26 normal: no hay cifra cero, así que la columna 26 es Z y la 27
 * es AA. Restar uno antes de cada vuelta es lo que lo arregla.
 */
export function letraColumna(n: number): string {
  if (!Number.isInteger(n) || n < 1) throw new Error(`Columna inválida: ${n}`);
  let letra = "";
  let resto = n;
  while (resto > 0) {
    const d = (resto - 1) % 26;
    letra = String.fromCharCode(65 + d) + letra;
    resto = Math.floor((resto - 1) / 26);
  }
  return letra;
}

/**
 * El nombre de la pestaña como lo espera un rango.
 *
 * Va entre comillas simples porque tiene espacios, y una comilla dentro del
 * nombre se duplica. Nadie llamaría así a una pestaña, pero si alguien lo
 * hace el rango no debe partirse en dos.
 */
export function citarPestana(titulo: string): string {
  return `'${titulo.replace(/'/g, "''")}'`;
}

/** El rango que ocupan `filas` filas × `columnas` columnas desde `desde`. */
export function rangoA1(
  titulo: string, desde: number, filas: number, columnas: number
): string {
  const fin = desde + Math.max(filas, 1) - 1;
  return `${citarPestana(titulo)}!A${desde}:${letraColumna(Math.max(columnas, 1))}${fin}`;
}

/**
 * Corta las filas en envíos que Sheets acepte de una vez.
 *
 * Trece mil comprobantes por veintiún columnas son casi trescientas mil
 * celdas; mandarlas en una sola petición la hace fallar por tamaño, y el
 * error que devuelve no habla de tamaño. Se corta por filas y no por celdas
 * para que cada bloque siga siendo un rango rectangular.
 *
 * Devuelve también en qué fila de la hoja empieza cada bloque, que es lo que
 * hay que pasarle al rango.
 */
export function enBloques<T>(
  filas: T[], porBloque: number
): Array<{ desde: number; filas: T[] }> {
  if (porBloque < 1) throw new Error("El bloque debe tener al menos una fila.");
  const bloques: Array<{ desde: number; filas: T[] }> = [];
  for (let i = 0; i < filas.length; i += porBloque) {
    bloques.push({ desde: i + 1, filas: filas.slice(i, i + porBloque) });
  }
  return bloques;
}

/** Cuántas columnas tiene la fila más ancha. */
export function anchoMaximo(filas: string[][]): number {
  return filas.reduce((max, f) => Math.max(max, f.length), 0);
}

export interface Pestana {
  id: number;
  titulo: string;
  filas: number;
  columnas: number;
}

/**
 * Cuál de las pestañas es la de datos.
 *
 * La que se llama como el archivo, porque así la nombra Drive cuando convierte
 * el CSV la primera vez. Si alguien la renombró, la primera: es la que estaba
 * cuando el archivo se creó, y las que se agregan después van detrás.
 *
 * Lo importante es a cuáles NO devuelve: el tablero que arma Contabilidad
 * vive en otra pestaña del mismo archivo y no se toca.
 */
export function elegirPestana(pestanas: Pestana[], nombre: string): Pestana {
  if (pestanas.length === 0) throw new Error("La hoja no tiene ninguna pestaña.");
  return pestanas.find(p => p.titulo === nombre) ?? pestanas[0];
}
