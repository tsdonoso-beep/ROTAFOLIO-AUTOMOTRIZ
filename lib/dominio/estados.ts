// Máquinas de estado — SPEC §4
//
// Las transiciones se declaran como datos, no como condicionales dispersos:
// así el servidor puede rechazar cualquier salto inválido en un solo punto.

import type { EstadoGasto, EstadoMemo, Rol } from "./tipos.ts";

// ════════════════════════════════════════════════════════════════
// MEMO (§4.1)
// ════════════════════════════════════════════════════════════════

interface TransicionMemo {
  desde: EstadoMemo;
  hacia: EstadoMemo;
  roles: Rol[];
  /** true = la produce el sistema, no una persona. */
  automatica?: boolean;
}

const TRANSICIONES_MEMO: TransicionMemo[] = [
  { desde: "BORRADOR",      hacia: "ABIERTO",       roles: ["ADMIN_MEMOS", "ADMIN_SISTEMA"] },
  { desde: "BORRADOR",      hacia: "ANULADO",       roles: ["ADMIN_MEMOS", "ADMIN_SISTEMA"] },
  { desde: "ABIERTO",       hacia: "EN_RENDICION",  roles: [], automatica: true },
  { desde: "ABIERTO",       hacia: "ANULADO",       roles: ["ADMIN_MEMOS", "ADMIN_SISTEMA"] },
  { desde: "EN_RENDICION",  hacia: "PRESENTADA",    roles: ["RENDIDOR", "ADMIN_MEMOS", "ADMIN_SISTEMA"] },
  { desde: "EN_RENDICION",  hacia: "ANULADO",       roles: ["ADMIN_MEMOS", "ADMIN_SISTEMA"] },
  { desde: "PRESENTADA",    hacia: "OBSERVADA",     roles: ["REVISOR_COSTOS", "CONTABILIDAD", "ADMIN_SISTEMA"] },
  { desde: "PRESENTADA",    hacia: "APROBADA",      roles: ["REVISOR_COSTOS", "ADMIN_SISTEMA"] },
  // La vuelta atrás es parcial: solo los gastos observados quedan editables.
  { desde: "OBSERVADA",     hacia: "EN_RENDICION",  roles: ["RENDIDOR", "ADMIN_MEMOS", "ADMIN_SISTEMA"] },
  { desde: "APROBADA",      hacia: "OBSERVADA",     roles: ["CONTABILIDAD", "ADMIN_SISTEMA"] },
  { desde: "APROBADA",      hacia: "CONTABILIZADA", roles: ["CONTABILIDAD", "ADMIN_SISTEMA"] },
  { desde: "CONTABILIZADA", hacia: "CERRADO",       roles: [], automatica: true },
];

/** Estados en los que el rendidor todavía puede tocar sus gastos. */
export const MEMO_EDITABLE: EstadoMemo[] = ["ABIERTO", "EN_RENDICION", "OBSERVADA"];

/** Estados que cuentan como pendiente de rendir, para el bloqueo de §7.3. */
export const MEMO_PENDIENTE: EstadoMemo[] = ["ABIERTO", "EN_RENDICION"];

/** Estados terminales: no admiten más transiciones. */
export const MEMO_TERMINAL: EstadoMemo[] = ["CERRADO", "ANULADO"];

export function transicionMemoValida(
  desde: EstadoMemo,
  hacia: EstadoMemo,
  roles: Rol[]
): { ok: true } | { ok: false; motivo: string } {
  const t = TRANSICIONES_MEMO.find(x => x.desde === desde && x.hacia === hacia);
  if (!t) {
    return { ok: false, motivo: `No se puede pasar de ${desde} a ${hacia}.` };
  }
  if (t.automatica) {
    return { ok: false, motivo: `La transición a ${hacia} la produce el sistema, no un usuario.` };
  }
  if (!t.roles.some(r => roles.includes(r))) {
    return { ok: false, motivo: `Tu rol no permite pasar el memo a ${hacia}.` };
  }
  return { ok: true };
}

/** Transición que dispara el sistema, sin rol de por medio. */
export function transicionMemoAutomatica(desde: EstadoMemo, hacia: EstadoMemo): boolean {
  return TRANSICIONES_MEMO.some(t => t.desde === desde && t.hacia === hacia && t.automatica);
}

export function estadosSiguientesMemo(desde: EstadoMemo, roles: Rol[]): EstadoMemo[] {
  return TRANSICIONES_MEMO
    .filter(t => t.desde === desde && !t.automatica && t.roles.some(r => roles.includes(r)))
    .map(t => t.hacia);
}

// ════════════════════════════════════════════════════════════════
// GASTO (§4.2)
// ════════════════════════════════════════════════════════════════

const TRANSICIONES_GASTO: Record<EstadoGasto, EstadoGasto[]> = {
  CAPTURADO:        ["EXTRAIDO", "ERROR_EXTRACCION"],
  ERROR_EXTRACCION: ["EXTRAIDO", "CAPTURADO"],
  // Tras extraer: si alguna validación falla va a CON_ALERTA, si no a VALIDADO.
  EXTRAIDO:         ["CON_ALERTA", "VALIDADO", "ERROR_EXTRACCION"],
  CON_ALERTA:       ["VALIDADO", "ERROR_EXTRACCION"],
  VALIDADO:         ["PRESENTADO", "CON_ALERTA"],
  PRESENTADO:       ["APROBADO", "OBSERVADO"],
  OBSERVADO:        ["VALIDADO", "CON_ALERTA"],
  APROBADO:         ["CONTABILIZADO", "OBSERVADO"],
  CONTABILIZADO:    [],
};

/** El rendidor puede editar el gasto en estos estados. */
export const GASTO_EDITABLE: EstadoGasto[] = [
  "CAPTURADO", "EXTRAIDO", "ERROR_EXTRACCION", "CON_ALERTA", "VALIDADO", "OBSERVADO",
];

/** Estados que cuentan al sumar lo rendido. */
export const GASTO_CUENTA_EN_TOTAL: EstadoGasto[] = [
  "EXTRAIDO", "CON_ALERTA", "VALIDADO", "PRESENTADO", "APROBADO", "CONTABILIZADO",
];

/** Estados que impiden presentar la rendición (§6.1). */
export const GASTO_IMPIDE_PRESENTAR: EstadoGasto[] = ["CAPTURADO", "ERROR_EXTRACCION"];

export function transicionGastoValida(desde: EstadoGasto, hacia: EstadoGasto): boolean {
  return TRANSICIONES_GASTO[desde]?.includes(hacia) ?? false;
}

export function gastoEsEditable(estado: EstadoGasto): boolean {
  return GASTO_EDITABLE.includes(estado);
}

// ════════════════════════════════════════════════════════════════
// Reglas compuestas
// ════════════════════════════════════════════════════════════════

/**
 * Un gasto solo se edita si el gasto Y el memo lo permiten. Un gasto OBSERVADO
 * dentro de un memo OBSERVADA es el caso que habilita la corrección parcial:
 * el resto de la rendición sigue congelada (§4.1).
 */
export function puedeEditarGasto(
  estadoGasto: EstadoGasto,
  estadoMemo: EstadoMemo | null
): boolean {
  if (!gastoEsEditable(estadoGasto)) return false;
  if (estadoMemo === null) return true;            // bandeja sin asignar (§2.3)
  if (estadoMemo === "OBSERVADA") return estadoGasto === "OBSERVADO";
  return MEMO_EDITABLE.includes(estadoMemo);
}

export interface ImpedimentoPresentar {
  motivo: string;
  cantidad: number;
}

/**
 * Comprueba si la rendición puede presentarse. Devuelve la lista de
 * impedimentos para mostrarlos todos juntos, no de a uno.
 */
export function impedimentosParaPresentar(gastos: Array<{
  estado: EstadoGasto;
  alertas: Array<{ severidad: string }>;
  alertas_confirmadas: boolean;
}>): ImpedimentoPresentar[] {
  const impedimentos: ImpedimentoPresentar[] = [];

  if (gastos.length === 0) {
    impedimentos.push({ motivo: "La rendición no tiene ningún gasto.", cantidad: 0 });
    return impedimentos;
  }

  const sinProcesar = gastos.filter(g => GASTO_IMPIDE_PRESENTAR.includes(g.estado));
  if (sinProcesar.length) {
    impedimentos.push({
      motivo: "Hay gastos sin extraer o con error de extracción.",
      cantidad: sinProcesar.length,
    });
  }

  const bloqueantes = gastos.filter(g => g.alertas.some(a => a.severidad === "bloqueante"));
  if (bloqueantes.length) {
    impedimentos.push({
      motivo: "Hay gastos con alertas bloqueantes (duplicados).",
      cantidad: bloqueantes.length,
    });
  }

  const sinConfirmar = gastos.filter(
    g => g.alertas.length > 0
      && !g.alertas.some(a => a.severidad === "bloqueante")
      && !g.alertas_confirmadas
  );
  if (sinConfirmar.length) {
    impedimentos.push({
      motivo: "Hay gastos con alertas sin confirmar.",
      cantidad: sinConfirmar.length,
    });
  }

  return impedimentos;
}
