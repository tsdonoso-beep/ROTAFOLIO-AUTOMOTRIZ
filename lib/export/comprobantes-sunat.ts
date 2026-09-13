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

export const CABECERAS_SUNAT = [
  "Período", "RUC proveedor", "Proveedor", "Tipo", "Serie", "Número",
  "Fecha de emisión", "Moneda", "Total", "Estado",
  "Es nota de", "Corrige a", "Lo rindió", "Cambios detectados",
  "Visto por primera vez", "Visto por última vez", "CAR SUNAT",
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

const num = (v: number | null) => (v == null ? "" : Number(v).toFixed(2));

/** La fecha como la espera Excel en español. */
export function fechaCorta(iso: string | null): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

export function filasComprobantesSunat(cs: ComprobanteHistorico[]): string[][] {
  return [
    CABECERAS_SUNAT,
    ...cs.map(c => [
      c.periodo,
      c.proveedorRuc ?? "",
      c.proveedorNombre ?? "",
      nombreDeTipo(c.tipoComprobante),
      c.serie ?? "",
      c.numero ?? "",
      fechaCorta(c.fechaEmision),
      c.moneda ?? "",
      num(c.total),
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
    ]),
  ];
}

/** Un nombre que ordena bien cuando hay varios en una carpeta. */
export function nombreArchivoSunat(periodo: string | null): string {
  return periodo
    ? `COMPROBANTES SUNAT ${periodo}.csv`
    : "COMPROBANTES SUNAT historico.csv";
}
