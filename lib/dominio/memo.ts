// Reglas del memo — SPEC §7.1, §7.3 y consolidado de §14

import type {
  ClaseGasto, ConsolidadoMemo, EstadoMemo, Gasto, Parametros, TipoMemo,
} from "./tipos.ts";
import { GASTO_CUENTA_EN_TOTAL, MEMO_PENDIENTE } from "./estados.ts";

// ════════════════════════════════════════════════════════════════
// Correlativo (§7.1)
// ════════════════════════════════════════════════════════════════

const ABREVIATURA_TIPO: Record<TipoMemo, string> = {
  VIATICOS: "VIA",
  PASAJES: "PAS",
  CAJA_CHICA: "CCH",
  OTRO: "OTR",
};

/**
 * Arma el correlativo `{EMPRESA}-{AAAA}-{TIPO}-{NNNNN}`.
 *
 * El número lo entrega la secuencia de la base dentro de la misma transacción
 * que inserta el memo; nunca se calcula en el cliente ni contando filas, que
 * daría números repetidos con dos altas simultáneas.
 */
export function armarCorrelativo(p: {
  empresaAbrev: string;
  anio: number;
  tipo: TipoMemo;
  secuencia: number;
}): string {
  const abrev = p.empresaAbrev.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const num = String(p.secuencia).padStart(5, "0");
  return `${abrev}-${p.anio}-${ABREVIATURA_TIPO[p.tipo]}-${num}`;
}

const PATRON_CORRELATIVO = /^[A-Z0-9]+-(\d{4})-(VIA|PAS|CCH|OTR)-(\d{5,})$/;

export function correlativoValido(c: string): boolean {
  return PATRON_CORRELATIVO.test(c);
}

// ════════════════════════════════════════════════════════════════
// Consolidado (§6.1 y §14)
// ════════════════════════════════════════════════════════════════

type GastoParaSuma = Pick<Gasto, "estado" | "clase" | "total" | "alertas">;

/**
 * Suma lo rendido y calcula el saldo. Incluye las tres clases de gasto:
 * comprobantes, declaraciones juradas y movilidad (§7.6).
 */
export function consolidar(
  montoAutorizado: number,
  gastos: GastoParaSuma[]
): ConsolidadoMemo {
  const cuentan = gastos.filter(g => GASTO_CUENTA_EN_TOTAL.includes(g.estado));

  const por_clase: Record<ClaseGasto, number> = {
    COMPROBANTE: 0,
    DECLARACION_JURADA: 0,
    MOVILIDAD: 0,
  };
  let rendido = 0;

  for (const g of cuentan) {
    const monto = g.total ?? 0;
    rendido += monto;
    por_clase[g.clase] += monto;
  }

  // Redondeo a céntimos: evita que la suma de decimales binarios muestre
  // 1234.5600000000002 en la interfaz o en la exportación.
  const red = (n: number) => Math.round(n * 100) / 100;
  rendido = red(rendido);
  const saldo = red(montoAutorizado - rendido);

  return {
    autorizado: red(montoAutorizado),
    rendido,
    saldo,
    devolucion: saldo > 0 ? saldo : 0,
    reembolso: saldo < 0 ? red(-saldo) : 0,
    por_clase: {
      COMPROBANTE: red(por_clase.COMPROBANTE),
      DECLARACION_JURADA: red(por_clase.DECLARACION_JURADA),
      MOVILIDAD: red(por_clase.MOVILIDAD),
    },
    cantidad_gastos: gastos.length,
    con_alertas: gastos.filter(g => g.alertas.length > 0).length,
    bloqueantes: gastos.filter(g => g.alertas.some(a => a.severidad === "bloqueante")).length,
  };
}

// ════════════════════════════════════════════════════════════════
// Bloqueo por memos vencidos (§7.3)
// ════════════════════════════════════════════════════════════════

export interface MemoVencido {
  id: string;
  correlativo: string;
  monto_autorizado: number;
  fecha_retorno_prev: string | null;
  dias_vencido: number;
}

export interface ResultadoBloqueo {
  /** Impide crear el memo. Solo si el parámetro de bloqueo está activo. */
  bloquea: boolean;
  /** Se muestra siempre que haya vencidos, aunque no bloquee. */
  advierte: boolean;
  vencidos: MemoVencido[];
  monto_total: number;
}

/**
 * Comprueba si el asignado arrastra memos sin rendir.
 *
 * En el piloto `bloquear_memo_con_pendientes` arranca en false: se advierte
 * pero se deja continuar, hasta que Dirección respalde el bloqueo.
 */
export function evaluarBloqueoPorPendientes(
  memosDelAsignado: Array<{
    id: string;
    correlativo: string;
    estado: EstadoMemo;
    monto_autorizado: number;
    fecha_retorno_prev: string | null;
  }>,
  parametros: Parametros,
  hoy: Date = new Date()
): ResultadoBloqueo {
  const vencidos: MemoVencido[] = [];

  for (const m of memosDelAsignado) {
    if (!MEMO_PENDIENTE.includes(m.estado)) continue;
    if (!m.fecha_retorno_prev) continue;

    const retorno = new Date(`${m.fecha_retorno_prev.slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(retorno.getTime())) continue;

    const dias = Math.floor((hoy.getTime() - retorno.getTime()) / 86_400_000);
    if (dias > parametros.dias_gracia_bloqueo) {
      vencidos.push({
        id: m.id,
        correlativo: m.correlativo,
        monto_autorizado: m.monto_autorizado,
        fecha_retorno_prev: m.fecha_retorno_prev,
        dias_vencido: dias,
      });
    }
  }

  const monto_total = Math.round(vencidos.reduce((s, v) => s + v.monto_autorizado, 0) * 100) / 100;

  return {
    bloquea: vencidos.length > 0 && parametros.bloquear_memo_con_pendientes,
    advierte: vencidos.length > 0,
    vencidos,
    monto_total,
  };
}

// ════════════════════════════════════════════════════════════════
// Ruta en Drive (§8.2)
// ════════════════════════════════════════════════════════════════

/**
 * `FOTO-GRAMA / {empresa} / {AAAA-MM} / {centro_costo} / {correlativo}`
 *
 * Se crea al abrir el memo, no al subir el primer archivo: así desaparece la
 * condición de carrera entre dos personas subiendo a la vez.
 */
export function rutaDrive(p: {
  empresaAbrev: string;
  fechaSalida: string | null;
  centroCostoFolder: string;
  correlativo: string;
}): string[] {
  const base = p.fechaSalida ? p.fechaSalida.slice(0, 7) : new Date().toISOString().slice(0, 7);
  return [p.empresaAbrev, base, p.centroCostoFolder, p.correlativo];
}
