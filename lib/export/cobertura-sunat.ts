// Cobertura: qué de lo que SUNAT dice que existe ya tiene detalle
//
// El registro de compras (RCE) trae la cabecera de TODO lo declarado; el
// detalle de ítems solo existe para lo que el scraper ya bajó. Esta hoja
// responde, comprobante por comprobante, «¿esto ya tiene detalle, o falta
// bajarlo?» — es el checklist del backfill, hecho hoja.
//
// Sale de `cobertura_cpe`, que hace el cruce en la base (por
// proveedor+tipo+serie+número, igual que el resto del sistema). Acá solo se
// da forma a lo que esa función ya decidió.

import { fechaCorta, nombreDeTipo, type TipoColumna } from "./comprobantes-sunat.ts";

/** Una fila de `cobertura_cpe`. */
export interface FilaCobertura {
  periodo: string | null;
  proveedorRuc: string | null;
  proveedorNombre: string | null;
  tipoComprobante: string | null;
  serie: string | null;
  numero: string | null;
  fechaEmision: string | null;
  moneda: string | null;
  totalSire: number | null;
  /** "Con detalle" o "Sin detalle". */
  estado: string | null;
  /** null cuando el estado es "Sin detalle": no hay con qué comparar. */
  totalDetalle: number | null;
  diferencia: number | null;
  items: number | null;
}

export const CABECERAS_COBERTURA = [
  "Período", "RUC proveedor", "Proveedor", "Tipo", "Serie", "Número",
  "Fecha de emisión", "Moneda", "Total SIRE", "Estado",
  "Total con detalle", "Diferencia", "Ítems",
];

export const TIPOS_COBERTURA: TipoColumna[] = [
  "texto", "texto", "texto", "texto", "texto", "texto",
  "fecha", "texto", "numero", "texto",
  "numero", "numero", "numero",
];

export function filaCoberturaDesdeRpc(d: Record<string, unknown>): FilaCobertura {
  const aNum = (v: unknown) => (v == null || v === "" ? null : Number(v));
  return {
    periodo: (d.periodo as string) ?? null,
    proveedorRuc: (d.proveedor_ruc as string) ?? null,
    proveedorNombre: (d.proveedor_nombre as string) ?? null,
    tipoComprobante: (d.tipo_comprobante as string) ?? null,
    serie: (d.serie as string) ?? null,
    numero: (d.numero as string) ?? null,
    fechaEmision: (d.fecha_emision as string) ?? null,
    moneda: (d.moneda as string) ?? null,
    totalSire: aNum(d.total_sire),
    estado: (d.estado as string) ?? null,
    totalDetalle: aNum(d.total_detalle),
    diferencia: aNum(d.diferencia),
    items: aNum(d.items),
  };
}

const num = (v: number | null, dec = 2) => (v == null ? "" : Number(v).toFixed(dec));

export function filasCoberturaSunat(filas: FilaCobertura[]): string[][] {
  return [
    CABECERAS_COBERTURA,
    ...filas.map(f => [
      f.periodo ?? "",
      f.proveedorRuc ?? "",
      f.proveedorNombre ?? "",
      nombreDeTipo(f.tipoComprobante),
      f.serie ?? "",
      f.numero ?? "",
      fechaCorta(f.fechaEmision),
      f.moneda ?? "",
      num(f.totalSire),
      f.estado ?? "",
      num(f.totalDetalle),
      num(f.diferencia),
      f.items == null ? "" : String(f.items),
    ]),
  ];
}

export function nombreArchivoCobertura(periodo: string | null): string {
  return periodo
    ? `COMPROBANTES SUNAT - COBERTURA ${periodo}.csv`
    : "COMPROBANTES SUNAT - COBERTURA.csv";
}

// ── El resumen por período ──────────────────────────────────────────
//
// Va en una hoja aparte, no como pestaña extra de la de arriba: `publicarHoja`
// solo sabe escribir la pestaña que se llama como el archivo, y forzar una
// segunda pestaña ahí habría significado tocar esa función para este único
// caso. Dos hojas chicas, cada una con su propósito, es más simple que una
// con reglas especiales.
//
// El resumen se calcula en SQL, no con fórmulas de Sheets: así hay una sola
// fuente de verdad —la misma que ve el detalle— y no hay riesgo de que la
// fórmula quede desactualizada si alguien reordena una columna. Quien quiera
// armar su propio tablero encima de la hoja de detalle puede hacerlo con
// tablas dinámicas de Sheets, igual que ya existe para el histórico.

export interface FilaResumenCobertura {
  periodo: string | null;
  enSire: number | null;
  conDetalle: number | null;
  sinDetalle: number | null;
  pctCobertura: number | null;
}

export const CABECERAS_RESUMEN_COBERTURA = [
  "Período", "En el RCE", "Con detalle", "Sin detalle", "% Cobertura",
];

export const TIPOS_RESUMEN_COBERTURA: TipoColumna[] = [
  "texto", "numero", "numero", "numero", "numero",
];

export function filaResumenDesdeRpc(d: Record<string, unknown>): FilaResumenCobertura {
  const aNum = (v: unknown) => (v == null || v === "" ? null : Number(v));
  return {
    periodo: (d.periodo as string) ?? null,
    enSire: aNum(d.en_sire),
    conDetalle: aNum(d.con_detalle),
    sinDetalle: aNum(d.sin_detalle),
    pctCobertura: aNum(d.pct_cobertura),
  };
}

export function filasResumenCobertura(filas: FilaResumenCobertura[]): string[][] {
  return [
    CABECERAS_RESUMEN_COBERTURA,
    ...filas.map(f => [
      f.periodo ?? "",
      f.enSire == null ? "" : String(f.enSire),
      f.conDetalle == null ? "" : String(f.conDetalle),
      f.sinDetalle == null ? "" : String(f.sinDetalle),
      f.pctCobertura == null ? "" : f.pctCobertura.toFixed(1),
    ]),
  ];
}

export const NOMBRE_RESUMEN_COBERTURA = "COMPROBANTES SUNAT - COBERTURA (RESUMEN)";
