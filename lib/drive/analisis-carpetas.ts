/**
 * El legajo de cada OC de una carpeta madre: qué documentos tiene, qué le
 * falta y qué centro de costo le toca. Junta lo de `legajo-carpeta.ts` con
 * lo que dicen CG y el cuadro de aprobaciones; lo usa `scripts/carpetas-oc.mts`.
 */

import {
  asignarCentroDeCosto, documentosDeOC, textoDeDocumentos,
  type Asignacion, type CentroDeCosto, type DocumentosDeOC,
} from "./legajo-carpeta.ts";

export type FuenteCC = "CG" | "CUADRO" | "MANUAL" | Asignacion["fuente"];

export type OCParaAnalizar = {
  /** Identifica la carpeta de la OC (una OC puede tener dos carpetas). */
  clave: string; oc: string; tipo: "OC" | "OS"; proyectoCarpeta: string;
  archivos: Array<{ claves: string[] }>;
};

export type AnalisisOC = {
  docs: DocumentosDeOC;
  documentos: string;
  cc: CentroDeCosto & { fuente: FuenteCC };
};

export type ProyectoCC = Asignacion & {
  proyectoCarpeta: string; ocs: number; ocsEnCg: number; manual: boolean;
};

/**
 * `ccPorOc`: el centro de costo que ya tiene cada OC (de CG si es nacional;
 * del cuadro si es importación). `manual`: las carpetas de proyecto que
 * Contabilidad corrigió a mano (proyecto_centro_costo con fuente MANUAL).
 */
export function analizarOCs(p: {
  ocs: OCParaAnalizar[];
  importacion: boolean;
  ccPorOc: Map<string, CentroDeCosto>;
  manual: Map<string, CentroDeCosto>;
  catalogo: Array<CentroDeCosto & { ocs: number }>;
}): { porOc: Map<string, AnalisisOC>; proyectos: ProyectoCC[] } {
  const fuenteDeLaOC: FuenteCC = p.importacion ? "CUADRO" : "CG";

  // La regla de cada carpeta de proyecto, con lo que dicen CG o el cuadro de sus OC.
  const deProyecto = new Map<string, OCParaAnalizar[]>();
  for (const o of p.ocs) {
    const k = o.proyectoCarpeta.trim();
    deProyecto.set(k, [...(deProyecto.get(k) ?? []), o]);
  }
  const proyectos: ProyectoCC[] = [];
  const regla = new Map<string, ProyectoCC>();
  for (const [proyecto, lista] of [...deProyecto.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const unicas = [...new Set(lista.map(o => o.oc))];
    const votos = new Map<string, CentroDeCosto & { ocs: number }>();
    for (const oc of unicas) {
      const cc = p.ccPorOc.get(oc);
      if (!cc?.nombre) continue;
      const v = votos.get(cc.nombre) ?? { ...cc, ocs: 0 };
      v.ocs++;
      votos.set(cc.nombre, v);
    }
    const enCG = [...votos.values()];
    const ocsEnCg = enCG.reduce((s, v) => s + v.ocs, 0);
    const manual = p.manual.get(proyecto);
    const a: Asignacion = manual
      ? { ...manual, fuente: "NOMBRE", detalle: "corregido a mano por Contabilidad", revisar: false }
      : asignarCentroDeCosto(proyecto, enCG, p.catalogo);
    const fila: ProyectoCC = { ...a, proyectoCarpeta: proyecto, ocs: unicas.length, ocsEnCg, manual: !!manual };
    proyectos.push(fila);
    regla.set(proyecto, fila);
  }

  const porOc = new Map<string, AnalisisOC>();
  for (const o of p.ocs) {
    const docs = documentosDeOC(o.archivos, { servicio: o.tipo === "OS", importacion: p.importacion });
    const propio = p.ccPorOc.get(o.oc);
    const r = regla.get(o.proyectoCarpeta.trim())!;
    const cc: AnalisisOC["cc"] = propio?.nombre
      ? { ...propio, fuente: fuenteDeLaOC }
      : r.nombre
        ? { codigo: r.codigo, nombre: r.nombre, fuente: r.manual ? "MANUAL" : r.fuente }
        : { codigo: "", nombre: "", fuente: "SIN ASIGNAR" };
    porOc.set(o.clave, { docs, documentos: textoDeDocumentos(docs.cuenta), cc });
  }
  return { porOc, proyectos };
}

/**
 * El centro de costo de cada OC según CG: el de más líneas (una OC puede
 * repartirse en varios; manda el principal, como en vinculos_oc()).
 */
export function ccPrincipalPorOc(filas: Array<{ oc: string; cc_codigo: string | null; cc_nombre: string | null; lineas: number | null }>): Map<string, CentroDeCosto> {
  const mejor = new Map<string, { cc: CentroDeCosto; lineas: number }>();
  for (const f of filas) {
    if (!f.cc_nombre) continue;
    const v = mejor.get(f.oc);
    const lineas = Number(f.lineas ?? 0);
    if (!v || lineas > v.lineas) mejor.set(f.oc, { cc: { codigo: f.cc_codigo ?? "", nombre: f.cc_nombre }, lineas });
  }
  return new Map([...mejor.entries()].map(([oc, v]) => [oc, v.cc]));
}

/** El catálogo de centros de costo de CG, con cuántas OC tiene cada uno. */
export function catalogoDeCG(filas: Array<{ oc: string; cc_codigo: string | null; cc_nombre: string | null }>): Array<CentroDeCosto & { ocs: number }> {
  const ocs = new Map<string, { cc: CentroDeCosto; ocs: Set<string> }>();
  for (const f of filas) {
    if (!f.cc_nombre) continue;
    const k = `${f.cc_codigo ?? ""}|${f.cc_nombre}`;
    const v = ocs.get(k) ?? { cc: { codigo: f.cc_codigo ?? "", nombre: f.cc_nombre }, ocs: new Set() };
    v.ocs.add(f.oc);
    ocs.set(k, v);
  }
  return [...ocs.values()].map(v => ({ ...v.cc, ocs: v.ocs.size }));
}
