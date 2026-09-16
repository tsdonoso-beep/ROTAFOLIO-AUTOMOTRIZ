// Un ZIP mínimo, para no traer una dependencia por tres archivos
//
// Un .docx es un ZIP con XML adentro: nada más. Escribirlo a mano son unas
// cien líneas y evita meter una librería de las que después hay que
// actualizar. El resto del proyecto ya funciona así —a la API de Sheets se
// le habla directamente— y esto sigue el mismo criterio.
//
// Se guarda sin comprimir (método 0, «store»). Un memo pesa unos pocos
// kilobytes; comprimirlo ahorraría nada y añadiría la única parte del
// formato que sí es difícil de hacer bien.

/**
 * CRC-32, que el formato exige por entrada. Sin él, Word abre el archivo y
 * dice que está dañado.
 */
const TABLA = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(datos: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < datos.length; i++) c = TABLA[(c ^ datos[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface EntradaZip {
  nombre: string;
  contenido: string;
}

function u16(n: number): number[] { return [n & 0xff, (n >>> 8) & 0xff]; }
function u32(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}

/**
 * Arma el ZIP.
 *
 * La fecha va fija a 1980-01-01, el cero del formato. Un .docx generado dos
 * veces con los mismos datos da el mismo archivo, byte por byte, y eso hace
 * que se pueda comprobar en un test.
 */
export function armarZip(entradas: EntradaZip[]): Uint8Array {
  const cod = new TextEncoder();
  const partes: number[] = [];
  const central: number[] = [];
  let desplazamiento = 0;

  for (const e of entradas) {
    const nombre = cod.encode(e.nombre);
    const datos = cod.encode(e.contenido);
    const suma = crc32(datos);

    const local = [
      ...u32(0x04034b50),        // firma de cabecera local
      ...u16(20),                // versión necesaria
      ...u16(0),                 // banderas
      ...u16(0),                 // método: sin comprimir
      ...u16(0), ...u16(0x21),   // hora y fecha: 1980-01-01
      ...u32(suma),
      ...u32(datos.length),      // comprimido
      ...u32(datos.length),      // sin comprimir
      ...u16(nombre.length),
      ...u16(0),
      ...nombre, ...datos,
    ];
    partes.push(...local);

    central.push(
      ...u32(0x02014b50),
      ...u16(20), ...u16(20),
      ...u16(0), ...u16(0),
      ...u16(0), ...u16(0x21),
      ...u32(suma),
      ...u32(datos.length), ...u32(datos.length),
      ...u16(nombre.length),
      ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0),
      ...u32(desplazamiento),
      ...nombre,
    );

    desplazamiento += local.length;
  }

  const fin = [
    ...u32(0x06054b50),
    ...u16(0), ...u16(0),
    ...u16(entradas.length), ...u16(entradas.length),
    ...u32(central.length),
    ...u32(desplazamiento),
    ...u16(0),
  ];

  return new Uint8Array([...partes, ...central, ...fin]);
}

/**
 * Escapa lo que va dentro de una etiqueta XML.
 *
 * Los nombres reales traen eñes y tildes —el codificador los maneja— pero
 * también ampersands: «TALLERES EPT I & II» rompería el documento y Word lo
 * daría por corrupto sin decir por qué.
 */
export function escaparXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
