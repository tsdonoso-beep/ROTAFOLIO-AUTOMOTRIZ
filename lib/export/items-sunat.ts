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
  /** "Contado" o "Credito", tal como lo declara el emisor. */
  formaPago: string | null;
  guiaRemision: string | null;
  ordenCompra: string | null;
  /** El comprobante que este referencia, típico en anticipos y valorizaciones. */
  documentoRelacionado: string | null;
  tipoDocumentoRelacionado: string | null;
  anticipoAplicado: number | null;
  /** null si el comprobante no está sujeto a detracción. */
  detraccionPorcentaje: number | null;
  detraccionMonto: number | null;
  /** La cuenta del Banco de la Nación. */
  detraccionCuentaBanco: string | null;
  /** El código del bien/servicio detraído, catálogo 54 de SUNAT. */
  detraccionCodigoBienServicio: string | null;
}

// El orden importa: lo que se busca primero —de qué comprobante es, qué se
// compró— a la izquierda; lo numérico al final. Se decide una vez porque
// cambiarlo rompe lo que alguien arme encima.
export const CABECERAS_ITEMS = [
  "Período", "Origen", "RUC proveedor", "Proveedor",
  "Tipo", "Serie", "Número", "Fecha de emisión", "Moneda",
  "Forma de pago", "Guía de remisión", "Orden de compra",
  "Documento relacionado", "Tipo doc. relacionado", "Anticipo aplicado",
  "% Detracción", "Detracción", "Cuenta detracción", "Código bien/servicio detracción",
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
  "texto",  // Forma de pago
  "texto",  // Guía de remisión
  "texto",  // Orden de compra
  "texto",  // Documento relacionado
  "texto",  // Tipo doc. relacionado
  "numero", // Anticipo aplicado
  "numero", // % Detracción
  "numero", // Detracción
  "texto",  // Cuenta detracción
  "texto",  // Código bien/servicio detracción
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

/** Lo mínimo de un `SupabaseClient` que hace falta para paginar un RPC. */
interface ClienteConRpc {
  rpc(fn: string, args: Record<string, unknown>): {
    range(desde: number, hasta: number): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  };
}

const TAMANO_PAGINA_DETALLE = 1000;

/**
 * Trae TODO el detalle de `detalle_cpe`, paginando.
 *
 * Supabase corta cada respuesta de su API en 1000 filas por omisión si no se
 * pide un rango explícito — un solo `.rpc(...)` sin `.range()` se queda
 * callado con lo que entra en esa página, no avisa que recortó nada. Como
 * `detalle_cpe` ordena por fecha de emisión ascendente, lo que se pierde en
 * cuanto el detalle pasa de 1000 ítems es siempre lo MÁS RECIENTE: se notó
 * porque julio y agosto —ya guardados en la base— no aparecían en la hoja
 * aunque marzo a junio sí.
 */
export async function detalleCpeCompleto(
  sb: ClienteConRpc, periodo: string | null
): Promise<Record<string, unknown>[]> {
  const filas: Record<string, unknown>[] = [];
  for (let desde = 0; ; desde += TAMANO_PAGINA_DETALLE) {
    const { data, error } = await sb.rpc("detalle_cpe", { p_periodo: periodo })
      .range(desde, desde + TAMANO_PAGINA_DETALLE - 1);
    if (error) throw new Error(error.message);
    const pagina = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    filas.push(...pagina);
    if (pagina.length < TAMANO_PAGINA_DETALLE) break;
  }
  return filas;
}

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
    formaPago: (d.forma_pago as string) ?? null,
    guiaRemision: (d.guia_remision as string) ?? null,
    ordenCompra: (d.orden_compra as string) ?? null,
    documentoRelacionado: (d.documento_relacionado as string) ?? null,
    tipoDocumentoRelacionado: (d.tipo_documento_relacionado as string) ?? null,
    anticipoAplicado: aNum(d.anticipo_aplicado),
    detraccionPorcentaje: aNum(d.detraccion_porcentaje),
    detraccionMonto: aNum(d.detraccion_monto),
    detraccionCuentaBanco: (d.detraccion_cuenta_banco as string) ?? null,
    detraccionCodigoBienServicio: (d.detraccion_codigo_bien_servicio as string) ?? null,
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
      f.formaPago ?? "",
      f.guiaRemision ?? "",
      f.ordenCompra ?? "",
      f.documentoRelacionado ?? "",
      f.tipoDocumentoRelacionado ?? "",
      num(f.anticipoAplicado, 2),
      num(f.detraccionPorcentaje, 2),
      num(f.detraccionMonto, 2),
      f.detraccionCuentaBanco ?? "",
      f.detraccionCodigoBienServicio ?? "",
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
