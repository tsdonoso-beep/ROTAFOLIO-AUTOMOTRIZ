// A qué memo corresponde un comprobante — según su fecha
//
// Es la tarea más manual del proceso actual. Cuando alguien vuelve de un
// viaje, Administración recibe un sobre y ordena comprobante por comprobante
// contra los memos de ese viaje: un solo viaje puede haber generado cuatro
// —días 1-2 en Piura, 4-8 en Chachapoyas, 8-12 en Paita, 12-16 en
// Lambayeque— y cada boleta tiene que ir al que le toca por fecha.
//
// La fecha de emisión ya dice a cuál pertenece. Este módulo lo resuelve.
//
// Tres respuestas posibles, y ninguna inventa: si un comprobante cae en el
// rango de un solo memo se asigna; si cae en varios o en ninguno se dice
// cuál es la duda y decide la persona. Adivinar el memo equivocado es peor
// que preguntar, porque mueve plata de un centro de costo a otro.

import { MEMO_EDITABLE } from "./estados.ts";
import type { EstadoMemo } from "./tipos.ts";

/** Días de holgura a cada lado del rango del memo. */
const HOLGURA_DIAS = 2;

export interface MemoCandidato {
  id: string;
  correlativo: string;
  destino: string | null;
  fecha_salida: string | null;
  fecha_retorno_prev: string | null;
  estado: EstadoMemo;
}

export type Asignacion =
  /** Un solo memo cubre la fecha: se asigna sin preguntar. */
  | { tipo: "exacta"; memo: MemoCandidato }
  /** Ninguno la cubre, pero uno queda a pocos días: se propone, no se impone. */
  | { tipo: "aproximada"; memo: MemoCandidato; dias: number }
  /** Varios la cubren: la persona elige. */
  | { tipo: "ambigua"; memos: MemoCandidato[] }
  /** Ninguno encaja. El comprobante va a la bandeja sin asignar. */
  | { tipo: "ninguna"; motivo: string };

// ════════════════════════════════════════════════════════════════

/**
 * Elige el memo que corresponde a una fecha de emisión.
 *
 * Solo se consideran memos que todavía admiten gastos: uno ya presentado
 * está congelado y meterle un comprobante nuevo rompería lo que el revisor
 * ya vio.
 */
export function asignarPorFecha(
  fechaEmision: string,
  candidatos: MemoCandidato[]
): Asignacion {
  const fecha = aFecha(fechaEmision);
  if (!fecha) {
    return { tipo: "ninguna", motivo: "El comprobante no tiene fecha legible." };
  }

  const abiertos = candidatos.filter(m => MEMO_EDITABLE.includes(m.estado));
  if (!abiertos.length) {
    return {
      tipo: "ninguna",
      motivo: candidatos.length
        ? "Tus memos ya fueron presentados y no admiten comprobantes nuevos."
        : "No tienes memos abiertos.",
    };
  }

  // Un memo sin fechas no puede competir por rango: se deja para elección
  // manual antes que asignarle cualquier cosa.
  const conFechas = abiertos.filter(m => m.fecha_salida && m.fecha_retorno_prev);

  const dentro = conFechas.filter(m => cubre(m, fecha, 0));
  if (dentro.length === 1) return { tipo: "exacta", memo: dentro[0] };
  if (dentro.length > 1) return { tipo: "ambigua", memos: dentro };

  // Nadie la cubre exactamente. Una cena la noche antes de salir, o un taxi
  // al día siguiente de volver, son gastos legítimos del viaje.
  const cerca = conFechas
    .map(m => ({ memo: m, dias: distanciaEnDias(m, fecha) }))
    .filter(x => x.dias > 0 && x.dias <= HOLGURA_DIAS)
    .sort((a, b) => a.dias - b.dias);

  if (cerca.length === 1) {
    return { tipo: "aproximada", memo: cerca[0].memo, dias: cerca[0].dias };
  }
  if (cerca.length > 1) {
    // Empate cerca del borde: que elija la persona.
    const minimo = cerca[0].dias;
    const empatados = cerca.filter(x => x.dias === minimo);
    if (empatados.length > 1) return { tipo: "ambigua", memos: empatados.map(x => x.memo) };
    return { tipo: "aproximada", memo: cerca[0].memo, dias: cerca[0].dias };
  }

  // Quedan los memos sin fechas declaradas: no se puede decidir por fecha,
  // pero existen y son elegibles a mano.
  const sinFechas = abiertos.filter(m => !m.fecha_salida || !m.fecha_retorno_prev);
  if (sinFechas.length && !conFechas.length) {
    return sinFechas.length === 1
      ? { tipo: "aproximada", memo: sinFechas[0], dias: 0 }
      : { tipo: "ambigua", memos: sinFechas };
  }

  return {
    tipo: "ninguna",
    motivo: `Ningún memo tuyo cubre el ${fechaEmision}. Queda sin asignar para que lo muevas tú.`,
  };
}

/** El memo elegido por la asignación, si la hubo. */
export function memoDe(a: Asignacion): MemoCandidato | null {
  if (a.tipo === "exacta" || a.tipo === "aproximada") return a.memo;
  return null;
}

/** Explicación corta para mostrar junto al comprobante. */
export function explicar(a: Asignacion): string {
  switch (a.tipo) {
    case "exacta":
      return `La fecha cae dentro de ${a.memo.correlativo}.`;
    case "aproximada":
      return a.dias === 0
        ? `Único memo abierto: ${a.memo.correlativo}.`
        : `Ningún memo cubre esa fecha exactamente; ${a.memo.correlativo} queda a ${a.dias} día${a.dias === 1 ? "" : "s"}. Confirma que es el correcto.`;
    case "ambigua":
      return `${a.memos.length} memos cubren esa fecha. Elige cuál corresponde.`;
    case "ninguna":
      return a.motivo;
  }
}

// ════════════════════════════════════════════════════════════════

function cubre(m: MemoCandidato, fecha: Date, holgura: number): boolean {
  const desde = aFecha(m.fecha_salida);
  const hasta = aFecha(m.fecha_retorno_prev);
  if (!desde || !hasta) return false;

  const ms = holgura * 86_400_000;
  return fecha.getTime() >= desde.getTime() - ms
    && fecha.getTime() <= hasta.getTime() + ms;
}

/** Días que separan la fecha del rango del memo. 0 si está dentro. */
function distanciaEnDias(m: MemoCandidato, fecha: Date): number {
  const desde = aFecha(m.fecha_salida);
  const hasta = aFecha(m.fecha_retorno_prev);
  if (!desde || !hasta) return Number.POSITIVE_INFINITY;

  if (fecha < desde) return Math.round((desde.getTime() - fecha.getTime()) / 86_400_000);
  if (fecha > hasta) return Math.round((fecha.getTime() - hasta.getTime()) / 86_400_000);
  return 0;
}

function aFecha(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
