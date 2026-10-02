/**
 * Lo que se deduce de una carpeta de OC más allá de sus comprobantes:
 *   · qué documentos tiene y cuál le FALTA (la misma regla que el legajo de
 *     `LegajoPorOC.gs`: factura siempre; guía si es un bien; acta si es un
 *     servicio; DAM y cuadro de costeo si es importación);
 *   · el centro de costo de cada carpeta de proyecto, para las OC que no
 *     están en la base de Control de Gestión.
 */

import { textoPlano } from "./carpetas-oc.ts";

// ── Documentos ──

/** Los documentos del legajo, en el orden de la vista de Apps Script. */
export const DOCUMENTOS: Array<{ clave: string; nombre: string }> = [
  { clave: "FACTURA", nombre: "Factura" },
  { clave: "OC", nombre: "OC" },
  { clave: "SWIFT", nombre: "SWIFT" },
  { clave: "GUIA", nombre: "Guía de remisión" },
  { clave: "DAM", nombre: "DAM" },
  // Solo importaciones: el cuadro de costeo que arma COMEX (pedido de Contabilidad, 02/10/2026).
  { clave: "COSTEO", nombre: "Cuadro de costeo" },
  { clave: "REQ", nombre: "Requerimiento" },
  { clave: "CONTRATO", nombre: "Contrato" },
  { clave: "COTIZACION", nombre: "Cotización" },
  { clave: "PROFORMA", nombre: "Proforma" },
  { clave: "CORREO", nombre: "Correos" },
  { clave: "ACTA", nombre: "Acta de conformidad" },
];

const POR_PARECE: Record<string, string> = {
  "ORDEN DE COMPRA/SERVICIO": "OC", "SWIFT": "SWIFT", "GUÍA": "GUIA", "DAM": "DAM", "REQUERIMIENTO": "REQ",
  "CONTRATO": "CONTRATO", "COTIZACIÓN": "COTIZACION", "PROFORMA": "PROFORMA", "CORREO / CAPTURA": "CORREO",
  "ACTA DE CONFORMIDAD": "ACTA", "DOCUMENTO DE IMPORTACIÓN": "DAM", "CUADRO DE COSTEO": "COSTEO",
};

/**
 * Qué documento del legajo es un archivo, por lo que parece por el nombre y,
 * si se leyó por dentro, por lo que trae (un PDF puede traer factura y guía).
 */
export function clavesDeArchivo(parece: string, clavesLeidas: string[] = []): string[] {
  const p = String(parece ?? "").replace(/ \(por la carpeta\)$/, "");
  const salida = new Set<string>(clavesLeidas.filter(c => DOCUMENTOS.some(d => d.clave === c)));
  if (/^(FACTURA|COMPROBANTE|RECIBO POR|BOLETA|NOTA DE|XML$|INVOICE)/.test(p)) salida.add("FACTURA");
  else if (POR_PARECE[p]) salida.add(POR_PARECE[p]);
  return [...salida];
}

export type DocumentosDeOC = {
  /** Cuántos archivos de cada documento: { Factura: 2, Guía: 1, … } (solo los que hay). */
  cuenta: Record<string, number>;
  /** Los que faltan, por nombre: ["Guía", "DAM"]. Vacío = completo. */
  leFalta: string[];
  /** «OK» con todo, «INCOMPLETA» si falta algo, «VACÍA» si la carpeta no tiene archivos. */
  estado: "OK" | "INCOMPLETA" | "VACÍA";
};

export function documentosDeOC(
  archivos: Array<{ claves: string[] }>,
  o: { servicio: boolean; importacion: boolean },
): DocumentosDeOC {
  const cuenta: Record<string, number> = {};
  for (const a of archivos) for (const c of new Set(a.claves)) {
    const nombre = DOCUMENTOS.find(d => d.clave === c)?.nombre;
    if (nombre) cuenta[nombre] = (cuenta[nombre] ?? 0) + 1;
  }
  // Guía si es un bien, acta si es un servicio. El tipo sale del nombre de
  // la carpeta («OC …» u «OS …»), que no siempre acierta: hay servicios con
  // carpeta «OC». Si la carpeta ya trae una de las dos, esa dice el tipo y
  // no se pide la otra (0242-2026: carpeta «OC» con acta de un servicio).
  const nombreDe = (clave: string) => DOCUMENTOS.find(d => d.clave === clave)!.nombre;
  const segundo = cuenta[nombreDe("GUIA")] || cuenta[nombreDe("ACTA")] ? [] : [o.servicio ? "ACTA" : "GUIA"];
  const requeridos = ["FACTURA", ...segundo, ...(o.importacion ? ["DAM", "COSTEO"] : [])];
  const leFalta = requeridos.map(nombreDe).filter(n => !cuenta[n]);
  const estado = archivos.length === 0 ? "VACÍA" : leFalta.length ? "INCOMPLETA" : "OK";
  return { cuenta, leFalta, estado };
}

/** «Factura 2 · OC 1 · Guía 1» en el orden del legajo. */
export function textoDeDocumentos(cuenta: Record<string, number>): string {
  return DOCUMENTOS.filter(d => cuenta[d.nombre]).map(d => `${d.nombre} ${cuenta[d.nombre]}`).join(" · ");
}

// ── Centro de costo por carpeta de proyecto ──

export type CentroDeCosto = { codigo: string; nombre: string };

export const AREA_ADMINISTRATIVA: CentroDeCosto = { codigo: "-", nombre: "ÁREA ADMINISTRATIVA" };

export type Asignacion = CentroDeCosto & {
  /** CG: la mayoría de sus OC en la base de CG. ADMINISTRATIVO: carpeta administrativa. NOMBRE: por el nombre. */
  fuente: "CG" | "ADMINISTRATIVO" | "NOMBRE" | "SIN ASIGNAR";
  /** Por qué, en una frase (para revisar). */
  detalle: string;
  /** Si conviene que alguien lo mire antes de usarlo. */
  revisar: boolean;
};

/**
 * Por ahora todo lo administrativo va al área administrativa general
 * (pedido de Contabilidad, 01/10/2026): «ÁREA ADMINISTRATIVA SISTEMAS» y
 * las demás cuentan como «ÁREA ADMINISTRATIVA».
 */
export function agruparAdministrativo(cc: CentroDeCosto): CentroDeCosto {
  return /^AREA ADMINISTRATIVA\b/.test(textoPlano(cc.nombre)) ? AREA_ADMINISTRATIVA : cc;
}

const ES_ADMINISTRATIVA = /(^| )(ADM|ADMIN|ADMINISTRACION|ADMINISTRATIVA|ADMINISTRATIVO|GENERAL|GENERALES|GERENCIA|OFICINA|OFICINAS)( |$)/;

/** Palabras que no distinguen un proyecto de otro. */
const VACIAS = new Set(["DE", "DEL", "LA", "EL", "LOS", "LAS", "Y", "E", "EN", "PARA", "POR", "CON", "A", "AL",
  "PROYECTO", "PROY", "IE", "I", "II", "III", "LIMA", "VARIOS"]);

/** Las palabras de un nombre, sin vacías, con los números sin ceros a la izquierda («PAQ 05» = «PAQ 5»). */
function palabras(nombre: string): string[] {
  return textoPlano(nombre).split(" ")
    .map(p => /^\d+$/.test(p) ? String(Number(p)) : p)
    .filter(p => p && !VACIAS.has(p) && !/^\d{4}$/.test(p));
}

/**
 * El centro de costo de una carpeta de proyecto («01) TALLERES
 * ESPECIALIZADOS», «MEDRANO», «PAQ 2 CHINA»), en este orden:
 *   1. CG: si la carpeta tiene 3 o más OC en la base de CG y el 60% o más
 *      van al mismo centro de costo (con lo administrativo agrupado).
 *   2. ADMINISTRATIVO: si el nombre dice ADM, GENERAL, GERENCIA, OFICINA.
 *   3. NOMBRE: el centro de costo del catálogo cuyo nombre comparte las
 *      palabras más distintivas («MEDRANO» → «… JUAN ESPINOZA MEDRANO …»).
 *      Si empatan varios, el más usado, marcado para revisar.
 */
export function asignarCentroDeCosto(
  proyecto: string,
  enCG: Array<CentroDeCosto & { ocs: number }>,
  catalogo: Array<CentroDeCosto & { ocs: number }>,
): Asignacion {
  // Lo que dice CG de sus OC (con lo administrativo agrupado).
  const votos = new Map<string, { cc: CentroDeCosto; n: number }>();
  for (const c of enCG) {
    if (!c.nombre) continue;
    const g = agruparAdministrativo(c);
    const v = votos.get(g.nombre) ?? { cc: g, n: 0 };
    v.n += c.ocs;
    votos.set(g.nombre, v);
  }
  const total = [...votos.values()].reduce((s, v) => s + v.n, 0);
  const mejor = [...votos.values()].sort((a, b) => b.n - a.n)[0];
  const enCGTexto = () => [...votos.values()].sort((a, b) => b.n - a.n).map(v => `${v.cc.nombre} ${v.n}`).join(", ");
  const porNombre = coincidenciaPorNombre(proyecto, catalogo);

  // 1. CG: 3 o más OC con el 60% o más al mismo centro de costo, o 1-2 OC que coinciden todas.
  if (mejor && ((total >= 3 && mejor.n / total >= 0.6) || (total <= 2 && mejor.n === total))) {
    const parte = mejor.n / total;
    // Si la mayoría no es clara y el nombre de la carpeta señala otro centro
    // de costo que CG también usa en sus OC, manda el nombre («MATERIAL
    // CONCRETO PARA MATEMATICA»: 3 INTERCOMPANIES y 2 DES - MATERIAL CONCRETO).
    const delNombre = porNombre && votos.get(porNombre.c.nombre);
    if (parte < 0.8 && porNombre && delNombre && porNombre.c.nombre !== mejor.cc.nombre) {
      return { codigo: porNombre.c.codigo, nombre: porNombre.c.nombre, fuente: "NOMBRE", revisar: true,
        detalle: `por el nombre (${porNombre.comunes.join(", ")}), que CG también usa; en CG: ${enCGTexto()}` };
    }
    return { ...mejor.cc, fuente: "CG", revisar: parte < 0.8 || total < 3,
      detalle: `${mejor.n} de ${total} OC de la carpeta están en CG con este centro de costo` };
  }

  // 2. Carpeta administrativa.
  if (ES_ADMINISTRATIVA.test(textoPlano(proyecto))) {
    return { ...AREA_ADMINISTRATIVA, fuente: "ADMINISTRATIVO", revisar: false,
      detalle: "carpeta administrativa: por ahora al área administrativa general" };
  }

  // 3. Por el nombre.
  if (porNombre) {
    return { codigo: porNombre.c.codigo, nombre: porNombre.c.nombre, fuente: "NOMBRE", revisar: porNombre.empatados > 0 || total > 0,
      detalle: `por el nombre (${porNombre.comunes.join(", ")})` +
        (porNombre.empatados ? `; empata con ${porNombre.empatados} más, se eligió el más usado` : "") +
        (total > 0 ? `; en CG: ${enCGTexto()}` : "") };
  }
  return { codigo: "", nombre: "", fuente: "SIN ASIGNAR", revisar: true,
    detalle: total > 0 ? `el nombre no coincide con ningún centro de costo y en CG están repartidas (${enCGTexto()})`
      : "sin OC en CG y el nombre no coincide con ningún centro de costo" };
}

/**
 * El centro de costo del catálogo cuyo nombre comparte las palabras más
 * distintivas con el de la carpeta (cada palabra pesa según lo rara que es
 * en el catálogo). Si empatan varios, el más usado.
 */
function coincidenciaPorNombre(proyecto: string, catalogo: Array<CentroDeCosto & { ocs: number }>) {
  const deCatalogo = catalogo.filter(c => c.nombre && !/^AREA ADMINISTRATIVA\b/.test(textoPlano(c.nombre)));
  const frecuencia = new Map<string, number>();
  for (const c of deCatalogo) for (const p of new Set(palabras(c.nombre))) frecuencia.set(p, (frecuencia.get(p) ?? 0) + 1);
  const peso = (p: string) => Math.log(1 + deCatalogo.length / (frecuencia.get(p) ?? deCatalogo.length));
  const buscadas = new Set(palabras(proyecto));
  const puntajes = deCatalogo.map(c => {
    const suyas = new Set(palabras(c.nombre));
    const comunes = [...buscadas].filter(p => suyas.has(p));
    // Una palabra que es solo un número («2», «5») no basta para elegir.
    const distintiva = comunes.some(p => !/^\d+$/.test(p));
    return { c, puntaje: distintiva ? comunes.reduce((s, p) => s + peso(p), 0) : 0, comunes };
  }).filter(x => x.puntaje > 0).sort((a, b) => b.puntaje - a.puntaje || b.c.ocs - a.c.ocs);
  if (!puntajes.length) return null;
  const top = puntajes[0];
  return { c: top.c, comunes: top.comunes, empatados: puntajes.filter(x => Math.abs(x.puntaje - top.puntaje) < 1e-9).length - 1 };
}
