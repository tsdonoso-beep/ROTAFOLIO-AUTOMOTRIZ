// El visto bueno del jefe para abrir plata nueva (§7.3)
//
// La regla de fondo es simple: no se le entrega un memo nuevo a quien no
// rindió el anterior. Lo que no era simple es la excepción, porque en la
// práctica a veces hay que abrirlo igual —la obra no espera— y alguien
// tiene que hacerse cargo de esa decisión.
//
// El equipo resolvió que se la haga cargo el jefe, y que le llegue como una
// solicitud en vez de ser una casilla que marca quien redacta el memo. Es
// la diferencia entre una firma y un formulario que declara que alguien
// firmó.
//
// Este módulo es la parte que se puede razonar sin base de datos: a quién
// hay que preguntarle, y si con las respuestas que hay el memo ya se puede
// abrir.

export type EstadoAutorizacion = "PENDIENTE" | "CONCEDIDA" | "RECHAZADA";

export interface Autorizacion {
  id: string;
  jefeId: string;
  jefeNombre: string;
  estado: EstadoAutorizacion;
  respuesta: string | null;
  /** El monto que se le puso delante al firmar, congelado. */
  monto: number;
}

export interface PersonaBloqueada {
  usuarioId: string;
  nombre: string;
  jefeId: string | null;
}

export interface AQuienPreguntar {
  /** Jefes a los que hay que pedirles el visto bueno, sin repetir. */
  jefes: string[];
  /**
   * Personas cuya jefatura no está registrada. No se les puede pedir nada
   * a nadie: la app no inventa un aprobador.
   */
  sinJefe: PersonaBloqueada[];
}

export interface SituacionApertura {
  puedeAbrir: boolean;
  /** Vacío cuando se puede abrir. */
  motivo: string;
}

// ════════════════════════════════════════════════════════════════

/**
 * A qué jefes hay que preguntarles por este memo.
 *
 * Se pregunta una vez por jefe, no una por persona: si el memo va para tres
 * técnicos que reportan al mismo líder, es una sola pregunta.
 *
 * Quien no tiene jefatura registrada sale aparte y a propósito. La
 * tentación sería mandarle la solicitud a cualquiera con el rol —o peor,
 * dejar pasar el memo— y las dos cosas son una firma falsa. Mientras la
 * fuente de verdad no diga de quién depende esa persona, esto no se puede
 * resolver dentro de la app.
 */
export function aQuienPreguntar(bloqueadas: PersonaBloqueada[]): AQuienPreguntar {
  const jefes: string[] = [];
  const sinJefe: PersonaBloqueada[] = [];

  for (const p of bloqueadas) {
    if (!p.jefeId) {
      sinJefe.push(p);
      continue;
    }
    // El jefe no se autoriza a sí mismo: si quien arrastra el pendiente es
    // el propio jefe, la decisión sube un nivel y acá no hay a quién
    // preguntarle.
    if (p.jefeId === p.usuarioId) {
      sinJefe.push(p);
      continue;
    }
    if (!jefes.includes(p.jefeId)) jefes.push(p.jefeId);
  }

  return { jefes, sinJefe };
}

/**
 * Con las respuestas que hay, ¿este memo ya se puede abrir?
 *
 * Un solo rechazo alcanza para que no. No es una votación: cada jefe
 * responde por su gente, y si uno dijo que no, ese memo no debería abrirse
 * para nadie —lleva un monto y un centro de costo únicos—.
 */
export function situacionDeApertura(
  autorizaciones: Autorizacion[],
  montoActual?: number
): SituacionApertura {
  const rechazadas = autorizaciones.filter(a => a.estado === "RECHAZADA");
  if (rechazadas.length) {
    const quien = rechazadas.map(a => a.jefeNombre).join(", ");
    const porque = rechazadas.find(a => a.respuesta)?.respuesta;
    return {
      puedeAbrir: false,
      motivo: porque
        ? `${quien} rechazó la apertura: «${porque}»`
        : `${quien} rechazó la apertura.`,
    };
  }

  const pendientes = autorizaciones.filter(a => a.estado === "PENDIENTE");
  if (pendientes.length) {
    const quien = pendientes.map(a => a.jefeNombre).join(", ");
    return { puedeAbrir: false, motivo: `Esperando el visto bueno de ${quien}.` };
  }

  // El visto bueno vale por el monto que se firmó, no por el memo. Sin
  // esto la solicitud sería una constancia y no un control: se pide
  // autorización por S/ 800, se concede, y después se abre por S/ 5000.
  // La base lo rechaza igual; acá se dice antes, para no ofrecer un botón
  // que va a fallar.
  const firmada = autorizaciones.find(a => a.estado === "CONCEDIDA");
  if (firmada && montoActual !== undefined && !mismoMonto(firmada.monto, montoActual)) {
    return {
      puedeAbrir: false,
      motivo: `${firmada.jefeNombre} autorizó ${soles(firmada.monto)}, y el memo `
        + `ahora dice ${soles(montoActual)}. Hay que volver a pedir el visto bueno.`,
    };
  }

  return { puedeAbrir: true, motivo: "" };
}

/** Comparación en céntimos: 800.1 - 800.1 no siempre da cero en binario. */
function mismoMonto(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

function soles(n: number): string {
  return `S/ ${n.toFixed(2)}`;
}

/** Cómo se nombra el estado de una solicitud en pantalla. */
export const NOMBRE_AUTORIZACION: Record<EstadoAutorizacion, string> = {
  PENDIENTE: "Esperando respuesta",
  CONCEDIDA: "Autorizado",
  RECHAZADA: "Rechazado",
};
