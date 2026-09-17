// Qué me frena a mí
//
// El dolor declarado de la bandeja es literal: «todo se hace infinito de
// revisar». Sesenta y dos memos en una lista, y los nueve que necesitan algo
// de mí escondidos entre ellos.
//
// La respuesta no es ordenar mejor: es que la bandeja abra en lo que me frena
// y que «todas» sea una pestaña explícita. Este módulo decide qué entra en
// ese filtro, y sobre todo POR QUÉ, porque un filtro que no sabe explicarse
// obliga a abrir cada fila para averiguarlo.
//
// No inventa reglas: combina las que ya existen en estados.ts, memo.ts y
// pago.ts. Lo nuevo es sólo mirarlas juntas desde el lado de quien administra.

export type CodigoFreno =
  | "SIN_ASIGNAR"
  | "ESPERA_REVISION"
  | "OBSERVADA"
  | "BLOQUEANTES"
  | "PAGO_INCOMPLETO"
  | "PAGO_RECHAZADO"
  | "VENCIDA"
  | "ESPERA_MI_FIRMA"
  | "PLANILLA_SIN_FIRMAR";

export interface Freno {
  codigo: CodigoFreno;
  /** Cómo se lee en la fila, ya redactado. */
  texto: string;
  /** `alta` pinta en rojo; `media` en ámbar. */
  urgencia: "alta" | "media";
}

export interface MemoDeBandeja {
  id: string;
  estado: string;
  personas: number;
  /** Alertas bloqueantes no confirmadas, de todos sus gastos. */
  bloqueantes: number;
  /** Días de atraso sobre la fecha de retorno. Negativo o cero: al día. */
  diasAtraso: number;
  /** Cuánta gente cubre el memo y todavía no cobró. Null: no se sabe. */
  sinCobrar: number | null;
  /** Filas que el banco devolvió. Esa plata no salió. */
  rechazadas: number;
}

const PLURAL = (n: number, uno: string, varios: string) =>
  n === 1 ? `1 ${uno}` : `${n} ${varios}`;

/**
 * Por qué este memo me frena. Vacío = no me frena.
 *
 * El orden importa: lo primero de la lista es lo que se muestra en la fila
 * cuando no caben todos, así que va de lo más accionable a lo más informativo.
 */
export function frenos(m: MemoDeBandeja): Freno[] {
  const f: Freno[] = [];

  // Un memo sin nadie asignado es plata reservada que no le llega a nadie, y
  // el rendidor ni siquiera lo ve: se queda ahí para siempre.
  if (m.personas === 0 && m.estado !== "ANULADO" && m.estado !== "CERRADO") {
    f.push({
      codigo: "SIN_ASIGNAR",
      texto: "Falta asignar persona",
      urgencia: "alta",
    });
  }

  // El banco devolvió una fila: esa persona no cobró, y alguien tiene que
  // volver a mandarla. Va antes que el pago incompleto porque tiene culpable.
  if (m.rechazadas > 0) {
    f.push({
      codigo: "PAGO_RECHAZADO",
      texto: `${PLURAL(m.rechazadas, "abono rechazado", "abonos rechazados")} por el banco`,
      urgencia: "alta",
    });
  }

  // Un memo se paga en una planilla por banco. Con una sola registrada, la
  // gente de los otros bancos sigue esperando sin que nadie lo sepa.
  if (m.sinCobrar != null && m.sinCobrar > 0) {
    f.push({
      codigo: "PAGO_INCOMPLETO",
      texto: m.sinCobrar === 1
        ? "1 persona no ha cobrado"
        : `${m.sinCobrar} personas no han cobrado`,
      urgencia: "media",
    });
  }

  if (m.estado === "PRESENTADA") {
    f.push({ codigo: "ESPERA_REVISION", texto: "Espera tu revisión", urgencia: "alta" });
  }

  if (m.estado === "OBSERVADA") {
    f.push({
      codigo: "OBSERVADA",
      texto: "Devuelta, sin corregir todavía",
      urgencia: "media",
    });
  }

  if (m.bloqueantes > 0) {
    f.push({
      codigo: "BLOQUEANTES",
      texto: `${PLURAL(m.bloqueantes, "comprobante", "comprobantes")} que impide${m.bloqueantes === 1 ? "" : "n"} presentar`,
      urgencia: "alta",
    });
  }

  if (m.diasAtraso > 0) {
    f.push({
      codigo: "VENCIDA",
      texto: `${PLURAL(m.diasAtraso, "día", "días")} de atraso`,
      urgencia: m.diasAtraso >= 15 ? "alta" : "media",
    });
  }

  return f;
}

export const meFrena = (m: MemoDeBandeja): boolean => frenos(m).length > 0;

/**
 * El freno que se muestra cuando sólo cabe uno.
 *
 * Se prefiere el de urgencia alta; a igualdad, el primero, que es el más
 * accionable por el orden en que se arman.
 */
export function frenoPrincipal(m: MemoDeBandeja): Freno | null {
  const f = frenos(m);
  return f.find(x => x.urgencia === "alta") ?? f[0] ?? null;
}

// ────────────────────────────────────────────────────────────────
// Las pestañas
// ────────────────────────────────────────────────────────────────

export type ClaveFiltro =
  | "me-frena" | "presentadas" | "pago" | "borradores" | "atrasadas" | "todas";

export interface Filtro {
  clave: ClaveFiltro;
  etiqueta: string;
  /** Qué memos deja pasar. */
  pasa: (m: MemoDeBandeja) => boolean;
}

export const FILTROS: Filtro[] = [
  { clave: "me-frena",    etiqueta: "Me frena a mí", pasa: meFrena },
  { clave: "presentadas", etiqueta: "Presentadas",   pasa: m => m.estado === "PRESENTADA" },
  {
    clave: "pago",
    etiqueta: "Pagados a medias",
    pasa: m => (m.sinCobrar != null && m.sinCobrar > 0) || m.rechazadas > 0,
  },
  { clave: "borradores",  etiqueta: "Borradores",    pasa: m => m.estado === "BORRADOR" },
  { clave: "atrasadas",   etiqueta: "Atrasadas",     pasa: m => m.diasAtraso > 0 },
  { clave: "todas",       etiqueta: "Todas",         pasa: () => true },
];

/** Cuántos memos caen en cada pestaña, para el número del rótulo. */
export function conteos(memos: MemoDeBandeja[]): Record<ClaveFiltro, number> {
  const r = {} as Record<ClaveFiltro, number>;
  for (const f of FILTROS) r[f.clave] = memos.filter(f.pasa).length;
  return r;
}

/**
 * La bandeja abre siempre en «me frena a mí» — salvo que no frene nada, en
 * cuyo caso abrir en una lista vacía sería decirle a alguien que su trabajo
 * no existe. Ahí se abre en todas.
 */
export function filtroInicial(memos: MemoDeBandeja[]): ClaveFiltro {
  return memos.some(meFrena) ? "me-frena" : "todas";
}
