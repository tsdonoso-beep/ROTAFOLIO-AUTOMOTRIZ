// Tipos y funciones puras compartidas (sin red, sin disco): lo que prueban los tests.

export interface Pendiente {
  proveedorRuc: string;
  proveedorNombre: string | null;
  tipoComprobante: string;
  serie: string;
  numero: string;
  fechaEmision: string | null;
  periodo: string | null;
}

/** Identidad de un comprobante para comparar SIRE vs cpe_comprobante: serie en mayúsculas, número sin ceros a la izquierda. */
export function clave(x: { proveedorRuc: string; tipoComprobante: string; serie: string; numero: string }): string {
  return `${x.proveedorRuc}|${x.tipoComprobante}|${x.serie.toUpperCase()}|${x.numero.replace(/^0+/, "") || "0"}`;
}

/**
 * Cómo terminó un intento.
 *   OK           se bajó el XML
 *   SUNAT_CAIDO  SUNAT respondió error de servidor (HTTP 5xx, «reintentar en 5 minutos»)
 *   NO_EXISTE    SUNAT dice que ese comprobante no está
 *   SESION       la sesión o el token ya no sirven (HTTP 401/403, pantalla de ingreso)
 *   LIMITE       SUNAT pide bajar el ritmo (HTTP 429)
 *   VALIDACION   el pedido estaba mal armado (HTTP 400/422 con mensaje de validación)
 *   TIMEOUT      no llegó respuesta a tiempo
 *   DESCONOCIDO  llegó algo que no se sabe leer (queda crudo en la bitácora)
 *   EXCEPCION    falló nuestro código o el navegador
 */
export type Clase = "OK" | "SUNAT_CAIDO" | "NO_EXISTE" | "SESION" | "LIMITE" | "VALIDACION" | "TIMEOUT" | "DESCONOCIDO" | "EXCEPCION";

/** Clasifica por el texto que mostró SUNAT (modal, alerta, cuerpo de respuesta). `null` si no se reconoce. */
export function clasificarTexto(textos: string[]): Clase | null {
  const t = textos.join(" | ");
  if (!t) return null;
  if (/error del servidor|reintentar|intente(lo)? (nuevamente|m[aá]s tarde)|no disponible|temporalmente|error processing your request/i.test(t)) return "SUNAT_CAIDO";
  if (/no existe|no se encontr|no se ha encontrado|no (est[aá] )?registrad|no hay (resultados|informaci)|sin resultados|no fue (emitid|informad)/i.test(t)) return "NO_EXISTE";
  if (/sesi[oó]n.*(expir|termin|finaliz)|vuelva a (ingresar|iniciar)|saliendo del men[uú] sol/i.test(t)) return "SESION";
  if (/obligatori|inv[aá]lid|incorrect|debe (ingresar|seleccionar)|formato/i.test(t)) return "VALIDACION";
  return null;
}

/** Clasifica una respuesta de api-cpe por estado HTTP y cuerpo. */
export function clasificarHttp(status: number, cuerpo: string): Clase {
  if (status >= 200 && status < 300) return "OK";
  if (status === 401 || status === 403) return "SESION";
  if (status === 404) return "NO_EXISTE";
  if (status === 429) return "LIMITE";
  if (status >= 500) return "SUNAT_CAIDO";
  if (status === 400 || status === 422) return clasificarTexto([cuerpo]) === "NO_EXISTE" ? "NO_EXISTE" : "VALIDACION";
  return "DESCONOCIDO";
}

export interface Politica { maxIntentos: number; esperaCaidoMs: number; esperaReintentoMs: number; esperaLimiteMs: number }

/**
 * Qué hacer después de un intento: `fin` (OK / no existe / se rinde) o
 * `reintentar` con cuánta espera. SESION no gasta intento: no es culpa del comprobante.
 */
export function decidir(clase: Clase, intentosHechos: number, pol: Politica):
  { accion: "fin"; motivo: "ok" | "no_existe" | "agotado" } | { accion: "reintentar"; esperaMs: number; cuentaIntento: boolean } {
  if (clase === "OK") return { accion: "fin", motivo: "ok" };
  if (clase === "NO_EXISTE") return { accion: "fin", motivo: "no_existe" };
  if (clase === "SESION") return { accion: "reintentar", esperaMs: 0, cuentaIntento: false };
  if (intentosHechos >= pol.maxIntentos) return { accion: "fin", motivo: "agotado" };
  if (clase === "SUNAT_CAIDO") return { accion: "reintentar", esperaMs: pol.esperaCaidoMs, cuentaIntento: true };
  if (clase === "LIMITE") return { accion: "reintentar", esperaMs: pol.esperaLimiteMs * intentosHechos, cuentaIntento: true };
  return { accion: "reintentar", esperaMs: pol.esperaReintentoMs * intentosHechos, cuentaIntento: true };
}

/** El «id» con que api-cpe nombra un comprobante recibido: RUC emisor-tipo-serie-número-2 (2 = recibido). */
export function idApi(p: Pick<Pendiente, "proveedorRuc" | "tipoComprobante" | "serie" | "numero">, filtro = "2"): string {
  return `${p.proveedorRuc}-${p.tipoComprobante}-${p.serie.toUpperCase()}-${Number(p.numero)}-${filtro}`;
}

/** Lee el `exp` de un JWT (segundos) sin validarlo. `null` si no se puede. */
export function expiracionJwt(bearer: string): number | null {
  const partes = bearer.replace(/^Bearer\s+/i, "").split(".");
  if (partes.length < 2) return null;
  try {
    const payload = JSON.parse(Buffer.from(partes[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch { return null; }
}
