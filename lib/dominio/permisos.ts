// Matriz de permisos — SPEC §3.1
//
// "Implementar como comprobación en el servidor, no solo escondiendo botones
// en la interfaz." Este módulo es la fuente única: la interfaz lo usa para
// decidir qué muestra y cada ruta de API lo usa para decidir si ejecuta.

import type { Rol } from "./tipos.ts";

export type Accion =
  | "ver_memos_propios"
  | "ver_memos_ajenos"
  | "crear_memo"
  | "asignar_persona"
  | "capturar_gasto"
  | "editar_gasto_no_presentado"
  | "presentar_rendicion"
  | "observar_devolver"
  | "aprobar_rendicion"
  | "marcar_contabilizado"
  | "exportar"
  | "autorizar_apertura_con_pendientes"
  | "editar_catalogos"
  | "ver_tablero";

/**
 * `"si"`     — permitido sin restricción
 * `"propio"` — solo sobre entidades del propio usuario
 * `"area"`   — solo sobre entidades de su área
 * ausente    — denegado
 */
export type Alcance = "si" | "propio" | "area";

const MATRIZ: Record<Accion, Partial<Record<Rol, Alcance>>> = {
  ver_memos_propios: {
    RENDIDOR: "si", ADMIN_MEMOS: "si", REVISOR_COSTOS: "si",
    CONTABILIDAD: "si", JEFATURA: "si", ADMIN_SISTEMA: "si",
  },
  ver_memos_ajenos: {
    ADMIN_MEMOS: "si", REVISOR_COSTOS: "si", CONTABILIDAD: "si",
    JEFATURA: "area", ADMIN_SISTEMA: "si",
  },
  crear_memo: {
    ADMIN_MEMOS: "si", ADMIN_SISTEMA: "si",
  },
  asignar_persona: {
    ADMIN_MEMOS: "si", ADMIN_SISTEMA: "si",
  },
  capturar_gasto: {
    RENDIDOR: "si", ADMIN_MEMOS: "si", ADMIN_SISTEMA: "si",
  },
  editar_gasto_no_presentado: {
    RENDIDOR: "propio", ADMIN_MEMOS: "si", ADMIN_SISTEMA: "si",
  },
  presentar_rendicion: {
    RENDIDOR: "propio", ADMIN_MEMOS: "si", ADMIN_SISTEMA: "si",
  },
  observar_devolver: {
    REVISOR_COSTOS: "si", CONTABILIDAD: "si", ADMIN_SISTEMA: "si",
  },
  aprobar_rendicion: {
    REVISOR_COSTOS: "si", ADMIN_SISTEMA: "si",
  },
  marcar_contabilizado: {
    CONTABILIDAD: "si", ADMIN_SISTEMA: "si",
  },
  exportar: {
    ADMIN_MEMOS: "si", REVISOR_COSTOS: "si", CONTABILIDAD: "si", ADMIN_SISTEMA: "si",
  },
  autorizar_apertura_con_pendientes: {
    JEFATURA: "si", ADMIN_SISTEMA: "si",
  },
  editar_catalogos: {
    ADMIN_SISTEMA: "si",
  },
  ver_tablero: {
    RENDIDOR: "propio", ADMIN_MEMOS: "si", REVISOR_COSTOS: "si",
    CONTABILIDAD: "si", JEFATURA: "area", ADMIN_SISTEMA: "si",
  },
};

/** Alcance más amplio que los roles del usuario le conceden sobre la acción. */
export function alcanceDe(roles: Rol[], accion: Accion): Alcance | null {
  const porRol = MATRIZ[accion];
  if (!porRol) return null;

  let mejor: Alcance | null = null;
  for (const rol of roles) {
    const a = porRol[rol];
    if (!a) continue;
    if (a === "si") return "si";             // no hay nada más amplio
    if (a === "area") mejor = "area";
    else if (a === "propio" && mejor === null) mejor = "propio";
  }
  return mejor;
}

export function puede(roles: Rol[], accion: Accion): boolean {
  return alcanceDe(roles, accion) !== null;
}

export interface ContextoRecurso {
  /** Dueño del recurso: quién capturó el gasto o tiene asignado el memo. */
  propietarioId?: string;
  /** Área del recurso, para el alcance "area". */
  areaId?: string;
}

export interface Solicitante {
  usuarioId: string;
  areaId: string | null;
  roles: Rol[];
}

/**
 * Comprobación completa: rol + alcance sobre el recurso concreto.
 * Es la que deben llamar las rutas de API antes de ejecutar.
 */
export function autoriza(
  solicitante: Solicitante,
  accion: Accion,
  recurso: ContextoRecurso = {}
): { ok: true } | { ok: false; motivo: string } {
  const alcance = alcanceDe(solicitante.roles, accion);

  if (alcance === null) {
    return { ok: false, motivo: `Tu rol no permite la acción «${accion}».` };
  }
  if (alcance === "si") return { ok: true };

  if (alcance === "propio") {
    if (recurso.propietarioId === undefined) {
      // Sin dueño declarado no se puede comprobar: se deniega por defecto.
      return { ok: false, motivo: "No se pudo determinar el propietario del recurso." };
    }
    return recurso.propietarioId === solicitante.usuarioId
      ? { ok: true }
      : { ok: false, motivo: "Solo puedes operar sobre tus propios registros." };
  }

  // alcance === "area"
  if (recurso.areaId === undefined || solicitante.areaId === null) {
    return { ok: false, motivo: "No se pudo determinar el área del recurso." };
  }
  return recurso.areaId === solicitante.areaId
    ? { ok: true }
    : { ok: false, motivo: "Solo puedes operar sobre registros de tu área." };
}

/** Roles que ven cualquier memo o gasto. Refleja `puede_ver_todo()` en SQL. */
export function veTodo(roles: Rol[]): boolean {
  return alcanceDe(roles, "ver_memos_ajenos") === "si";
}
