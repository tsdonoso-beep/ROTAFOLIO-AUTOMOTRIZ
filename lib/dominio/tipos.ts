// Modelo de dominio — INRO VIATICOS v2
// Referencia: SPEC §5. Reemplaza el modelo proyecto/gasto del MVP por memo/gasto.

export type Rol =
  | "RENDIDOR"
  | "ADMIN_MEMOS"
  | "REVISOR_COSTOS"
  | "CONTABILIDAD"
  | "JEFATURA"
  | "ADMIN_SISTEMA";

export type EstadoMemo =
  | "BORRADOR"
  | "ABIERTO"
  | "EN_RENDICION"
  | "PRESENTADA"
  | "OBSERVADA"
  | "APROBADA"
  | "CONTABILIZADA"
  | "CERRADO"
  | "ANULADO";

export type EstadoGasto =
  | "CAPTURADO"
  | "EXTRAIDO"
  | "ERROR_EXTRACCION"
  | "CON_ALERTA"
  | "VALIDADO"
  | "PRESENTADO"
  | "OBSERVADO"
  | "APROBADO"
  | "CONTABILIZADO";

export type TipoMemo = "VIATICOS" | "PASAJES" | "CAJA_CHICA" | "OTRO";
export type ClaseGasto = "COMPROBANTE" | "DECLARACION_JURADA" | "MOVILIDAD";
export type CategoriaGasto = "ALIMENTACION" | "MOVILIDAD" | "HOSPEDAJE" | "OTRO";

/**
 * Códigos SUNAT de tipo de comprobante (catálogo 01).
 *
 * El "00 - OTROS" es el que recibe lo que no es un comprobante de pago:
 * la constancia de un Yape, un Plin o una transferencia. SUNAT no los
 * reconoce como sustento y no dan crédito fiscal, pero son pagos reales
 * que la caja hizo y tienen que poder rendirse.
 */
export const TIPO_COMPROBANTE_SUNAT = {
  "00": "OTROS",
  "01": "FACTURA",
  "03": "BOLETA",
  "07": "NOTA_CREDITO",
  "08": "NOTA_DEBITO",
  "12": "TICKET",
} as const;

/** Tipos que no otorgan crédito fiscal: el IGV no se discrimina. */
export const SIN_CREDITO_FISCAL: string[] = ["00", "03", "12"];

export type CodigoComprobante = keyof typeof TIPO_COMPROBANTE_SUNAT;

// ════════════════════════════════════════════════════════════════
// Entidades
// ════════════════════════════════════════════════════════════════

export interface Usuario {
  id: string;
  auth_id: string | null;
  /** Documento de identidad: el identificador con el que la persona entra. */
  dni: string;
  /** true mientras sea un documento de relleno, sin el dato real de RRHH. */
  dni_provisional: boolean;
  /** Nulo para quien no tiene cuenta de correo, que es buena parte del campo. */
  email: string | null;
  nombre: string;
  activo: boolean;
  area_id: string | null;
  jefatura_id: string | null;
  roles: Rol[];
}

export interface Empresa {
  id: string;
  ruc: string;
  razon_social: string;
  activo: boolean;
}

export interface CentroCosto {
  id: string;
  codigo: string;
  nombre: string;
  empresa_id: string | null;
  activo: boolean;
  /** Nombre exacto de la carpeta en Drive. Si no coincide, se crea otra. */
  drive_folder: string | null;
}

export interface Proyecto {
  id: string;
  codigo: string;
  nombre: string;
  centro_costo_id: string;
  estado: "ACTIVO" | "MANTENIMIENTO" | "CERRADO";
  fecha_inicio: string | null;
  fecha_fin_estimada: string | null;
}

export interface Memo {
  id: string;
  correlativo: string;
  tipo: TipoMemo;
  empresa_id: string;
  centro_costo_id: string;
  proyecto_id: string | null;
  destino: string | null;
  fecha_salida: string | null;
  fecha_retorno_prev: string | null;
  fecha_retorno_real: string | null;
  monto_autorizado: number;
  moneda: string;
  estado: EstadoMemo;
  observacion_actual: string | null;
  drive_folder_id: string | null;
  creado_por: string;
  creado_en: string;
  presentado_en: string | null;
  aprobado_por: string | null;
  aprobado_en: string | null;
  contabilizado_en: string | null;
  /** Cargados aparte; no viven en la tabla memos. */
  asignados?: string[];
  distribucion?: DistribucionProyecto[];
}

export interface DistribucionProyecto {
  proyecto_id: string;
  porcentaje: number;
}

export interface Gasto {
  id: string;
  /** Generado en el dispositivo: hace idempotente la sincronización (§9.2). */
  client_id: string;
  memo_id: string | null;
  proyecto_id: string | null;
  usuario_id: string;
  estado: EstadoGasto;
  clase: ClaseGasto;
  categoria: CategoriaGasto | null;

  proveedor_ruc: string | null;
  proveedor_nombre: string | null;
  /** A nombre de quién se emitió. Debe ser el RUC de la empresa. */
  adquiriente_ruc: string | null;
  tipo_comprobante: string | null;
  serie: string | null;
  numero: string | null;
  fecha_emision: string | null;
  moneda: string;
  tipo_cambio: number | null;
  subtotal: number | null;
  igv: number | null;
  total: number | null;
  forma_pago: string | null;
  detalle: string | null;

  dj_motivo: string | null;
  dj_lugar: string | null;
  mov_origen: string | null;
  mov_destino: string | null;

  confianza_extraccion: Record<string, number> | null;
  alertas: Alerta[];
  alertas_confirmadas: boolean;
  validacion_sunat: ValidacionSunat | null;
  hash_imagen: string | null;
  observacion: string | null;

  storage_key: string | null;
  drive_url: string | null;
  drive_error: string | null;

  capturado_en: string | null;
  sincronizado_en: string | null;
  registrado_en: string | null;
}

// ════════════════════════════════════════════════════════════════
// Alertas y validación
// ════════════════════════════════════════════════════════════════

export type CodigoAlerta =
  | "RUC_FORMATO"
  | "ARITMETICA"
  | "IGV_PORCENTAJE"
  | "FECHA_FUERA_RANGO"
  | "DUPLICADO_COMPROBANTE"
  | "DUPLICADO_IMAGEN"
  | "EXCEDE_AUTORIZADO"
  | "TOPE_DJ_EXCEDIDO"
  | "TOPE_MOVILIDAD"
  | "BOLETA_SIN_RUS"
  | "SIN_PLACA"
  | "SIN_SUSTENTO_FORMAL"
  | "COMPROBANTE_AJENO"
  | "TICKET_SIN_RUC"
  | "CONFIANZA_BAJA"
  | "SUNAT_NO_VALIDO";

/**
 * `bloqueante` impide presentar la rendición. Los demás niveles se muestran
 * y exigen confirmación explícita del rendidor (§7.4).
 */
export type Severidad = "bloqueante" | "alta" | "media" | "baja";

export interface Alerta {
  codigo: CodigoAlerta;
  mensaje: string;
  severidad: Severidad;
  campo?: string;
}

export interface ValidacionSunat {
  existe: boolean;
  estadoCp: string;
  estadoRuc: string;
  condicionDomicilio: string;
  consultadoEn: string;
  /** El servicio no cubre percepción, retención ni guías de remisión (§8.1). */
  aplicable: boolean;
}

// ════════════════════════════════════════════════════════════════
// Extracción
// ════════════════════════════════════════════════════════════════

/** Lo que devuelve el extractor, con confianza por campo (§7.5). */
export interface ResultadoExtraccion {
  proveedor_ruc: string;
  proveedor_nombre: string;
  /**
   * RUC a nombre de quien se emitió el comprobante.
   *
   * Administración lo revisa a mano en cada factura: "algunos dicen que
   * pidieron factura, pero cuando reviso el físico está a nombre del
   * trabajador". Una factura que no está a nombre de la empresa no sirve
   * como sustento ni da crédito fiscal.
   */
  adquiriente_ruc: string;
  tipo_comprobante: string;
  serie: string;
  numero: string;
  fecha_emision: string;
  moneda: "PEN" | "USD";
  subtotal: number;
  igv: number;
  total: number;
  forma_pago: string;
  detalle: string;
  _confianza: Record<string, number>;
  _no_legibles: string[];
}

/**
 * Abstracción del proveedor de visión. Permite cambiar de modelo sin tocar
 * el resto de la aplicación — decisión pendiente en §15 pregunta 7.
 */
export interface ExtractorComprobantes {
  nombre: string;
  extraer(params: {
    base64: string;
    mimeType: string;
    signal?: AbortSignal;
  }): Promise<{ resultado: ResultadoExtraccion; modelo: string; crudo: string }>;
}

// ════════════════════════════════════════════════════════════════
// Auditoría
// ════════════════════════════════════════════════════════════════

export type AccionEvento =
  | "CREAR" | "EDITAR" | "ABRIR" | "CAPTURAR" | "EXTRAER"
  | "PRESENTAR" | "OBSERVAR" | "APROBAR" | "CONTABILIZAR"
  | "CERRAR" | "ANULAR" | "AUTORIZAR_EXCEPCION" | "NOTIFICAR";

export interface Evento {
  id: number;
  entidad: "MEMO" | "GASTO" | "USUARIO" | "PARAMETRO";
  entidad_id: string | null;
  accion: AccionEvento;
  usuario_id: string | null;
  datos_antes: unknown;
  datos_despues: unknown;
  ocurrido_en: string;
}

// ════════════════════════════════════════════════════════════════
// Parámetros configurables (§5)
// ════════════════════════════════════════════════════════════════

export interface Parametros {
  /** null = pendiente de definir (§15). Tratar como "sin tope" y avisarlo. */
  tope_declaracion_jurada_dia: number | null;
  tope_movilidad_dia: number | null;
  plazo_rendicion_dias: number | null;
  bloquear_memo_con_pendientes: boolean;
  dias_gracia_bloqueo: number;
  igv_porcentaje: number;
  umbral_confianza_alerta: number;
}

export const PARAMETROS_POR_DEFECTO: Parametros = {
  tope_declaracion_jurada_dia: null,
  tope_movilidad_dia: null,
  plazo_rendicion_dias: null,
  bloquear_memo_con_pendientes: false,
  dias_gracia_bloqueo: 15,
  igv_porcentaje: 18,
  umbral_confianza_alerta: 0.75,
};

// ════════════════════════════════════════════════════════════════
// Consolidado del memo (§14)
// ════════════════════════════════════════════════════════════════

export interface ConsolidadoMemo {
  autorizado: number;
  rendido: number;
  saldo: number;
  /** Positivo: el rendidor devuelve. Negativo: la empresa reembolsa. */
  devolucion: number;
  reembolso: number;
  por_clase: Record<ClaseGasto, number>;
  cantidad_gastos: number;
  con_alertas: number;
  bloqueantes: number;
}
