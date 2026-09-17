// El detalle de comprobantes, como hoja
//
// Una fila por ítem. Es la salida que responde «¿en qué se gastó?», que la
// hoja de cabeceras (`comprobantes-sunat.ts`) no puede: allá una factura es
// una línea; acá es tantas líneas como productos tenga.
//
// Sale de la función `detalle_cpe`, que ya trae la cabecera del comprobante
// repetida en cada ítem. Como la otra hoja, cada columna se manda con su tipo
// para que Google no adivine —y ordene mal— fechas y series.

import { fechaCorta, nombreDeTipo, type TipoColumna } from "./comprobantes-sunat.ts";

/** Una línea de detalle, tal como la devuelve `detalle_cpe`. */
export interface FilaDetalleCpe {
  periodo: string | null;
  origen: string | null;
  proveedorRuc: string | null;
  proveedorNombre: string | null;
  tipoComprobante: string | null;
  serie: string | null;
  numero: string | null;
  fechaEmision: string | null;
  moneda: string | null;
  linea: number | null;
  descripcion: string | null;
  cantidad: number | null;
  unidad: string | null;
  precioUnitario: number | null;
  importe: number | null;
  totalComprobante: number | null;
}

// El orden importa: lo que se busca primero —de qué comprobante es, qué se
// compró— a la izquierda; lo numérico al final. Se decide una vez porque
// cambiarlo rompe lo que alguien arme encima.
export const CABECERAS_ITEMS = [
  "Período", "Origen", "RUC proveedor", "Proveedor",
  "Tipo", "Serie", "Número", "Fecha de emisión", "Moneda",
  "Línea", "Descripción", "Cantidad", "Unidad", "Precio unitario", "Importe",
  "Total del comprobante",
];

export const TIPOS_ITEMS: TipoColumna[] = [
  "texto",  // Período
  "texto",  // Origen
  "texto",  // RUC proveedor
  "texto",  // Proveedor
  "texto",  // Tipo
  "texto",  // Serie
  "texto",  // Número
  "fecha",  // Fecha de emisión
  "texto",  // Moneda
  "numero", // Línea
  "texto",  // Descripción
  "numero", // Cantidad
  "texto",  // Unidad
  "numero", // Precio unitario
  "numero", // Importe
  "numero", // Total del comprobante
];

// Vacío cuando no hay dato, no un cero: distinguir un importe ausente de uno
// que es cero de verdad.
const num = (v: number | null, dec = 2) => (v == null ? "" : Number(v).toFixed(dec));

const ORIGEN: Record<string, string> = {
  RECIBIDO: "Recibido", EMITIDO: "Emitido", OTRO: "Otro",
};

export function filasItemsSunat(filas: FilaDetalleCpe[]): string[][] {
  return [
    CABECERAS_ITEMS,
    ...filas.map(f => [
      f.periodo ?? "",
      ORIGEN[f.origen ?? ""] ?? (f.origen ?? ""),
      f.proveedorRuc ?? "",
      f.proveedorNombre ?? "",
      nombreDeTipo(f.tipoComprobante),
      f.serie ?? "",
      f.numero ?? "",
      fechaCorta(f.fechaEmision),
      f.moneda ?? "",
      f.linea == null ? "" : String(f.linea),
      f.descripcion ?? "",
      num(f.cantidad, 2),
      f.unidad ?? "",
      num(f.precioUnitario, 4),
      num(f.importe, 2),
      num(f.totalComprobante, 2),
    ]),
  ];
}

/** El nombre del archivo/hoja. Va aparte del de cabeceras para no pisarlo. */
export function nombreArchivoItems(periodo: string | null): string {
  return periodo
    ? `COMPROBANTES SUNAT - DETALLE ${periodo}.csv`
    : "COMPROBANTES SUNAT - DETALLE.csv";
}
