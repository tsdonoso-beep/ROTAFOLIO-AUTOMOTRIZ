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
    // Sin adelanto no hay exceso posible. La cuenta es la misma —el saldo
    // sale negativo y todo cae en reembolso—, pero lo que la pantalla debe
    // decir es otra cosa: nadie se pasó de nada.
    sinAdelanto: red(montoAutorizado) === 0,
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
  /** La fecha contra la que se midió: la del anexo si existe, si no la del memo. */
  fecha_retorno_prev: string | null;
  /** Lo que el anexo le asignó a ESTA persona, cuando el memo lo declara. */
  monto_asignado: number | null;
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
    /** Del anexo, para esta persona. Manda sobre la fecha del memo. */
    fecha_hasta?: string | null;
    /** Del anexo, para esta persona. Si falta se cae al total del memo. */
    monto_asignado?: number | null;
  }>,
  parametros: Parametros,
  hoy: Date = new Date()
): ResultadoBloqueo {
  const vencidos: MemoVencido[] = [];

  for (const m of memosDelAsignado) {
    if (!MEMO_PENDIENTE.includes(m.estado)) continue;

    // El tramo del anexo manda sobre las fechas del memo. Un memo puede
    // abarcar del 9 al 19 y que a esta persona le tocaran solo el 9 y el 10:
    // medir contra el 19 le regala nueve días de plazo que nadie le dio.
    const limite = m.fecha_hasta ?? m.fecha_retorno_prev;
    if (!limite) continue;

    const retorno = new Date(`${limite.slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(retorno.getTime())) continue;

    const dias = Math.floor((hoy.getTime() - retorno.getTime()) / 86_400_000);
    if (dias > parametros.dias_gracia_bloqueo) {
      vencidos.push({
        id: m.id,
        correlativo: m.correlativo,
        monto_autorizado: m.monto_autorizado,
        fecha_retorno_prev: limite,
        monto_asignado: m.monto_asignado ?? null,
        dias_vencido: dias,
      });
    }
  }

  // Lo que esta persona arrastra es SU parte del memo, no el memo entero. El
  // 594-2026 autorizó S/ 9,064.00 entre once personas: cobrarle los nueve mil
  // a cada una infla la deuda ocho veces. Solo cuando el anexo no dice cuánto
  // le tocó se cae al total, que es lo único que se sabe.
  const monto_total = Math.round(
    vencidos.reduce((s, v) => s + (v.monto_asignado ?? v.monto_autorizado), 0) * 100
  ) / 100;

  return {
    bloquea: vencidos.length > 0 && parametros.bloquear_memo_con_pendientes,
    advierte: vencidos.length > 0,
    vencidos,
    monto_total,
  };
}

/**
 * Cómo se le explica el bloqueo a quien está creando el memo.
 *
 * El mensaje nombra a la persona y sus memos vencidos porque quien crea el
 * memo casi nunca es quien arrastra el pendiente: Annie abre memos para todo
 * el mundo y no tiene por qué saber de memoria qué debe cada uno.
 */
export function explicarPendientes(nombre: string, r: ResultadoBloqueo): string {
  if (!r.advierte) return "";

  // Cada memo se lista por la parte de ESTA persona, la misma que se sumó
  // para el total. Mostrar el total del memo acá y la parte en el total
  // dejaría un mensaje que se contradice a sí mismo.
  const lista = r.vencidos
    .map(v => `${v.correlativo} (${v.dias_vencido} días, ${soles(v.monto_asignado ?? v.monto_autorizado)})`)
    .join(", ");
  const cuantos = r.vencidos.length === 1 ? "una rendición vencida" : `${r.vencidos.length} rendiciones vencidas`;

  return `${nombre} tiene ${cuantos} por ${soles(r.monto_total)}: ${lista}.`;
}

function soles(n: number): string {
  return `S/ ${n.toFixed(2)}`;
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
