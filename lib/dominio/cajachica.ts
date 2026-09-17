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

// ════════════════════════════════════════════════════════════════
// El fondo y sus ciclos
// ════════════════════════════════════════════════════════════════
//
// Lo de arriba es cómo se rinde una caja. Esto es la caja misma.
//
// Un memo de viáticos nace, se rinde y se cierra. Un fondo de caja chica no:
// cuando se agota, se rinde lo gastado y se vuelve a depositar el mismo
// fondo. En el seguimiento de Control de Gestión hay 175 de esos ciclos
// entre 2025 y 2026, repartidos entre seis administradores de caja.
//
// Y no es mensual, como se dijo en la sesión de trabajo. Los seis ciclos de
// Gestión de Proyectos se repusieron cada 8 a 12 días: el 11 y el 23 de
// julio, el 4, el 13 y el 25 de agosto, y el 3 de setiembre.

export interface CicloDeCaja {
  id: string;
  correlativo: string;
  ciclo: string | null;
  estado: string;
  monto: number;
  rendido: number;
  fecha: string | null;
}

export interface EstadoDeLaCaja {
  /** El ciclo vivo, si hay uno. Solo puede haber uno a la vez. */
  abierto: CicloDeCaja | null;
  cerrados: CicloDeCaja[];
  /** Cuánto se ha repuesto en total a lo largo de la vida del fondo. */
  repuestoTotal: number;
  /** Lo que queda del ciclo abierto. Sin ciclo abierto, cero. */
  saldo: number;
  /**
   * Cada cuántos días se repone, en promedio. Null con menos de dos ciclos:
   * con uno solo no hay intervalo que medir.
   */
  cadenciaDias: number | null;
}

const redondear2 = (n: number) => Math.round(n * 100) / 100;

const CICLO_VIVO = ["ABIERTO", "EN_RENDICION", "PRESENTADA", "OBSERVADA"];

export function estadoDeLaCaja(ciclos: CicloDeCaja[]): EstadoDeLaCaja {
  const abierto = ciclos.find(c => CICLO_VIVO.includes(c.estado)) ?? null;
  const cerrados = ciclos.filter(c => c !== abierto);

  const fechas = ciclos
    .map(c => c.fecha)
    .filter((f): f is string => !!f)
    .sort();

  let cadencia: number | null = null;
  if (fechas.length >= 2) {
    const dias = Date.parse(fechas[fechas.length - 1]) - Date.parse(fechas[0]);
    cadencia = Math.round(dias / 86_400_000 / (fechas.length - 1));
  }

  return {
    abierto,
    cerrados,
    repuestoTotal: redondear2(ciclos.reduce((s, c) => s + c.monto, 0)),
    saldo: abierto ? redondear2(abierto.monto - abierto.rendido) : 0,
    cadenciaDias: cadencia,
  };
}

/**
 * El número del ciclo que sigue.
 *
 * Hay dos numeraciones dando vueltas sin reconciliar: el memo 194-2026
 * escribe «CAJA CHICA N° 36» y el seguimiento usa 001-2025, 002-2025… Acá se
 * continúa la del último ciclo si se puede leer un número, y si no se empieza
 * en 1. Es una etiqueta, no un orden: quien ordena de verdad es la cadena de
 * memo_referido_id.
 */
export function siguienteCiclo(ultimo: string | null, anio: number): string {
  if (!ultimo) return `001-${anio}`;

  const m = ultimo.match(/(\d+)/);
  if (!m) return `001-${anio}`;

  const n = Number(m[1]) + 1;
  // Se conserva la forma del anterior: si venía «036», sale «037»; si venía
  // «001-2025», sale «002-2026» con el año que corre.
  const conAnio = /\d+\s*-\s*\d{4}/.test(ultimo);
  const ancho = m[1].length;
  const num = String(n).padStart(ancho, "0");
  return conAnio ? `${num}-${anio}` : num;
}
