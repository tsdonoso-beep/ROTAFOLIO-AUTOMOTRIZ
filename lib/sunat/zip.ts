// Abrir el archivo que manda SUNAT
//
// El SIRE no devuelve el reporte: devuelve un zip con el reporte dentro. Y
// un zip no se abre con `zlib` a secas, porque zlib descomprime un flujo y
// un zip es un contenedor con índice.
//
// Se lee el índice (el "directorio central") en vez de recorrer el archivo
// de principio a fin buscando cabeceras. Recorrerlo parece más simple pero
// falla con los zip escritos al vuelo: cuando el que comprime no sabe de
// antemano cuánto va a ocupar, deja los tamaños en cero y los escribe
// después del contenido. El índice siempre los tiene.
//
// Cubre los dos métodos que aparecen en la práctica: sin comprimir (0) y
// deflate (8). Cualquier otro se rechaza con su número, para que el
// mensaje diga qué pasó en vez de devolver bytes rotos.

import { inflateRawSync } from "node:zlib";

const FIN_INDICE = 0x06054b50;   // cierre del zip
const ENTRADA = 0x02014b50;      // una entrada del índice
const LOCAL = 0x04034b50;        // la cabecera que precede al contenido

export interface ArchivoDelZip {
  nombre: string;
  contenido: Buffer;
}

/** Busca el cierre del zip desde el final. */
function ubicarFinDelIndice(b: Buffer): number {
  // El cierre mide 22 bytes y puede llevar hasta 64 KB de comentario detrás.
  const desde = Math.max(0, b.length - (22 + 0xffff));
  for (let i = b.length - 22; i >= desde; i--) {
    if (b.readUInt32LE(i) === FIN_INDICE) return i;
  }
  return -1;
}

/**
 * Devuelve los archivos que hay dentro del zip.
 *
 * `maximoDescomprimido` acota lo que se puede expandir. El tamaño lo declara
 * el propio archivo, así que sin un tope un zip pequeño y malicioso puede
 * pedir gigabytes de memoria. SUNAT no manda eso, pero el archivo llega de
 * afuera y el costo de acotarlo es una línea.
 */
export function leerZip(datos: ArrayBuffer | Buffer, maximoDescomprimido = 256 * 1024 * 1024): ArchivoDelZip[] {
  const b = Buffer.isBuffer(datos) ? datos : Buffer.from(datos);

  const fin = ubicarFinDelIndice(b);
  if (fin < 0) {
    throw new Error("Esto no es un zip: no se encontró su cierre. ¿SUNAT devolvió un error en vez del archivo?");
  }

  const cuantas = b.readUInt16LE(fin + 10);
  let p = b.readUInt32LE(fin + 16);
  const archivos: ArchivoDelZip[] = [];
  let acumulado = 0;

  for (let i = 0; i < cuantas; i++) {
    if (p + 46 > b.length || b.readUInt32LE(p) !== ENTRADA) {
      throw new Error(`El índice del zip está roto en la entrada ${i + 1} de ${cuantas}.`);
    }

    const metodo = b.readUInt16LE(p + 10);
    const comprimido = b.readUInt32LE(p + 20);
    const crudo = b.readUInt32LE(p + 24);
    const largoNombre = b.readUInt16LE(p + 28);
    const largoExtra = b.readUInt16LE(p + 30);
    const largoComentario = b.readUInt16LE(p + 32);
    const inicioLocal = b.readUInt32LE(p + 42);
    const nombre = b.subarray(p + 46, p + 46 + largoNombre).toString("utf8");

    p += 46 + largoNombre + largoExtra + largoComentario;

    // Una carpeta dentro del zip no tiene contenido que leer.
    if (nombre.endsWith("/")) continue;

    acumulado += crudo;
    if (acumulado > maximoDescomprimido) {
      throw new Error(`El zip declara más de ${Math.round(maximoDescomprimido / 1024 / 1024)} MB descomprimidos. No se abre.`);
    }

    if (b.readUInt32LE(inicioLocal) !== LOCAL) {
      throw new Error(`La entrada «${nombre}» apunta a una posición que no es una cabecera.`);
    }
    // La cabecera local repite el nombre y trae su propio bloque extra, que
    // no tiene por qué medir lo mismo que el del índice. Hay que leer los
    // dos largos de aquí, no reutilizar los de arriba.
    const inicio = inicioLocal + 30
      + b.readUInt16LE(inicioLocal + 26)
      + b.readUInt16LE(inicioLocal + 28);
    const bruto = b.subarray(inicio, inicio + comprimido);

    if (metodo === 0) {
      archivos.push({ nombre, contenido: Buffer.from(bruto) });
    } else if (metodo === 8) {
      archivos.push({ nombre, contenido: inflateRawSync(bruto) });
    } else {
      throw new Error(`«${nombre}» viene comprimido con el método ${metodo}, que no se sabe abrir.`);
    }
  }

  return archivos;
}
