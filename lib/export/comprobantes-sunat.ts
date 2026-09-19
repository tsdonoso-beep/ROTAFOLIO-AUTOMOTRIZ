// El histórico de comprobantes de SUNAT, como hoja
//
// Contabilidad trabaja en Excel, y filtrar tres mil filas por proveedor o por
// mes es exactamente lo que una hoja hace bien. Por eso la hoja es la salida
// y no el almacén: lo que permite detectar que un comprobante cambió es
// tenerlos guardados, no exportarlos.
//
// Las columnas del final —«corrige a», «lo rindió»— son las que no se pueden
// sacar del portal de SUNAT. Son el motivo de que esta hoja valga más que
// bajar el archivo a mano.

export interface ComprobanteHistorico {
  periodo: string;
  proveedorRuc: string | null;
  proveedorNombre: string | null;
  tipoComprobante: string | null;
  serie: string | null;
  numero: string | null;
  fechaEmision: string | null;
  total: number | null;
  moneda: string | null;
  estado: string | null;
  /** Base imponible: la suma de los tres destinos. */
  base: number | null;
  /** IGV: la suma de los tres destinos. El desglose vive en la base. */
  igv: number | null;
  detraccion: number | null;
  tipoCambio: number | null;
  tipoNota: string | null;
  modificaTipo: string | null;
  modificaSerie: string | null;
  modificaNumero: string | null;
  carSunat: string | null;
  primeraVez: string;
  ultimaVez: string;
  /** Quién lo rindió en la aplicación, si alguien lo hizo. */
  rendidoPor: string | null;
  /** Si el comprobante cambió desde que lo vimos por primera vez. */
  cambios: number;
}

/**
 * La condición del proveedor ante SUNAT (Buen Contribuyente, Agente de
 * Retención/Percepción), tal como la guarda `padron_ruc`. De ahí depende si
 * a la compra le corresponde o no la retención del IGV.
 */
export interface CondicionProveedor {
  /** "HABIDO" / "NO HABIDO". */
  condicion: string | null;
  buenContribuyente: boolean;
  agenteRetencion: boolean;
  agentePercepcion: boolean;
}

/**
 * Arma el mapa RUC → condición desde las filas crudas de `padron_ruc`
 * (snake_case, tal como las devuelve PostgREST), para no repetir esta
 * conversión en cada sitio que publica la hoja.
 */
export function mapaPadronPorRuc(filas: Array<Record<string, unknown>>): Map<string, CondicionProveedor> {
  const mapa = new Map<string, CondicionProveedor>();
  for (const f of filas) {
    const ruc = f.ruc as string | null;
    if (!ruc) continue;
    mapa.set(ruc, {
      condicion: (f.condicion as string) ?? null,
      buenContribuyente: Boolean(f.buen_contribuyente),
      agenteRetencion: Boolean(f.agente_retencion),
      agentePercepcion: Boolean(f.agente_percepcion),
    });
  }
  return mapa;
}

// El orden importa: lo que Contabilidad busca primero va a la izquierda, y
// lo técnico al final. Cambiarlo después rompe lo que alguien haya armado
// encima, así que se decide una vez. Las de la condición del RUC se
// agregaron después: van al final, no intercaladas, para no correr las
// columnas que alguien ya tenga referenciadas.
export const CABECERAS_SUNAT = [
  "Período", "RUC proveedor", "Proveedor", "Tipo", "Serie", "Número",
  "Fecha de emisión", "Moneda", "Tipo de cambio",
  "Base imponible", "IGV", "Total", "Detracción",
  "Estado", "Es nota de", "Corrige a", "Lo rindió", "Cambios detectados",
  "Visto por primera vez", "Visto por última vez", "CAR SUNAT",
  "Condición SUNAT", "Buen Contribuyente", "Agente de Retención", "Agente de Percepción",
];

/**
 * De qué es cada columna.
 *
 * Va pegado a las cabeceras y en el mismo orden porque son la misma decisión:
 * si se agrega una columna acá arriba hay que decir también qué contiene.
 *
 * Existe porque la hoja de Google adivina, y adivina mal. Con el archivo en
 * inglés —que es como está— leyó «11/12/2025» como 12 de noviembre en vez de
 * 11 de diciembre, y lo dejó viéndose igual: la fecha se muestra bien y se
 * ordena mal. Las que tenían día mayor que 12 se salvaron por accidente. Y una
 * serie «0001» adivinada como número pierde los ceros y deja de calzar con el
 * comprobante.
 *
 * Por eso no se le deja adivinar nada: cada columna se manda con su tipo.
 * Identificador es todo lo que se parece a un número pero no se suma —RUC,
 * serie, número, período, código— y va como texto a propósito.
 */
export type TipoColumna = "texto" | "numero" | "fecha";

export const TIPOS_SUNAT: TipoColumna[] = [
  "texto",  // Período
  "texto",  // RUC proveedor
  "texto",  // Proveedor
  "texto",  // Tipo
  "texto",  // Serie
  "texto",  // Número
  "fecha",  // Fecha de emisión
  "texto",  // Moneda
  "numero", // Tipo de cambio
  "numero", // Base imponible
  "numero", // IGV
  "numero", // Total
  "numero", // Detracción
  "texto",  // Estado
  "texto",  // Es nota de
  "texto",  // Corrige a
  "texto",  // Lo rindió
  "texto",  // Cambios detectados
  "fecha",  // Visto por primera vez
  "fecha",  // Visto por última vez
  "texto",  // CAR SUNAT
  "texto",  // Condición SUNAT
  "texto",  // Buen Contribuyente
  "texto",  // Agente de Retención
  "texto",  // Agente de Percepción
];

const NOMBRE_TIPO: Record<string, string> = {
  "01": "Factura", "03": "Boleta", "07": "Nota de crédito",
  "08": "Nota de débito", "12": "Ticket",
};

/** El tipo con su nombre, que es lo que alguien lee en una hoja. */
export function nombreDeTipo(codigo: string | null): string {
  if (!codigo) return "";
  return NOMBRE_TIPO[codigo] ?? codigo;
}

// Vacío cuando no hay dato, no un cero: un IGV en cero es una operación
// exonerada y uno vacío es un dato que no vino. Confundirlos haría que una
// exoneración parezca un hueco, y al revés.
const num = (v: number | null) => (v == null ? "" : Number(v).toFixed(2));

/** El tipo de cambio lleva cuatro decimales, que es como lo publica SUNAT. */
const cambio = (v: number | null) => (v == null ? "" : Number(v).toFixed(4));

/** La fecha como la espera Excel en español. */
export function fechaCorta(iso: string | null): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/**
 * `padronPorRuc` es opcional: si no se pasa (o el proveedor todavía no se
 * consultó), las cuatro columnas de condición salen vacías, no "No" — un
 * proveedor sin consultar y uno que de verdad no es Agente de Retención no
 * son el mismo dato.
 */
export function filasComprobantesSunat(
  cs: ComprobanteHistorico[], padronPorRuc?: Map<string, CondicionProveedor>
): string[][] {
  const siNo = (v: boolean) => (v ? "Sí" : "No");

  return [
    CABECERAS_SUNAT,
    ...cs.map(c => {
      const padron = c.proveedorRuc ? padronPorRuc?.get(c.proveedorRuc) : undefined;
      return [
      c.periodo,
      c.proveedorRuc ?? "",
      c.proveedorNombre ?? "",
      nombreDeTipo(c.tipoComprobante),
      c.serie ?? "",
      c.numero ?? "",
      fechaCorta(c.fechaEmision),
      c.moneda ?? "",
      cambio(c.tipoCambio),
      num(c.base),
      num(c.igv),
      num(c.total),
      num(c.detraccion),
      c.estado ?? "",
      c.tipoNota ?? "",
      // Se escribe como un comprobante, no como tres columnas sueltas: quien
      // lee la hoja busca «E001-500», no un tipo y una serie por separado.
      c.modificaNumero
        ? `${nombreDeTipo(c.modificaTipo)} ${[c.modificaSerie, c.modificaNumero].filter(Boolean).join("-")}`.trim()
        : "",
      c.rendidoPor ?? "",
      c.cambios === 0 ? "" : String(c.cambios),
      fechaCorta(c.primeraVez),
      fechaCorta(c.ultimaVez),
      c.carSunat ?? "",
      padron?.condicion ?? "",
      padron ? siNo(padron.buenContribuyente) : "",
      padron ? siNo(padron.agenteRetencion) : "",
      padron ? siNo(padron.agentePercepcion) : "",
      ];
    }),
  ];
}

/** Un nombre que ordena bien cuando hay varios en una carpeta. */
export function nombreArchivoSunat(periodo: string | null): string {
  return periodo
    ? `COMPROBANTES SUNAT ${periodo}.csv`
    : "COMPROBANTES SUNAT historico.csv";
}
