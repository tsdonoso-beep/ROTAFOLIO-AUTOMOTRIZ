// El documento de liquidación
//
// "Con eso nosotros podemos jalar un documento de liquidación y pasarlo a
// pago", dijo Finanzas. Esto es ese documento: memo por memo, lo entregado
// contra lo rendido, y al final un solo número.
//
// Comparte las convenciones del export de gastos —punto y coma, BOM— porque
// va al mismo Excel en español.

import type { Liquidacion } from "../dominio/liquidacion.ts";

export const CABECERAS_LIQUIDACION = [
  "Correlativo Memo",
  "Fecha Salida",
  "Destino",
  "Estado",
  "Situación",
  "Autorizado",
  "Rendido",
  "Saldo",
] as const;

const NOMBRE_SITUACION: Record<string, string> = {
  liquidable: "CERRADO",
  en_revision: "EN REVISIÓN",
  abierta: "ABIERTO",
};

export interface CabeceraPersona {
  nombre: string;
  dni: string;
  emitidoPor: string;
  emitidoEn: string;
}

/**
 * Arma el documento completo: identificación, detalle y totales.
 *
 * Los memos sin cerrar aparecen en el detalle pero no suman al neto, y el
 * documento lo dice explícitamente. Un papel que va a pago no puede dejar
 * esa distinción a la interpretación de quien lo lee.
 */
export function filasLiquidacion(p: CabeceraPersona, l: Liquidacion): string[][] {
  const n = (v: number) => v.toFixed(2);
  const filas: string[][] = [
    ["LIQUIDACIÓN DE VIÁTICOS"],
    ["Persona", p.nombre],
    ["Documento", p.dni],
    ["Emitido por", p.emitidoPor],
    ["Emitido el", p.emitidoEn],
    [],
    [...CABECERAS_LIQUIDACION],
  ];

  for (const linea of l.lineas) {
    filas.push([
      linea.correlativo,
      linea.fecha ?? "",
      linea.destino ?? "",
      linea.estado,
      NOMBRE_SITUACION[linea.situacion] ?? linea.situacion,
      n(linea.autorizado),
      n(linea.rendido),
      n(linea.saldo),
    ]);
  }

  filas.push([]);
  filas.push(["TOTALES DE LO YA CERRADO"]);
  filas.push(["Autorizado", n(l.autorizado)]);
  filas.push(["Rendido", n(l.rendido)]);
  filas.push(["Debe devolver", n(l.devuelve)]);
  filas.push(["Se le reembolsa", n(l.reembolsa)]);
  filas.push([
    "NETO",
    n(Math.abs(l.neto)),
    l.neto > 0 ? "A DEVOLVER POR LA PERSONA"
      : l.neto < 0 ? "A REEMBOLSAR POR LA EMPRESA"
      : "SIN SALDO",
  ]);

  if (l.sinCerrar > 0) {
    filas.push([]);
    filas.push([
      "ADVERTENCIA",
      `${l.sinCerrar} memo(s) sin cerrar por ${n(l.montoSinCerrar)} no entran en el neto: ` +
      "su monto todavía puede cambiar. Esta liquidación es parcial.",
    ]);
  }

  return filas;
}

/** Nombre de archivo que se ordena solo al guardarlo en una carpeta. */
export function nombreArchivoLiquidacion(p: CabeceraPersona): string {
  const limpio = p.nombre.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "-");
  return `liquidacion-${p.dni}-${limpio}.csv`;
}
