import type { Gasto } from "../dominio/tipos.ts";

/**
 * Exportación del expediente.
 *
 * Amplía las 25 columnas del MVP con lo que faltaba para el registro contable
 * (SPEC §8.3): RUC del proveedor, serie y número por separado —para poder
 * cruzar con SUNAT—, código del centro de costo, correlativo del memo, clase
 * de gasto, tipo de cambio y quién aprobó.
 */
export const CABECERAS = [
  "Correlativo Memo",
  "Empresa",
  "Código CECO",
  "Centro de Costos",
  "Destino",
  "Rendidor",
  "ID Gasto",
  "Clase",
  "RUC Proveedor",
  "Proveedor",
  "RUC Adquiriente",
  "Tipo Comprobante",
  "Serie",
  "Número",
  "Fecha Emisión",
  "Moneda",
  "Tipo de Cambio",
  "Subtotal",
  "IGV",
  "Total",
  "Forma de Pago",
  "Detalle",
  "Estado Gasto",
  "Validación SUNAT",
  "Alertas",
  "Observación",
  "Aprobado Por",
  "Enlace Drive",
] as const;

const NOMBRE_COMPROBANTE: Record<string, string> = {
  "00": "OTROS", "01": "FACTURA", "03": "BOLETA", "07": "NOTA_CREDITO",
  "08": "NOTA_DEBITO", "12": "TICKET",
};

export interface Contexto {
  correlativo: string;
  empresa: string;
  centroCodigo: string;
  centroNombre: string;
  destino: string;
  rendidor: string;
  aprobadoPor: string;
}

export function filasCsv(ctx: Contexto, gastos: Gasto[]): string[][] {
  const filas: string[][] = [[...CABECERAS]];

  for (const g of gastos) {
    const sunat = g.validacion_sunat
      ? g.validacion_sunat.aplicable
        ? `${g.validacion_sunat.estadoCp} / ${g.validacion_sunat.estadoRuc}`
        : "No aplicable"
      : "No validado";

    filas.push([
      ctx.correlativo,
      ctx.empresa,
      ctx.centroCodigo,
      ctx.centroNombre,
      ctx.destino,
      ctx.rendidor,
      g.id,
      g.clase,
      g.proveedor_ruc ?? "",
      g.proveedor_nombre ?? "",
      g.adquiriente_ruc ?? "",
      NOMBRE_COMPROBANTE[g.tipo_comprobante ?? ""] ?? g.tipo_comprobante ?? "",
      g.serie ?? "",
      g.numero ?? "",
      g.fecha_emision ?? "",
      g.moneda ?? "PEN",
      g.tipo_cambio != null ? String(g.tipo_cambio) : "",
      num(g.subtotal),
      num(g.igv),
      num(g.total),
      g.forma_pago ?? "",
      g.detalle ?? "",
      g.estado,
      sunat,
      (g.alertas ?? []).map(a => a.codigo).join(" | "),
      g.observacion ?? "",
      ctx.aprobadoPor,
      g.drive_url ?? "",
    ]);
  }

  return filas;
}

const num = (v: number | null | undefined) =>
  v == null ? "" : Number(v).toFixed(2);

/**
 * Serializa a CSV. Se separa por punto y coma porque Excel en español
 * interpreta la coma como separador decimal y desarma las columnas.
 */
export function aCsv(filas: string[][]): string {
  return filas
    .map(f => f.map(escapar).join(";"))
    .join("\r\n");
}

/** Un número con signo y decimales opcionales, nada más. */
const NUMERO = /^-?\d+(\.\d+)?$/;

function escapar(valor: string): string {
  const v = valor ?? "";

  // Un valor que empieza por = + - @ lo interpreta Excel como fórmula, y se
  // neutraliza con un apóstrofo. Pero un importe negativo también empieza
  // por "-", y neutralizarlo lo convierte en texto: la columna deja de
  // sumarse, que en un documento que va a pago es peor que el riesgo que se
  // quería evitar. Los números se dejan pasar tal cual; "-40.00" no puede
  // ser una fórmula.
  const seguro = !NUMERO.test(v) && /^[=+\-@]/.test(v) ? `'${v}` : v;

  return /[";\r\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

export function descargarCsv(nombre: string, filas: string[][]): void {
  // El BOM hace que Excel reconozca UTF-8 y no rompa las tildes.
  const blob = new Blob(["﻿" + aCsv(filas)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}
