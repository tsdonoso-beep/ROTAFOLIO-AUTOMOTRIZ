// Caja chica: el proceso al revés
//
// Franco lo describió así en la reunión: "en viáticos, antes de la rendición
// hay un memo. Caja chica es continua, no tiene memo al inicio. El proceso
// es invertido: no hay memo al inicio, hay memo al final. Yo presento lo que
// gasté, lo revisa mi jefe, aprueba, genera un memo y se va a pago."
//
// De ahí salen las dos diferencias que importan:
//
//   1. No hay monto autorizado. Nadie entregó plata por adelantado, así que
//      no hay nada contra qué comparar: no puede haber exceso ni saldo a
//      favor de la empresa. Todo lo rendido es un reembolso que se le debe
//      a la persona.
//
//   2. Los gastos existen antes que el memo. Se van capturando sueltos —lo
//      que en la app es la bandeja sin asignar— y en algún momento la
//      persona los junta y los presenta. El memo se crea recién ahí, con lo
//      que efectivamente se gastó.
//
// El resto del recorrido es el mismo que el de viáticos: revisión,
// aprobación, contabilización. Por eso esto no es un flujo aparte sino una
// forma distinta de llegar al mismo sitio.

import { impedimentosParaPresentar, type ImpedimentoPresentar } from "./estados.ts";
import type { Alerta, EstadoGasto, Gasto } from "./tipos.ts";

type GastoDeCaja = Pick<
  Gasto,
  "id" | "estado" | "total" | "alertas" | "alertas_confirmadas" | "fecha_emision"
>;

export interface ResumenCaja {
  cantidad: number;
  /** Lo que la empresa le debe a la persona: no hubo adelanto. */
  aReembolsar: number;
  conAlertas: number;
  bloqueantes: number;
  /** Rango de fechas de lo que se está rindiendo, para nombrar el periodo. */
  desde: string | null;
  hasta: string | null;
}

// ════════════════════════════════════════════════════════════════

/**
 * Resume lo que se va a presentar.
 *
 * Todo el total es reembolso: en caja chica la persona puso la plata —o la
 * sacó del fondo— y la empresa se la repone. No existe el "le sobró".
 */
export function resumirCaja(gastos: GastoDeCaja[]): ResumenCaja {
  const fechas = gastos
    .map(g => g.fecha_emision)
    .filter((f): f is string => !!f)
    .sort();

  return {
    cantidad: gastos.length,
    aReembolsar: redondear(gastos.reduce((s, g) => s + Number(g.total ?? 0), 0)),
    conAlertas: gastos.filter(g => (g.alertas ?? []).length > 0).length,
    bloqueantes: gastos.filter(g => tieneBloqueante(g.alertas)).length,
    desde: fechas[0] ?? null,
    hasta: fechas[fechas.length - 1] ?? null,
  };
}

/**
 * Qué impide presentar esta caja.
 *
 * Reutiliza las reglas de una rendición normal —nada sin extraer, nada
 * duplicado, nada con alertas sin confirmar— y suma la única propia: hay
 * que haber elegido algo. Que las reglas sean las mismas es deliberado:
 * quien revisa no debería tener que recordar dos criterios según por dónde
 * entró el gasto.
 */
export function impedimentosParaRendirCaja(
  gastos: GastoDeCaja[]
): ImpedimentoPresentar[] {
  if (!gastos.length) {
    return [{ motivo: "No seleccionaste ningún comprobante.", cantidad: 0 }];
  }

  return impedimentosParaPresentar(
    gastos.map(g => ({
      estado: g.estado as EstadoGasto,
      alertas: (g.alertas ?? []) as Array<{ severidad: string }>,
      alertas_confirmadas: g.alertas_confirmadas,
    }))
  );
}

/**
 * Un gasto puede entrar en una caja chica si todavía no pertenece a ningún
 * memo y sigue en manos de quien lo capturó. Uno ya presentado está
 * congelado; uno asignado a un memo de viáticos ya tiene dueño.
 */
export function elegibleParaCaja(g: { memo_id: string | null; estado: EstadoGasto }): boolean {
  if (g.memo_id !== null) return false;
  return ["CAPTURADO", "EXTRAIDO", "ERROR_EXTRACCION", "CON_ALERTA", "VALIDADO"]
    .includes(g.estado);
}

/**
 * Nombre del periodo que se está rindiendo, para el destino del memo.
 *
 * Una caja chica no tiene destino como un viaje: lo que la identifica es el
 * rango de fechas de lo que se junta.
 */
export function periodoDeCaja(r: ResumenCaja): string {
  if (!r.desde) return "Caja chica";
  if (r.desde === r.hasta) return `Caja chica ${r.desde}`;
  return `Caja chica ${r.desde} a ${r.hasta}`;
}

// ════════════════════════════════════════════════════════════════

function tieneBloqueante(alertas: Alerta[] | null | undefined): boolean {
  return (alertas ?? []).some(a => a.severidad === "bloqueante");
}

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}
