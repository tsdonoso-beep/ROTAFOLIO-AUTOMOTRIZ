// Lo que cada persona tiene esperando
//
// Hasta acá la app no le avisaba nada a nadie. Todo dependía de que la
// persona entrara a mirar: el jefe no se enteraba de que tenía un visto
// bueno pendiente, el rendidor no sabía que le habían devuelto un gasto,
// y Contabilidad no veía que había una liquidación emitida sin pagar.
//
// Esto todavía no manda correos —no hay servicio configurado— pero sí
// resuelve la mitad que importa: que al entrar, cada uno vea lo suyo
// primero, en vez de tener que ir a buscarlo sección por sección.
//
// Las cuentas se hacen afuera, contra la base. Acá solo se decide qué
// merece decirse, cómo se dice y qué es urgente, que es lo que conviene
// poder probar sin una base de datos delante.

export interface ConteosPendientes {
  /** Solicitudes de apertura esperando la firma de quien mira. */
  vistoBueno: number;
  /** Gastos que le devolvieron observados. */
  gastosObservados: number;
  /** Sus memos que ya pasaron la fecha de retorno sin cerrarse. */
  rendicionesVencidas: number;
  /** Rendiciones presentadas esperando revisión. */
  porRevisar: number;
  /** Rendiciones aprobadas todavía sin contabilizar. */
  porContabilizar: number;
  /** Liquidaciones emitidas cuyo movimiento de plata no se registró. */
  porPagar: number;
  /** Borradores detenidos: esperando el visto bueno, o rechazados. */
  borradoresDetenidos: number;
}

export const SIN_PENDIENTES: ConteosPendientes = {
  vistoBueno: 0, gastosObservados: 0, rendicionesVencidas: 0,
  porRevisar: 0, porContabilizar: 0, porPagar: 0, borradoresDetenidos: 0,
};

export type ClavePendiente = keyof ConteosPendientes;

export interface Pendiente {
  clave: ClavePendiente;
  cantidad: number;
  titulo: string;
  /** Por qué le toca a esta persona y qué pasa si no lo hace. */
  detalle: string;
  ruta: string;
  /** Frena a otra persona, o ya se pasó de plazo. */
  urgente: boolean;
}

const plural = (n: number, singular: string, prural: string) =>
  `${n} ${n === 1 ? singular : prural}`;

/**
 * Qué tiene esta persona esperando, de lo más urgente a lo menos.
 *
 * El criterio de urgencia no es "hace mucho": es si estoy frenando a otro.
 * Un visto bueno sin responder tiene a alguien esperando plata que no
 * llega; una rendición por revisar, también. Lo mío que se venció es
 * urgente porque ya incumplí.
 */
export function pendientesDe(c: ConteosPendientes): Pendiente[] {
  const todos: Pendiente[] = [
    {
      clave: "vistoBueno",
      cantidad: c.vistoBueno,
      titulo: plural(c.vistoBueno, "memo espera tu visto bueno", "memos esperan tu visto bueno"),
      detalle: "Hasta que respondas, esa persona no puede recibir el adelanto.",
      ruta: "/tablero",
      urgente: true,
    },
    {
      clave: "gastosObservados",
      cantidad: c.gastosObservados,
      titulo: plural(c.gastosObservados, "comprobante te lo devolvieron", "comprobantes te los devolvieron"),
      detalle: "Corrígelos y vuelve a presentar la rendición.",
      ruta: "/memos",
      urgente: true,
    },
    {
      clave: "rendicionesVencidas",
      cantidad: c.rendicionesVencidas,
      titulo: plural(c.rendicionesVencidas, "rendición tuya está vencida", "rendiciones tuyas están vencidas"),
      detalle: "Pasó la fecha de retorno. Mientras siga abierta, puede trabarte el próximo memo.",
      ruta: "/memos",
      urgente: true,
    },
    {
      clave: "porRevisar",
      cantidad: c.porRevisar,
      titulo: plural(c.porRevisar, "rendición por revisar", "rendiciones por revisar"),
      detalle: "Quien la presentó no puede cerrar su liquidación hasta que la apruebes.",
      ruta: "/revisar",
      urgente: true,
    },
    {
      clave: "porContabilizar",
      cantidad: c.porContabilizar,
      titulo: plural(c.porContabilizar, "rendición por contabilizar", "rendiciones por contabilizar"),
      detalle: "Ya están aprobadas y esperan su asiento.",
      ruta: "/contabilidad",
      urgente: false,
    },
    {
      clave: "porPagar",
      cantidad: c.porPagar,
      titulo: plural(c.porPagar, "liquidación emitida sin pagar", "liquidaciones emitidas sin pagar"),
      detalle: "El documento salió pero el movimiento de plata no está registrado.",
      ruta: "/liquidaciones",
      urgente: true,
    },
    {
      clave: "borradoresDetenidos",
      cantidad: c.borradoresDetenidos,
      titulo: plural(c.borradoresDetenidos, "memo quedó detenido", "memos quedaron detenidos"),
      detalle: "Esperan el visto bueno de Jefatura, o lo rechazaron. El rendidor todavía no los ve.",
      ruta: "/administrar",
      urgente: false,
    },
  ];

  return todos
    .filter(p => p.cantidad > 0)
    .sort((a, b) => Number(b.urgente) - Number(a.urgente));
}

/** Cuántas cosas esperan, para el número del menú. */
export function totalPendiente(c: ConteosPendientes): number {
  return pendientesDe(c).reduce((s, p) => s + p.cantidad, 0);
}

export function hayUrgentes(c: ConteosPendientes): boolean {
  return pendientesDe(c).some(p => p.urgente);
}
