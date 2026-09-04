// Tipos del dominio — Rendición de Gastos Automotriz

export type TipoComprobante =
  | "FACTURA"
  | "BOLETA"
  | "RECIBO"
  | "TICKET"
  | "NOTA_CREDITO"
  | "OTRO";

export type EstadoPago = "PENDIENTE" | "PAGADO" | "ANULADO";

export interface GastoExtraido {
  proveedor: string;
  detalle: string;
  monto_total: number;
  tipo_comprobante: TipoComprobante;
  numero_comprobante: string;
  fecha_comprobante: string; // ISO YYYY-MM-DD
  forma_pago: string; // "EFECTIVO" | "TARJETA" | "TRANSFERENCIA" | etc.
  moneda: "PEN" | "USD"; // S/ o $
  subtotal?: number;
  igv?: number;
}

export interface GastoItem {
  id: string;
  // proyecto al que pertenece — fija la separación entre rendiciones
  proyecto_id: string;
  // archivo
  nombre: string;
  tamanoKB: number;
  /** Vacío tras recargar la página: la imagen no se guarda en el navegador. */
  base64: string;
  mimeType: string;
  // campos que llena el usuario
  numero_solicitud: string;
  fecha_solicitud: string;
  empresa: string;
  responsable: string;
  area_proyecto: string;
  solicitante: string;
  motivo: string;
  estado: EstadoPago;
  // campos extraídos por Gemini
  extraido?: GastoExtraido;
  drive_url?: string;
  // estado de procesamiento
  procesado: boolean;
  procesando: boolean;
  error?: string;
  // registro en la planilla (append-only)
  registrado?: RegistroInfo;
  registrando?: boolean;
  error_registro?: string;
}

/** Sello inmutable de quién registró el gasto en la planilla y cuándo. */
export interface RegistroInfo {
  usuario_id: string;
  usuario_nombre: string;
  fecha: string; // ISO
}

export interface Usuario {
  id: string;
  nombre: string;
  iniciales: string;
}

export interface Proyecto {
  id: string;
  nombre: string;
  centro_costos: string;
  caja: string;
  descripcion?: string;
  creado: string;
}

export interface ResumenProyecto {
  total_items: number;
  total_soles: number;
  pendientes: number;
  pagados: number;
}
