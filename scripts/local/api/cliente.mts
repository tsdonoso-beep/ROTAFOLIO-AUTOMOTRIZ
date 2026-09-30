// Cliente de api-cpe.sunat.gob.pe: la API que usa por debajo «Nueva Consulta de comprobantes de pago».
//
// Rutas sacadas del código público de esa app (main.*.js, 30/09/2026):
//   GET  /v1/contribuyente/consultacpe/comprobantes/{rucEmisor}-{tipo}-{serie}-{numero}-{filtro}        un comprobante
//   GET  …/comprobantes/{rucEmisor}-{tipo}-{serie}-{numero}-{filtro}/{01|02|03}                         PDF | XML | CDR → { nomArchivo, valArchivo (base64) }
//   GET  …/comprobantes/{ruc}-{tipo}-{filtro}?codEstado&codDocIde&numDocIde&fecEmisionIni&fecEmisionFin lista (la app avisa: «solo los primeros 300»)
//   POST …/comprobantes/{ruc}/pedidos                                                                    pedido de descarga masiva (asíncrono)
// filtro: 1 = emitido, 2 = recibido. La autorización es el Bearer que la app obtiene al abrirse (ver sol/sesion.mts → Token).

import type { APIRequestContext } from "playwright";
import { idApi, clasificarHttp, type Clase, type Pendiente } from "../comun/tipos.mts";
import type { Bitacora } from "../comun/bitacora.mts";
import { tipoPorNombre, type Archivo } from "../comun/drive.mts";
import { leerZip } from "../../../lib/sunat/zip.ts";

export const API = "https://api-cpe.sunat.gob.pe/v1/contribuyente/consultacpe";
const ORIGEN = "https://e-factura.sunat.gob.pe";
export const TIPO_ARCHIVO = { PDF: "01", XML: "02", CDR: "03" } as const;

export interface Respuesta<T = unknown> { status: number; clase: Clase; ms: number; json: T | null; texto: string }

/**
 * Se pide con el cliente HTTP de Playwright (`contexto.request`), NO con el
 * `fetch` de Node: el sondeo del 30/09/2026 mostró que SUNAT le corta la
 * conexión a `fetch` (UND_ERR_SOCKET «other side closed», incluso sin token),
 * mientras que `contexto.request` —que además comparte las cookies de SOL—
 * bajó 4/4 XML en ~250 ms.
 */
export class ClienteApi {
  token: () => string | null;
  b: Bitacora;
  quien: string;
  timeoutMs: number;
  http: APIRequestContext;
  constructor(b: Bitacora, http: APIRequestContext, token: () => string | null, quien = "api", timeoutMs = 30000) {
    this.b = b; this.http = http; this.token = token; this.quien = quien; this.timeoutMs = timeoutMs;
  }

  async pedir<T>(metodo: "GET" | "POST", url: string, cuerpo?: unknown): Promise<Respuesta<T>> {
    const t0 = Date.now();
    const auth = this.token();
    if (!auth) return { status: 0, clase: "SESION", ms: 0, json: null, texto: "sin token" };
    let status = 0, texto = "";
    try {
      const r = await this.http.fetch(url, {
        method: metodo,
        headers: {
          authorization: auth, accept: "application/json, text/plain, */*", origin: ORIGEN, referer: `${ORIGEN}/`,
          ...(cuerpo ? { "content-type": "application/json" } : {}),
        },
        data: cuerpo ? JSON.stringify(cuerpo) : undefined,
        timeout: this.timeoutMs,
      });
      status = r.status();
      texto = await r.text();
    } catch (e) {
      const ms = Date.now() - t0;
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      this.b.http({ metodo, url, status: 0, cuerpo: msg, quien: this.quien, ms });
      return { status: 0, clase: /timeout|abort/i.test(msg) ? "TIMEOUT" : "EXCEPCION", ms, json: null, texto: msg };
    }
    const ms = Date.now() - t0;
    this.b.http({ metodo, url, status, cuerpo: texto, quien: this.quien, ms });
    let json: T | null = null;
    try { json = texto ? JSON.parse(texto) as T : null; } catch { /* no era JSON: queda en texto */ }
    return { status, clase: clasificarHttp(status, texto), ms, json, texto };
  }

  /** Los datos de un comprobante (cabecera), como los muestra el modal «Resultado». */
  consultar(p: Pendiente) {
    return this.pedir<Record<string, unknown>>("GET", `${API}/comprobantes/${idApi(p)}`);
  }

  /** Un archivo del comprobante. Devuelve el Archivo ya decodificado, o la respuesta cruda si falló. */
  async archivo(p: Pendiente, tipo: "PDF" | "XML" | "CDR"): Promise<{ r: Respuesta; archivo: Archivo | null }> {
    const r = await this.pedir<{ nomArchivo?: string; valArchivo?: string }>("GET", `${API}/comprobantes/${idApi(p)}/${TIPO_ARCHIVO[tipo]}`);
    return { r, archivo: r.clase === "OK" ? decodificarArchivo(r.json, tipo, p) : null };
  }

  /**
   * Lista de comprobantes recibidos en un rango de fechas (dd/mm/aaaa).
   * `ruc` es el primer tramo de la ruta: la app pone ahí «RUC emisor» del
   * formulario masivo; qué acepta exactamente como receptor es lo que prueba
   * sondear-api.mts.
   */
  lista(ruc: string, tipo: string, desde: string, hasta: string, extra: Record<string, string> = {}) {
    const q = new URLSearchParams({ ...extra, fecEmisionIni: desde, fecEmisionFin: hasta });
    return this.pedir<{ comprobantes?: unknown[] }>("GET", `${API}/comprobantes/${ruc}-${tipo}-2?${q}`);
  }
}

/**
 * { nomArchivo, valArchivo } → Archivo. La app decodifica valArchivo como
 * base64 «url-safe» y guarda XML/CDR como .zip; se hace igual.
 */
export function decodificarArchivo(json: { nomArchivo?: string; valArchivo?: string } | null, tipo: "PDF" | "XML" | "CDR", p: Pick<Pendiente, "proveedorRuc" | "tipoComprobante" | "serie" | "numero">): Archivo | null {
  if (!json?.valArchivo) return null;
  const b64 = json.valArchivo.replace(/^data:.*;base64,/, "").replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");
  let datos = Buffer.from(b64, "base64");
  if (!datos.length) return null;
  let base = (json.nomArchivo || `${p.proveedorRuc}-${p.tipoComprobante}-${p.serie}-${p.numero}`).replace(/[\\/:*?"<>|]/g, "_");
  let esZip = datos.subarray(0, 2).toString("latin1") === "PK";
  // El PDF llega DENTRO de un zip («…-PDF.zip» con el .pdf adentro): se sube el PDF, como hasta ahora.
  if (tipo === "PDF" && esZip) {
    const pdf = leerZip(datos).find(a => /\.pdf$/i.test(a.nombre));
    if (pdf) { datos = Buffer.from(pdf.contenido); base = pdf.nombre; esZip = false; }
  }
  const ext = tipo === "PDF" ? ".pdf" : esZip ? ".zip" : ".xml";
  const nombre = /\.(pdf|zip|xml)$/i.test(base) ? base : base + ext;
  return { nombre, datos, tipo: tipoPorNombre(nombre) };
}
