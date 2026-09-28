// Qué consultar en el portal de CPE, y en qué tandas
//
// El scraper (`scripts/descargar-cpe.mts`) maneja un navegador; esto no toca
// ni red ni navegador a propósito. Acá vive lo que sí se puede probar sin
// SUNAT delante: el catálogo de tipos de consulta —cómo se llama cada uno en
// el portal y por qué entrada del menú se llega—, el corte del rango de
// fechas en tandas, y los períodos que ese rango abarca.
//
// Se separó al agregar las boletas: hasta entonces el catálogo eran seis
// nombres sueltos en una variable de entorno y el menú estaba escrito a mano
// dentro del script, lo que servía mientras todos los tipos vivieran en la
// MISMA pantalla. Las boletas no tienen por qué vivir ahí.

/** Un tipo de consulta del portal, con cómo llegar a él. */
export interface Consulta {
  /** El nombre corto con el que se pide (lo que va en TIPOS_CONSULTA). */
  nombre: string;
  /** La etiqueta exacta de la opción en el combobox «Tipo de Consulta». */
  etiqueta: string;
  /**
   * Los textos del menú de SOL a los que hay que hacer clic, en orden, para
   * abrir la pantalla donde vive este tipo.
   */
  menu: string[];
  /**
   * El código interno de SUNAT (el `input[name=tipoConsulta]` oculto), cuando
   * está confirmado contra el portal real. Solo sirve para verificar en el
   * log que quedó puesto el tipo correcto; nunca se escribe a mano.
   */
  codigo: string | null;
  /**
   * false mientras la etiqueta y el menú sean una suposición: el script avisa
   * en el log y —si la opción no está en el combobox— salta el tipo en vez de
   * bajar otra cosa creyendo que es esta.
   */
  confirmado: boolean;
}

/** La pantalla de facturas y notas: la que ya se venía usando. */
const MENU_FACTURAS_Y_NOTAS = ["Empresas", "Consulta de Facturas y Notas Electrónicas"];

/**
 * La pantalla de boletas.
 *
 * SIN CONFIRMAR. El módulo que se usa hoy es «Consulta de Facturas y Notas
 * Electrónicas», que por diseño no lista boletas: sus seis tipos son FE, NC y
 * ND (códigos 10, 11, 13, 14, 15, 16 confirmados en
 * `docs/scraper-cpe-hallazgos-tecnicos.md`). Con el acceso ampliado de SOL las
 * boletas pueden aparecer de dos formas, y desde acá no se puede saber cuál:
 *
 *   a) como opciones nuevas del MISMO combobox —entonces basta que la
 *      etiqueta sea la correcta y este menú no se usa—, o
 *   b) en una entrada de menú aparte.
 *
 * Por eso el menú se deja sobreescribible por entorno (MENU_BOLETAS) y la
 * corrida en modo depuración imprime el menú real y las opciones reales del
 * combobox: con esa evidencia se corrige acá, en un solo sitio.
 */
const MENU_BOLETAS = ["Empresas", "Consulta Integrada de Comprobantes de Pago"];

/**
 * Los tipos que el scraper sabe pedir.
 *
 * El portal no tiene un «todo junto»: cada uno es una consulta aparte. El
 * orden es el de siempre primero (facturas y notas, que están probadas) y las
 * boletas al final, para que un run que las falle no arrastre a las demás.
 */
export const CATALOGO: Consulta[] = [
  { nombre: "FE Emitidas",  etiqueta: "FE Emitidas",  menu: MENU_FACTURAS_Y_NOTAS, codigo: "10", confirmado: true },
  { nombre: "FE Recibidas", etiqueta: "FE Recibidas", menu: MENU_FACTURAS_Y_NOTAS, codigo: "11", confirmado: true },
  { nombre: "NC Emitidas",  etiqueta: "NC Emitidas",  menu: MENU_FACTURAS_Y_NOTAS, codigo: "13", confirmado: true },
  { nombre: "NC Recibidas", etiqueta: "NC Recibidas", menu: MENU_FACTURAS_Y_NOTAS, codigo: "14", confirmado: true },
  { nombre: "ND Emitidas",  etiqueta: "ND Emitidas",  menu: MENU_FACTURAS_Y_NOTAS, codigo: "15", confirmado: true },
  { nombre: "ND Recibidas", etiqueta: "ND Recibidas", menu: MENU_FACTURAS_Y_NOTAS, codigo: "16", confirmado: true },
  // Las boletas, con el acceso ampliado. Etiqueta y menú SIN CONFIRMAR: ver
  // el comentario de MENU_BOLETAS.
  { nombre: "BE Emitidas",  etiqueta: "BE Emitidas",  menu: MENU_BOLETAS, codigo: null, confirmado: false },
  { nombre: "BE Recibidas", etiqueta: "BE Recibidas", menu: MENU_BOLETAS, codigo: null, confirmado: false },
];

/** Sin acentos, sin mayúsculas y sin espacios de más: para comparar nombres. */
export function normalizar(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * El tipo que corresponde a un nombre pedido, o `null` si no está en el
 * catálogo.
 *
 * Devolver `null` en vez de inventar algo es el punto: un nombre mal escrito
 * en el workflow tiene que aparecer como un error claro, no como una consulta
 * que baja el tipo equivocado.
 *
 * `catalogo` se pasa cuando ya viene ajustado por `conMenuDeBoletas`: así el
 * tipo que se devuelve trae el menú corregido y no el de por omisión.
 */
export function consultaDe(nombre: string, catalogo: Consulta[] = CATALOGO): Consulta | null {
  const n = normalizar(nombre);
  return catalogo.find(c => normalizar(c.nombre) === n)
    ?? catalogo.find(c => normalizar(c.etiqueta) === n)
    ?? null;
}

/**
 * Reemplaza el menú de las boletas por el que diga el entorno, sin tocar el
 * de facturas y notas.
 *
 * Es el tornillo que se ajusta cuando la corrida de depuración diga por dónde
 * se entra de verdad: se prueba con un input del workflow y, cuando funcione,
 * se escribe en `MENU_BOLETAS` de una vez.
 */
export function conMenuDeBoletas(menu: string[]): Consulta[] {
  if (menu.length === 0) return CATALOGO;
  return CATALOGO.map(c => (c.codigo === null ? { ...c, menu } : c));
}

// ── Fechas: dd/mm/yyyy, que es lo que habla el portal ──────────────

/**
 * Lee una fecha dd/mm/yyyy a un `Date` en UTC.
 *
 * En UTC y no en hora local a propósito: el runner de GitHub corre en UTC y
 * una máquina en Lima no; construir estas fechas con el constructor local
 * hace que «01/08/2026» sea el 31 de julio en una de las dos, y el corte por
 * mes saldría desplazado un día según dónde corra.
 */
export function aFecha(texto: string): Date | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texto.trim());
  if (!m) return null;
  const [d, mes, a] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mes < 1 || mes > 12 || d < 1 || d > 31) return null;
  const f = new Date(Date.UTC(a, mes - 1, d));
  // Rebota el 31 de febrero y compañía: si el Date se corrió de mes, la fecha
  // no existía.
  if (f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== d) return null;
  return f;
}

/** Escribe un `Date` como dd/mm/yyyy, que es lo que espera el formulario. */
export function aTexto(f: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(f.getUTCDate())}/${p(f.getUTCMonth() + 1)}/${f.getUTCFullYear()}`;
}

/** Un trozo del rango, ya listo para poner en el formulario. */
export interface Tanda { desde: string; hasta: string }

/**
 * Parte un rango de fechas en una tanda por mes calendario.
 *
 * Por mes y no por semana: el límite de 25 filas de la grilla —la razón por la
 * que antes se partía por semanas— ya está resuelto con `rowCount` y la
 * descarga por índice, y un mes cargado entra cómodo en el workflow (§5 de
 * `docs/scraper-cpe-hallazgos-tecnicos.md`). Pero pedir dos meses de una sola
 * consulta sí es distinto: rangos anchos son justo lo que disparó el «User
 * rate limit exceeded» de SUNAT al rellenar meses viejos.
 *
 * Además cada tanda cae dentro de un solo período tributario, que es como se
 * mira el resultado después.
 *
 * Si el rango no se entiende o está al revés, devuelve una sola tanda con lo
 * que llegó: el que decide si eso es un error es el script, que tiene el log.
 */
export function tandasPorMes(desde: string, hasta: string): Tanda[] {
  const a = aFecha(desde);
  const b = aFecha(hasta);
  if (!a || !b || a > b) return [{ desde, hasta }];

  const tandas: Tanda[] = [];
  let cursor = a;
  while (cursor <= b) {
    // El último día del mes del cursor: el día 0 del mes siguiente.
    const finDeMes = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    const fin = finDeMes < b ? finDeMes : b;
    tandas.push({ desde: aTexto(cursor), hasta: aTexto(fin) });
    cursor = new Date(Date.UTC(fin.getUTCFullYear(), fin.getUTCMonth(), fin.getUTCDate() + 1));
  }
  return tandas;
}

/**
 * Los períodos tributarios (yyyymm) que abarca el rango, en orden.
 *
 * Es con lo que se filtra la hoja del rango: la base guarda el período de
 * cada comprobante, así que no hace falta volver a mirar fechas.
 */
export function periodosDelRango(desde: string, hasta: string): string[] {
  const a = aFecha(desde);
  const b = aFecha(hasta);
  if (!a || !b || a > b) return [];

  const periodos: string[] = [];
  let cursor = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1));
  const tope = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), 1));
  while (cursor <= tope) {
    periodos.push(`${cursor.getUTCFullYear()}${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`);
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return periodos;
}

/** `202608` → `2026-08`, que es como se lee en el nombre de un archivo. */
export function periodoLegible(periodo: string): string {
  return /^\d{6}$/.test(periodo) ? `${periodo.slice(0, 4)}-${periodo.slice(4, 6)}` : periodo;
}

/**
 * El nombre de la hoja de un rango de períodos.
 *
 * Lleva el rango en el nombre porque es una hoja APARTE de la histórica
 * («COMPROBANTES SUNAT - DETALLE», que trae todo). `publicarHoja` busca por
 * nombre para reemplazar en vez de duplicar, así que el nombre tiene que ser
 * estable: el mismo rango tiene que dar siempre el mismo nombre, o cada
 * corrida crearía una hoja nueva al lado de la anterior.
 */
export function nombreDeHojaDelRango(periodos: string[]): string | null {
  if (periodos.length === 0) return null;
  const orden = [...periodos].sort();
  const primero = periodoLegible(orden[0]);
  const ultimo = periodoLegible(orden[orden.length - 1]);
  const rango = primero === ultimo ? primero : `${primero} a ${ultimo}`;
  return `COMPROBANTES SUNAT - DETALLE ${rango}`;
}
