// El enfrentamiento por persona
//
// Lo pidió Finanzas en la reunión, con estas palabras: "si he viajado 20
// veces son 20 memos, y yo puedo haber rendido 10 o 15 o los 20. A veces me
// ha sobrado, a veces he gastado de más: tengo saldos a favor y saldos en
// contra. Como ya tienes qué se le otorgó a cada persona y qué cargó, hacer
// el enfrentamiento, ver memo por memo cuánto de saldo tiene y sacar la
// liquidación final para pasarla a pago."
//
// El resto de la app razona por memo. Este módulo razona por persona, que
// es la única forma de responder "¿cuánto le debo o me debe?".
//
// La distinción que hace útil esto: un saldo solo es definitivo cuando la
// rendición ya fue revisada. Mientras el memo siga abierto la persona
// todavía puede presentar comprobantes, así que su saldo va a cambiar.
// Netear ambos daría un número que parece exacto y no lo es —y con ese
// número se paga—. Por eso se separan y el neto se calcula solo con lo
// cerrado.

import { consolidar } from "./memo.ts";
import type { EstadoMemo, Gasto } from "./tipos.ts";

type GastoParaSuma = Pick<Gasto, "estado" | "clase" | "total" | "alertas">;

/** Rendiciones ya revisadas: su saldo no va a cambiar. */
const LIQUIDABLE: EstadoMemo[] = ["APROBADA", "CONTABILIZADA", "CERRADO"];

/** Presentada pero aún sin aprobar: el monto puede moverse en la revisión. */
const EN_REVISION: EstadoMemo[] = ["PRESENTADA"];

/** Todavía en manos de la persona: puede seguir cargando comprobantes. */
const ABIERTA: EstadoMemo[] = ["ABIERTO", "EN_RENDICION", "OBSERVADA"];

export type SituacionMemo = "liquidable" | "en_revision" | "abierta";

export interface MemoLiquidable {
  id: string;
  correlativo: string;
  estado: EstadoMemo;
  destino: string | null;
  fecha_salida: string | null;
  monto_autorizado: number;
  gastos: GastoParaSuma[];
}

export interface LineaLiquidacion {
  memoId: string;
  correlativo: string;
  destino: string | null;
  fecha: string | null;
  estado: EstadoMemo;
  situacion: SituacionMemo;
  autorizado: number;
  rendido: number;
  /** Positivo: le sobró. Negativo: gastó de más. */
  saldo: number;
}

export interface Liquidacion {
  lineas: LineaLiquidacion[];
  /** Totales de las rendiciones ya cerradas. */
  autorizado: number;
  rendido: number;
  /** Lo que la persona tendría que devolver, de lo ya cerrado. */
  devuelve: number;
  /** Lo que la empresa tendría que reembolsarle, de lo ya cerrado. */
  reembolsa: number;
  /** devuelve − reembolsa. Positivo: la persona debe. Negativo: se le debe. */
  neto: number;
  /** Memos abiertos o en revisión: mientras existan, el neto no es final. */
  sinCerrar: number;
  montoSinCerrar: number;
  /** true si se puede pasar a pago sin arrastrar plata sin justificar. */
  liquidable: boolean;
}

// ════════════════════════════════════════════════════════════════

export function situacionDe(estado: EstadoMemo): SituacionMemo | null {
  if (LIQUIDABLE.includes(estado)) return "liquidable";
  if (EN_REVISION.includes(estado)) return "en_revision";
  if (ABIERTA.includes(estado)) return "abierta";
  // BORRADOR y ANULADO no representan plata entregada: no entran.
  return null;
}

/**
 * Enfrenta lo entregado contra lo rendido, memo por memo.
 *
 * Los memos anulados y los borradores quedan fuera: no hubo dinero de por
 * medio, y meterlos inflaría el "autorizado" con plata que nunca salió.
 */
export function liquidar(memos: MemoLiquidable[]): Liquidacion {
  const lineas: LineaLiquidacion[] = [];

  for (const m of memos) {
    const situacion = situacionDe(m.estado);
    if (!situacion) continue;

    const c = consolidar(Number(m.monto_autorizado), m.gastos ?? []);
    lineas.push({
      memoId: m.id,
      correlativo: m.correlativo,
      destino: m.destino,
      fecha: m.fecha_salida,
      estado: m.estado,
      situacion,
      autorizado: c.autorizado,
      rendido: c.rendido,
      saldo: redondear(c.saldo),
    });
  }

  // Se ordena por fecha, que es como se lee un estado de cuenta.
  lineas.sort((a, b) => (a.fecha ?? "").localeCompare(b.fecha ?? ""));

  const cerradas = lineas.filter(l => l.situacion === "liquidable");
  const pendientes = lineas.filter(l => l.situacion !== "liquidable");

  const devuelve = redondear(
    cerradas.filter(l => l.saldo > 0).reduce((s, l) => s + l.saldo, 0)
  );
  const reembolsa = redondear(
    cerradas.filter(l => l.saldo < 0).reduce((s, l) => s - l.saldo, 0)
  );

  return {
    lineas,
    autorizado: redondear(cerradas.reduce((s, l) => s + l.autorizado, 0)),
    rendido: redondear(cerradas.reduce((s, l) => s + l.rendido, 0)),
    devuelve,
    reembolsa,
    neto: redondear(devuelve - reembolsa),
    sinCerrar: pendientes.length,
    montoSinCerrar: redondear(pendientes.reduce((s, l) => s + l.autorizado, 0)),
    liquidable: cerradas.length > 0 && pendientes.length === 0,
  };
}

/** Cómo se lee el neto en una frase, que es lo que va en el documento. */
export function explicarNeto(l: Liquidacion): string {
  if (!l.lineas.length) return "No tiene memos con movimiento.";
  if (l.neto > 0) return `Debe devolver ${l.neto.toFixed(2)}.`;
  if (l.neto < 0) return `La empresa le debe reembolsar ${Math.abs(l.neto).toFixed(2)}.`;
  return l.sinCerrar ? "Sin saldo en lo ya cerrado." : "Está a cero: no debe ni se le debe.";
}

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

// ════════════════════════════════════════════════════════════════
// El documento emitido
// ════════════════════════════════════════════════════════════════

export type EstadoLiquidacion = "EMITIDA" | "PAGADA" | "ANULADA";

export interface LiquidacionEmitida {
  id: string;
  neto: number;
  estado: EstadoLiquidacion;
  referencia: string | null;
  emitidaEn: string;
  pagadaEn: string | null;
  memoIds: string[];
}

/**
 * Qué memos se pueden meter en una liquidación nueva.
 *
 * Los que ya están en una liquidación vigente quedan fuera: si entraran de
 * nuevo, se pagarían dos veces. La base lo rechaza igual —hay un disparador
 * que lo impide—, pero acá se calcula antes para no ofrecer un botón que va
 * a fallar, y para poder decir cuántos quedaron fuera y por qué.
 */
export function memosLiquidables(
  l: Liquidacion, emitidas: LiquidacionEmitida[]
): { disponibles: string[]; yaLiquidados: string[] } {
  const tomados = new Set(
    emitidas.filter(e => e.estado !== "ANULADA").flatMap(e => e.memoIds)
  );

  const cerrados = l.lineas
    .filter(x => x.situacion === "liquidable")
    .map(x => x.memoId);

  return {
    disponibles: cerrados.filter(id => !tomados.has(id)),
    yaLiquidados: cerrados.filter(id => tomados.has(id)),
  };
}

/** Lo que todavía no se le pagó a la persona ni ella devolvió. */
export function netoSinPagar(emitidas: LiquidacionEmitida[]): number {
  const suma = emitidas
    .filter(e => e.estado === "EMITIDA")
    .reduce((s, e) => s + e.neto, 0);
  return Math.round(suma * 100) / 100;
}

export const NOMBRE_ESTADO_LIQUIDACION: Record<EstadoLiquidacion, string> = {
  EMITIDA: "Emitida, sin pagar",
  PAGADA: "Pagada",
  ANULADA: "Anulada",
};
