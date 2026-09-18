// Preparar los comprobantes leídos para guardarlos
//
// El parser (`cpe-xml.ts`) devuelve lo que dice el XML, tal cual. Antes de
// guardarlo hay que decidir dos cosas que el XML no dice de frente y que
// dependen de quién es la empresa: si el comprobante es recibido o emitido,
// y a qué período tributario pertenece. Eso se resuelve acá, sin tocar base
// ni red, para poder probarlo.

import type { ComprobanteCpe } from "./cpe-xml.ts";

/** Un ítem, listo para el jsonb que espera `guardar_cpe`. */
export interface ItemLote {
  linea: number | null;
  descripcion: string | null;
  cantidad: number | null;
  unidad: string | null;
  precioUnitario: number | null;
  importe: number | null;
}

/** Un comprobante, listo para el jsonb que espera `guardar_cpe`. */
export interface DocLote {
  origen: "RECIBIDO" | "EMITIDO" | "OTRO";
  proveedorRuc: string | null;
  proveedorNombre: string | null;
  adquirienteRuc: string | null;
  adquirienteNombre: string | null;
  tipoComprobante: string | null;
  serie: string | null;
  numero: string | null;
  fechaEmision: string | null;
  moneda: string | null;
  subtotal: number | null;
  igv: number | null;
  total: number | null;
  periodo: string | null;
  /** Dónde quedaron archivados el XML y el PDF en Drive, si el scraper los subió. */
  xmlDriveUrl: string | null;
  pdfDriveUrl: string | null;
  items: ItemLote[];
}

/**
 * De cara a quién se emitió el comprobante, desde el RUC de la empresa.
 *
 * Recibido: se lo emitieron a la empresa (una compra). Emitido: lo emitió la
 * empresa (una venta). La descarga masiva de «Recibidas» trae solo lo
 * primero, pero el mismo XML sirve para ambos y el dato se decide por los RUC,
 * no por qué pestaña se bajó.
 */
export function origenDe(c: ComprobanteCpe, empresaRuc: string): DocLote["origen"] {
  const ruc = empresaRuc.trim();
  if (c.adquirienteRuc === ruc) return "RECIBIDO";
  if (c.proveedorRuc === ruc) return "EMITIDO";
  return "OTRO";
}

/** El período tributario yyyymm, desde la fecha de emisión. */
export function periodoDe(fechaEmision: string | null): string | null {
  if (!fechaEmision) return null;
  const m = /^(\d{4})-(\d{2})/.exec(fechaEmision);
  return m ? `${m[1]}${m[2]}` : null;
}

/**
 * La identidad de un comprobante: para descartar repetidos dentro del lote y
 * para que el scraper le enganche su enlace de Drive después, sin tener que
 * repetir esta misma clave en dos sitios.
 */
export function identidad(c: {
  tipoComprobante: string | null; serie: string | null;
  numero: string | null; proveedorRuc: string | null;
}): string {
  return [c.tipoComprobante ?? "", c.serie ?? "", c.numero ?? "", c.proveedorRuc ?? ""].join("|");
}

/**
 * Convierte los comprobantes leídos en el lote que se manda a guardar.
 *
 * Descarta los que no tienen serie y número —un XML que no se pudo leer no
 * sirve para nada— y los repetidos dentro del mismo lote, quedándose con el
 * último, que es lo que haría la base de todos modos.
 */
export function prepararLote(
  comprobantes: ComprobanteCpe[], empresaRuc: string
): DocLote[] {
  const porIdentidad = new Map<string, DocLote>();

  for (const c of comprobantes) {
    if (!c.serie || !c.numero) continue;
    porIdentidad.set(identidad(c), {
      origen: origenDe(c, empresaRuc),
      proveedorRuc: c.proveedorRuc,
      proveedorNombre: c.proveedorNombre,
      adquirienteRuc: c.adquirienteRuc,
      adquirienteNombre: c.adquirienteNombre,
      tipoComprobante: c.tipoComprobante,
      serie: c.serie,
      numero: c.numero,
      fechaEmision: c.fechaEmision,
      moneda: c.moneda,
      subtotal: c.subtotal,
      igv: c.igv,
      total: c.total,
      periodo: periodoDe(c.fechaEmision),
      xmlDriveUrl: null,
      pdfDriveUrl: null,
      items: c.items.map(i => ({
        linea: i.linea,
        descripcion: i.descripcion,
        cantidad: i.cantidad,
        unidad: i.unidad,
        precioUnitario: i.precioUnitario,
        importe: i.importe,
      })),
    });
  }

  return [...porIdentidad.values()];
}
