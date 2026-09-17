// Un memo se paga en más de una planilla: una por banco
//
// El memo 594-2026 autoriza S/ 9,064.00 a once personas. La planilla de
// haberes 1439 del BCP pagó S/ 5,292.00 a siete —las siete que tienen cuenta
// BCP, que es de donde sale la planilla—. Las cuatro restantes tienen
// Interbank, y sus S/ 3,772.00 salieron por otra operación contra el CCI.
//
// Leer una constancia y dar el memo por pagado deja a cuatro personas
// esperando sin que nadie lo sepa. Hay que sumarlas hasta cubrir el memo, y
// mientras no lo cubran, decir quién falta.
//
// Y la constancia trae el estado por fila: PROCESADA o RECHAZADA. Una fila
// rechazada es alguien que no cobró, y que por lo tanto no tiene nada que
// rendir. Contarla como pagada es pedirle cuentas de una plata que nunca
// recibió.

export interface LineaDePago {
  usuarioId: string;
  monto: number;
  procesada: boolean;
}

export interface Constancia {
  id: string;
  banco: string;
  planilla: string | null;
  fecha: string | null;
  lineas: LineaDePago[];
}

export interface Beneficiario {
  usuarioId: string;
  nombre: string;
  /** Lo que el anexo dice que le toca. */
  asignado: number | null;
}

export type SituacionDePago = "PAGADO" | "RECHAZADO" | "PARCIAL" | "SIN_PAGAR";

export interface EstadoDePersona {
  usuarioId: string;
  nombre: string;
  asignado: number | null;
  cobrado: number;
  /** Lo que se le intentó pagar y el banco devolvió. */
  rechazado: number;
  situacion: SituacionDePago;
}

export interface CoberturaDelMemo {
  porPersona: EstadoDePersona[];
  /** Lo que de verdad salió: solo filas procesadas. */
  pagado: number;
  autorizado: number;
  falta: number;
  /** Quiénes siguen sin cobrar, por nombre, para poder decirlo. */
  sinCobrar: string[];
  bancos: string[];
  cubierto: boolean;
}

const red = (n: number) => Math.round(n * 100) / 100;

export function cobertura(
  beneficiarios: Beneficiario[],
  constancias: Constancia[],
  montoAutorizado: number
): CoberturaDelMemo {
  const porPersona = beneficiarios.map(b => {
    const suyas = constancias.flatMap(c => c.lineas.filter(l => l.usuarioId === b.usuarioId));

    const cobrado = red(suyas.filter(l => l.procesada).reduce((s, l) => s + l.monto, 0));
    const rechazado = red(suyas.filter(l => !l.procesada).reduce((s, l) => s + l.monto, 0));

    let situacion: SituacionDePago;
    if (cobrado <= 0) {
      // Un rechazo es distinto de no haber intentado: alguien tiene que
      // volver a mandarlo, y la persona sigue sin su plata.
      situacion = rechazado > 0 ? "RECHAZADO" : "SIN_PAGAR";
    } else if (b.asignado != null && cobrado < b.asignado) {
      situacion = "PARCIAL";
    } else {
      situacion = "PAGADO";
    }

    return {
      usuarioId: b.usuarioId, nombre: b.nombre, asignado: b.asignado,
      cobrado, rechazado, situacion,
    };
  });

  const pagado = red(porPersona.reduce((s, p) => s + p.cobrado, 0));

  return {
    porPersona,
    pagado,
    autorizado: red(montoAutorizado),
    falta: red(Math.max(0, montoAutorizado - pagado)),
    sinCobrar: porPersona
      .filter(p => p.situacion !== "PAGADO")
      .map(p => p.nombre),
    bancos: [...new Set(constancias.map(c => c.banco))],
    // Cubierto no es «ya leí una constancia»: es que a todos les llegó lo
    // suyo. Con una sola planilla del 594-2026, esto sigue siendo false.
    cubierto: porPersona.length > 0 && porPersona.every(p => p.situacion === "PAGADO"),
  };
}

/** Cómo se lee cada situación en la pantalla. */
export const ETIQUETA_PAGO: Record<SituacionDePago, string> = {
  PAGADO: "Cobró",
  PARCIAL: "Cobró de menos",
  RECHAZADO: "El banco lo rechazó",
  SIN_PAGAR: "Sin pagar",
};
