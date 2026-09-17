// La solicitud: el primer paso, que vivía fuera de todo sistema
//
// El proceso real no empieza en el memo. Empieza en que alguien necesita
// viajar:
//
//   «el personal solicita el memo, internamente le pide su autorización a su
//    jefatura, y la jefatura lo comunica para que se pueda aprobar»
//
// Eso pasaba «por fuera de todo sistema, en una conversación que no deja
// rastro». La aplicación sabía quién tecleó cada memo, pero no quién lo
// pidió ni por qué.
//
// Una solicitud no es un memo. No tiene correlativo, no compromete plata y
// no llega a contabilidad: es un pedido con un visto bueno. Recién cuando la
// jefatura firma, Administración la emite y ahí nace el memo.

export type EstadoSolicitud =
  | "PENDIENTE"
  | "APROBADA"
  | "RECHAZADA"
  | "CONVERTIDA"
  | "ANULADA";

const TRANSICIONES: Record<EstadoSolicitud, EstadoSolicitud[]> = {
  PENDIENTE: ["APROBADA", "RECHAZADA", "ANULADA"],
  // Aprobada y todavía sin emitir: quien la pidió puede retirarla —el viaje
  // se cayó— y la jefatura puede arrepentirse mientras no haya memo.
  APROBADA: ["CONVERTIDA", "ANULADA", "RECHAZADA"],
  // Una vez que hay memo, lo que se discute es el memo, no el pedido.
  CONVERTIDA: [],
  RECHAZADA: [],
  ANULADA: [],
};

export function transicionSolicitudValida(
  desde: EstadoSolicitud, hacia: EstadoSolicitud
): boolean {
  return TRANSICIONES[desde].includes(hacia);
}

/** Estados en los que el pedido todavía está en juego. */
export const SOLICITUD_VIVA: EstadoSolicitud[] = ["PENDIENTE", "APROBADA"];

export interface Solicitud {
  id: string;
  estado: EstadoSolicitud;
  solicitanteId: string;
  jefaturaId: string | null;
  personas: string[];
}

export interface Veredicto {
  puede: boolean;
  motivo: string;
}

/**
 * Quién puede responder un pedido.
 *
 * Tres reglas, y las tres salen del mismo sitio: una firma tiene que ser de
 * alguien.
 *
 *   · Nadie se autoriza a sí mismo, aunque tenga el rol.
 *   · Nadie autoriza un viaje del que él mismo es beneficiario.
 *   · Si a la solicitud se le pidió la firma a una jefatura concreta, es esa
 *     jefatura la que responde. Mandarle el pedido a cualquiera con el rol
 *     sería una firma falsa.
 */
export function puedeResponder(
  s: Solicitud,
  quien: { usuarioId: string; esJefatura: boolean; esAdminSistema: boolean }
): Veredicto {
  if (s.estado !== "PENDIENTE") {
    return { puede: false, motivo: "Este pedido ya fue respondido." };
  }
  if (quien.usuarioId === s.solicitanteId) {
    return {
      puede: false,
      motivo: "No puedes dar el visto bueno a tu propio pedido.",
    };
  }
  if (s.personas.includes(quien.usuarioId)) {
    return {
      puede: false,
      motivo: "Este pedido te cubre a ti, así que no puedes autorizarlo.",
    };
  }
  // El administrador del sistema existe para destrabar, no para firmar en
  // lugar de nadie; pero sin jefatura registrada alguien tiene que poder.
  if (s.jefaturaId) {
    if (s.jefaturaId === quien.usuarioId) return { puede: true, motivo: "" };
    if (quien.esAdminSistema) return { puede: true, motivo: "" };
    return {
      puede: false,
      motivo: "Este pedido está esperando la firma de otra jefatura.",
    };
  }
  if (quien.esJefatura || quien.esAdminSistema) return { puede: true, motivo: "" };
  return { puede: false, motivo: "Solo una jefatura puede responder un pedido." };
}

/**
 * Si el pedido ya se puede convertir en memo.
 *
 * Emitir un memo de un pedido sin firma es exactamente lo que se quería
 * dejar de hacer.
 */
export function puedeEmitirse(s: Solicitud): Veredicto {
  if (s.estado === "APROBADA") return { puede: true, motivo: "" };
  if (s.estado === "PENDIENTE") {
    return {
      puede: false,
      motivo: "Falta el visto bueno de la jefatura. Emitir el memo ahora sería "
        + "volver a lo de antes: un memo sin nadie que lo haya autorizado.",
    };
  }
  if (s.estado === "CONVERTIDA") {
    return { puede: false, motivo: "Este pedido ya tiene su memo." };
  }
  return { puede: false, motivo: "Este pedido no sigue en pie." };
}

/** Cómo se lee el estado en la pantalla. */
export const ETIQUETA_SOLICITUD: Record<EstadoSolicitud, string> = {
  PENDIENTE: "Esperando firma",
  APROBADA: "Autorizada, falta emitir",
  RECHAZADA: "Rechazada",
  CONVERTIDA: "Memo emitido",
  ANULADA: "Retirada",
};
