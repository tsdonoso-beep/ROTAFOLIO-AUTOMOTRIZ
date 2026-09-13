// Cruzar lo que rendimos contra lo que SUNAT tiene registrado
//
// Son dos preguntas distintas y conviene no mezclarlas:
//
//   1. De lo que nuestra gente rindió, ¿qué le consta a SUNAT?
//   2. De lo que SUNAT recibió a nombre de la empresa, ¿qué no rindió nadie?
//
// La segunda es la que sirve desde el primer día, porque no depende de haber
// capturado nada. Una factura girada a la empresa que nadie reportó es plata
// que se gastó sin rendir, o crédito fiscal que se está perdiendo.
//
// Hay un tercer resultado que importa tanto como los otros dos: NO_COMPARABLE.
// Una boleta que el trabajador pidió a su nombre no está en la propuesta del
// RCE y nunca va a estarlo, porque el RCE trae lo emitido al RUC de la
// empresa. Marcarla como "no está en SUNAT" sería acusarla de algo que no
// hizo, y a la tercera vez nadie volvería a mirar estas alertas.

export type Veredicto =
  /** Está en SUNAT, con el mismo importe. */
  | "CUADRA"
  /** Está en SUNAT, pero por otro importe. */
  | "MONTO_DISTINTO"
  /** Se puede buscar y no aparece. */
  | "NO_ESTA_EN_SUNAT"
  /** Le faltan datos para buscarlo, o es de una clase que el RCE no trae. */
  | "NO_COMPARABLE";

export interface ComprobanteNuestro {
  id: string;
  ruc: string | null;
  tipoComprobante: string | null;
  serie: string | null;
  numero: string | null;
  fechaEmision: string | null;
  total: number | null;
  proveedorNombre: string | null;
}

export interface ComprobanteSunat {
  ruc: string | null;
  tipoComprobante: string | null;
  serie: string | null;
  numero: string | null;
  fechaEmision: string | null;
  total: number | null;
  razonSocial: string | null;
  /** A qué comprobante corrige, cuando es una nota de crédito o débito. */
  modifica?: {
    tipo: string | null;
    serie: string | null;
    numero: string | null;
  } | null;
  /** Estado según SUNAT. */
  estado?: string | null;
}

export interface Emparejado {
  nuestro: ComprobanteNuestro;
  veredicto: Veredicto;
  /** La fila de SUNAT con la que se emparejó, si la hubo. */
  enSunat: ComprobanteSunat | null;
  /** Por qué no se pudo comparar. Solo en NO_COMPARABLE. */
  motivo?: string;
  /** Diferencia nuestro − SUNAT, solo en MONTO_DISTINTO. */
  diferencia?: number;
}

export interface Cruce {
  emparejados: Emparejado[];
  /** Lo que SUNAT tiene y nadie rindió. */
  soloEnSunat: ComprobanteSunat[];
  resumen: {
    cuadran: number;
    montoDistinto: number;
    noEstanEnSunat: number;
    noComparables: number;
    soloEnSunat: number;
    /** Suma de lo que SUNAT tiene sin rendir. */
    montoSoloEnSunat: number;
  };
}

/** Solo estos llegan a la propuesta del RCE: los que se emiten a un RUC. */
const TIPOS_EN_EL_RCE = new Set(["01", "07", "08"]);

const NOMBRE_TIPO: Record<string, string> = {
  "01": "factura", "03": "boleta", "07": "nota de crédito",
  "08": "nota de débito", "12": "ticket",
};

/**
 * Cuánto puede diferir un importe y seguir siendo el mismo comprobante.
 *
 * Un céntimo de diferencia es redondeo, no una alteración. Se usa un valor
 * absoluto y no un porcentaje porque el redondeo no crece con el monto.
 */
const TOLERANCIA = 0.05;

/** La llave con la que un comprobante es único: emisor, tipo, serie y número. */
export function llaveDe(c: { ruc: string | null; tipoComprobante: string | null; serie: string | null; numero: string | null }): string | null {
  if (!c.ruc || !c.serie || !c.numero) return null;
  const tipo = c.tipoComprobante ?? "";
  return `${c.ruc}|${tipo}|${c.serie.toUpperCase()}|${c.numero.replace(/^0+/, "") || "0"}`;
}

/** La misma llave sin el tipo, para cuando uno de los dos lados no lo trae. */
function llaveSinTipo(c: { ruc: string | null; serie: string | null; numero: string | null }): string | null {
  if (!c.ruc || !c.serie || !c.numero) return null;
  return `${c.ruc}|${c.serie.toUpperCase()}|${c.numero.replace(/^0+/, "") || "0"}`;
}

/** Por qué un comprobante nuestro no se puede buscar en el RCE. */
export function razonDeNoComparable(c: ComprobanteNuestro): string | null {
  if (c.tipoComprobante && !TIPOS_EN_EL_RCE.has(c.tipoComprobante)) {
    const nombre = NOMBRE_TIPO[c.tipoComprobante] ?? `tipo ${c.tipoComprobante}`;
    return `Es una ${nombre}: el RCE solo trae lo que se emite al RUC de la empresa.`;
  }
  if (!c.ruc) return "No se leyó el RUC del proveedor.";
  if (!/^[0-9]{11}$/.test(c.ruc)) return `El RUC «${c.ruc}» no tiene 11 dígitos.`;
  if (!c.serie) return "No se leyó la serie.";
  if (!c.numero) return "No se leyó el número.";
  return null;
}

/**
 * Cruza las dos listas.
 *
 * Empareja primero por llave completa y después, con lo que quedó suelto,
 * por llave sin tipo: es habitual que un lado escriba el tipo y el otro no,
 * y no emparejar por eso daría una alerta falsa.
 */
export function cruzar(nuestros: ComprobanteNuestro[], enSunat: ComprobanteSunat[]): Cruce {
  const porLlave = new Map<string, ComprobanteSunat>();
  const porLlaveSinTipo = new Map<string, ComprobanteSunat>();

  for (const s of enSunat) {
    const k = llaveDe(s);
    if (k && !porLlave.has(k)) porLlave.set(k, s);
    const k2 = llaveSinTipo(s);
    if (k2 && !porLlaveSinTipo.has(k2)) porLlaveSinTipo.set(k2, s);
  }

  const usados = new Set<ComprobanteSunat>();
  const emparejados: Emparejado[] = [];

  for (const n of nuestros) {
    const motivo = razonDeNoComparable(n);
    if (motivo) {
      emparejados.push({ nuestro: n, veredicto: "NO_COMPARABLE", enSunat: null, motivo });
      continue;
    }

    const k = llaveDe(n);
    const k2 = llaveSinTipo(n);
    const hallado = (k && porLlave.get(k)) || (k2 && porLlaveSinTipo.get(k2)) || null;

    if (!hallado) {
      emparejados.push({ nuestro: n, veredicto: "NO_ESTA_EN_SUNAT", enSunat: null });
      continue;
    }

    usados.add(hallado);

    // Sin importe en alguno de los dos lados no se puede afirmar que
    // difieran. Se da por cuadrado y el dato faltante ya tiene su alerta.
    if (n.total == null || hallado.total == null) {
      emparejados.push({ nuestro: n, veredicto: "CUADRA", enSunat: hallado });
      continue;
    }

    const dif = Math.round((n.total - hallado.total) * 100) / 100;
    if (Math.abs(dif) > TOLERANCIA) {
      emparejados.push({ nuestro: n, veredicto: "MONTO_DISTINTO", enSunat: hallado, diferencia: dif });
    } else {
      emparejados.push({ nuestro: n, veredicto: "CUADRA", enSunat: hallado });
    }
  }

  const soloEnSunat = enSunat.filter(s => !usados.has(s));
  const cuenta = (v: Veredicto) => emparejados.filter(e => e.veredicto === v).length;

  return {
    emparejados,
    soloEnSunat,
    resumen: {
      cuadran: cuenta("CUADRA"),
      montoDistinto: cuenta("MONTO_DISTINTO"),
      noEstanEnSunat: cuenta("NO_ESTA_EN_SUNAT"),
      noComparables: cuenta("NO_COMPARABLE"),
      soloEnSunat: soloEnSunat.length,
      montoSoloEnSunat: Math.round(soloEnSunat.reduce((a, s) => a + (s.total ?? 0), 0) * 100) / 100,
    },
  };
}

// ════════════════════════════════════════════════════════════════
// Notas de crédito sobre lo que alguien ya rindió

/** Una nota que afecta a un comprobante que nuestra gente sí reportó. */
export interface NotaSobreLoRendido {
  /** El comprobante nuestro al que le cae la nota. */
  nuestro: ComprobanteNuestro;
  /** La nota, tal como la tiene SUNAT. */
  nota: ComprobanteSunat;
  /** Cuánto queda del gasto después de la nota, si se puede calcular. */
  quedaEn: number | null;
  /** Si la nota cubre el comprobante entero. */
  anulaTodo: boolean;
}

/** Tipos que corrigen otro comprobante. */
const NOTAS = new Set(["07", "08"]);

/**
 * Busca las notas que afectan a comprobantes que nuestra gente rindió.
 *
 * Es la diferencia entre un dato y un aviso. SUNAT dice que existe una nota
 * de crédito; lo que importa acá es que la factura que corrige es una que
 * alguien fotografió, presentó y quizá ya le pagaron. Sin cruzarla contra lo
 * rendido, la nota es una fila más en un archivo de tres mil.
 *
 * Las notas sobre comprobantes que nadie rindió no se devuelven: son asunto
 * de Contabilidad por su vía normal, y mezclarlas haría que el aviso que sí
 * importa se pierda entre cientos.
 */
export function notasSobreLoRendido(
  nuestros: ComprobanteNuestro[], enSunat: ComprobanteSunat[]
): NotaSobreLoRendido[] {
  const mios = new Map<string, ComprobanteNuestro>();
  for (const n of nuestros) {
    const k = llaveDe(n);
    if (k) mios.set(k, n);
  }
  if (mios.size === 0) return [];

  const salida: NotaSobreLoRendido[] = [];

  for (const s of enSunat) {
    if (!s.tipoComprobante || !NOTAS.has(s.tipoComprobante)) continue;
    if (!s.modifica) continue;

    // La nota apunta al comprobante corregido, pero lo emite el mismo
    // proveedor: el RUC para buscarlo es el de la nota.
    const afectado = llaveDe({
      ruc: s.ruc,
      tipoComprobante: s.modifica.tipo,
      serie: s.modifica.serie,
      numero: s.modifica.numero,
    });
    if (!afectado) continue;

    const nuestro = mios.get(afectado);
    if (!nuestro) continue;

    // SUNAT registra las notas de crédito en negativo. Se toma el valor
    // absoluto para no depender del signo, que no siempre viene igual.
    const monto = s.total == null ? null : Math.abs(s.total);
    const original = nuestro.total;
    const quedaEn = monto == null || original == null
      ? null
      : Math.round((original - monto) * 100) / 100;

    salida.push({
      nuestro,
      nota: s,
      quedaEn,
      // Un céntimo de holgura, igual que al comparar importes: el redondeo
      // no debería cambiar «anulada» por «rebajada».
      anulaTodo: quedaEn != null && Math.abs(quedaEn) <= 0.05,
    });
  }

  return salida;
}
