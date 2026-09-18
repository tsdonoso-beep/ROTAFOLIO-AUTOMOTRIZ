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
  /** El PDF archivado en Drive, si el scraper lo subió: el que de verdad se abre. */
  enlacePdf: string | null;
  /** El XML, de donde sale el detalle de ítems. */
  enlaceXml: string | null;
}

// El orden importa: lo que se busca primero —de qué comprobante es, qué se
// compró— a la izquierda; lo numérico al final. Se decide una vez porque
// cambiarlo rompe lo que alguien arme encima.
export const CABECERAS_ITEMS = [
  "Período", "Origen", "RUC proveedor", "Proveedor",
  "Tipo", "Serie", "Número", "Fecha de emisión", "Moneda",
  "Línea", "Descripción", "Cantidad", "Unidad", "Precio unitario", "Importe",
  "Total del comprobante", "PDF", "XML",
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
  "texto",  // PDF
  "texto",  // XML
];

/**
 * Convierte una fila cruda de `detalle_cpe` —tal como la manda PostgREST, en
 * snake_case y con los números como texto— a `FilaDetalleCpe`.
 *
 * Aparte para que la use tanto la acción de servidor (cuando alguien pide la
 * hoja desde la app) como el scraper (que la deja publicada solo, sin que
 * nadie tenga que entrar a pedirla): la misma conversión, escrita una vez.
 */
export function filaDetalleDesdeRpc(d: Record<string, unknown>): FilaDetalleCpe {
  const aNum = (v: unknown) => (v == null || v === "" ? null : Number(v));
  return {
    periodo: (d.periodo as string) ?? null,
    origen: (d.origen as string) ?? null,
    proveedorRuc: (d.proveedor_ruc as string) ?? null,
    proveedorNombre: (d.proveedor_nombre as string) ?? null,
    tipoComprobante: (d.tipo_comprobante as string) ?? null,
    serie: (d.serie as string) ?? null,
    numero: (d.numero as string) ?? null,
    fechaEmision: (d.fecha_emision as string) ?? null,
    moneda: (d.moneda as string) ?? null,
    linea: aNum(d.linea),
    descripcion: (d.descripcion as string) ?? null,
    cantidad: aNum(d.cantidad),
    unidad: (d.unidad as string) ?? null,
    precioUnitario: aNum(d.precio_unitario),
    importe: aNum(d.importe),
    totalComprobante: aNum(d.total_comprobante),
    enlacePdf: (d.enlace_pdf as string) ?? null,
    enlaceXml: (d.enlace_xml as string) ?? null,
  };
}

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
      f.enlacePdf ?? "",
      f.enlaceXml ?? "",
    ]),
  ];
}

/** El nombre del archivo/hoja. Va aparte del de cabeceras para no pisarlo. */
export function nombreArchivoItems(periodo: string | null): string {
  return periodo
    ? `COMPROBANTES SUNAT - DETALLE ${periodo}.csv`
    : "COMPROBANTES SUNAT - DETALLE.csv";
}
