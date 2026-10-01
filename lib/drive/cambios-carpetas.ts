/**
 * Qué cambió en una carpeta madre desde la corrida anterior: la foto de
 * ayer (lo que quedó en la base) contra la de hoy (lo que se acaba de
 * recorrer). Funciones puras; las usa `scripts/carpetas-oc.mts`.
 *
 * Solo tiene sentido con dos fotos COMPLETAS: si una corrida leyó una sola
 * subcarpeta o no pudo abrir alguna carpeta, todo lo que no vio parecería
 * «eliminado». Quien llama decide si compara.
 */

export type FotoOC = {
  oc: string; carpetaUrl: string; carpetaNombre: string; proveedor: string;
  /** Documentos que le faltan, separados por coma («Guía, DAM»); vacío = completo. */
  leFalta: string; estado: string;
};
export type FotoArchivo = { oc: string; carpetaUrl: string; url: string; nombre: string; modificado: string };

export type TipoCambio =
  | "OC NUEVA" | "OC YA NO ESTÁ" | "OC RENOMBRADA"
  | "ARCHIVO NUEVO" | "ARCHIVO ELIMINADO" | "ARCHIVO MODIFICADO" | "ARCHIVO RENOMBRADO"
  | "COMPLETÓ" | "AHORA LE FALTA" | "LEGAJO COMPLETO";

export type Cambio = { oc: string; carpetaUrl: string; tipo: TipoCambio; detalle: string; enlace: string };

const lista = (s: string) => String(s ?? "").split(",").map(x => x.trim()).filter(Boolean);

export function compararFotos(
  antes: { ocs: FotoOC[]; archivos: FotoArchivo[] },
  ahora: { ocs: FotoOC[]; archivos: FotoArchivo[] },
): Cambio[] {
  const cambios: Cambio[] = [];
  const ocAntes = new Map(antes.ocs.map(o => [o.carpetaUrl, o]));
  const ocAhora = new Map(ahora.ocs.map(o => [o.carpetaUrl, o]));

  for (const o of ahora.ocs) {
    const v = ocAntes.get(o.carpetaUrl);
    if (!v) {
      cambios.push({ oc: o.oc, carpetaUrl: o.carpetaUrl, tipo: "OC NUEVA", enlace: o.carpetaUrl,
        detalle: `${o.carpetaNombre}${o.leFalta ? ` — le falta: ${o.leFalta}` : ""}` });
      continue;
    }
    if (v.carpetaNombre !== o.carpetaNombre) {
      cambios.push({ oc: o.oc, carpetaUrl: o.carpetaUrl, tipo: "OC RENOMBRADA", enlace: o.carpetaUrl,
        detalle: `«${v.carpetaNombre}» → «${o.carpetaNombre}»` });
    }
    const faltaba = lista(v.leFalta), falta = lista(o.leFalta);
    const completo = faltaba.filter(d => !falta.includes(d));
    const nuevo = falta.filter(d => !faltaba.includes(d));
    if (completo.length) {
      cambios.push({ oc: o.oc, carpetaUrl: o.carpetaUrl, tipo: falta.length ? "COMPLETÓ" : "LEGAJO COMPLETO",
        enlace: o.carpetaUrl, detalle: `llegó: ${completo.join(", ")}${falta.length ? ` — aún falta: ${falta.join(", ")}` : ""}` });
    }
    if (nuevo.length) {
      cambios.push({ oc: o.oc, carpetaUrl: o.carpetaUrl, tipo: "AHORA LE FALTA", enlace: o.carpetaUrl,
        detalle: `${nuevo.join(", ")} (antes estaba)` });
    }
  }
  for (const v of antes.ocs) {
    if (!ocAhora.has(v.carpetaUrl)) {
      cambios.push({ oc: v.oc, carpetaUrl: v.carpetaUrl, tipo: "OC YA NO ESTÁ", enlace: v.carpetaUrl,
        detalle: `${v.carpetaNombre} (se borró, se movió fuera de la carpeta madre o se le quitó el acceso)` });
    }
  }

  // Los archivos, solo dentro de las OC que siguen: los de una OC nueva o
  // que ya no está los cuenta su OC.
  const sigue = (carpetaUrl: string) => ocAntes.has(carpetaUrl) && ocAhora.has(carpetaUrl);
  const archAntes = new Map(antes.archivos.filter(a => sigue(a.carpetaUrl)).map(a => [a.url, a]));
  const archAhora = new Map(ahora.archivos.filter(a => sigue(a.carpetaUrl)).map(a => [a.url, a]));
  for (const a of archAhora.values()) {
    const v = archAntes.get(a.url);
    if (!v) cambios.push({ oc: a.oc, carpetaUrl: a.carpetaUrl, tipo: "ARCHIVO NUEVO", detalle: a.nombre, enlace: a.url });
    else if (v.nombre !== a.nombre) {
      cambios.push({ oc: a.oc, carpetaUrl: a.carpetaUrl, tipo: "ARCHIVO RENOMBRADO", detalle: `«${v.nombre}» → «${a.nombre}»`, enlace: a.url });
    } else if (v.modificado && a.modificado && v.modificado !== a.modificado) {
      cambios.push({ oc: a.oc, carpetaUrl: a.carpetaUrl, tipo: "ARCHIVO MODIFICADO", detalle: a.nombre, enlace: a.url });
    }
  }
  for (const v of archAntes.values()) {
    if (!archAhora.has(v.url)) cambios.push({ oc: v.oc, carpetaUrl: v.carpetaUrl, tipo: "ARCHIVO ELIMINADO", detalle: v.nombre, enlace: v.url });
  }
  return cambios.sort((x, y) => x.oc.localeCompare(y.oc) || x.tipo.localeCompare(y.tipo) || x.detalle.localeCompare(y.detalle));
}
