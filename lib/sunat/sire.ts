// Bajar la propuesta del RCE
//
// El registro de compras no se descarga de una: SUNAT encola el trabajo y
// devuelve un ticket. Son tres pasos y hay que esperar entre el segundo y
// el tercero.
//
//   1. exportacioncomprobantepropuesta  → devuelve numTicket
//   2. consultaestadotickets            → hasta que termine, devuelve el
//                                         nombre del archivo generado
//   3. archivoreporte                   → el archivo, comprimido
//
// Qué trae y qué no: son los comprobantes que los proveedores declararon
// CONTRA EL RUC de la empresa. Una boleta que el técnico pidió a su nombre
// en una bodega de provincia, o un Yape, no aparece acá —no porque falte,
// sino porque nunca se declaró contra la empresa—. Sirve para confirmar
// facturas, no para validar boletas de viático.

import { obtenerToken } from "./token.ts";
import { SIRE } from "./token.ts";
import type { CredencialesSunat } from "./credenciales.ts";

const BASE = `${SIRE}/v1/contribuyente/migeigv/libros`;
const MASIVO = `${BASE}/rvierce/gestionprocesosmasivos/web/masivo`;

export type TipoArchivo = "txt" | "csv";
const CODIGO_ARCHIVO: Record<TipoArchivo, string> = { txt: "0", csv: "1" };

/** Código del RCE en el catálogo de libros de SUNAT. */
const LIBRO_RCE = "080000";

/**
 * Origen del pedido. El manual lo llama «2 Servicio API» y lo marca
 * obligatorio en los tres servicios. Sin él, SUNAT responde 422 con el
 * código 1061 y no dice cuál es el valor que espera.
 */
const ORIGEN_API = "2";

/**
 * Lo que hace falta para bajar el archivo de un ticket.
 *
 * No basta el nombre: `archivoreporte` exige además el período, el proceso y
 * el ticket, y todos salen de la misma respuesta que dio el nombre. Van
 * juntos en un objeto para que no se pueda intentar la descarga con la mitad
 * de los datos.
 */
export interface ArchivoDelTicket {
  nombre: string;
  tipo: string;
  periodo: string;
  codProceso: string;
  numTicket: string;
}

export interface Ticket {
  numTicket: string;
  estado: string;
  descripcion: string;
  terminado: boolean;
  fallado: boolean;
  archivo: ArchivoDelTicket | null;
}

// ════════════════════════════════════════════════════════════════
// Las partes que se pueden razonar sin red

export function urlExportarPropuesta(periodo: string, tipo: TipoArchivo = "csv"): string {
  // El manual marca numSerieCDP y numCDP como obligatorios, pero los
  // describe como filtros para hallar UN comprobante. Mandarlos vacíos
  // arriesga que SUNAT filtre por nada y devuelva un archivo vacío, que es
  // peor que un error. No se mandan; si algún día hicieran falta, el 422
  // los nombrará.
  const q = new URLSearchParams({
    codTipoArchivo: CODIGO_ARCHIVO[tipo],
    codOrigenEnvio: ORIGEN_API,
  });
  return `${BASE}/rce/propuesta/web/propuesta/${periodo}/exportacioncomprobantepropuesta?${q}`;
}

export function urlEstadoTicket(periodo: string, numTicket: string): string {
  const q = new URLSearchParams({
    perIni: periodo, perFin: periodo, page: "1", perPage: "20", numTicket,
    codLibro: LIBRO_RCE, codOrigenEnvio: ORIGEN_API,
  });
  return `${MASIVO}/consultaestadotickets?${q}`;
}

export function urlArchivo(a: ArchivoDelTicket): string {
  const q = new URLSearchParams({
    nomArchivoReporte: a.nombre,
    codTipoArchivoReporte: a.tipo,
    codLibro: LIBRO_RCE,
    perTributario: a.periodo,
    codProceso: a.codProceso,
    numTicket: a.numTicket,
  });
  return `${MASIVO}/archivoreporte?${q}`;
}

/**
 * Traduce la respuesta del ticket a algo con lo que se pueda decidir.
 *
 * SUNAT devuelve el estado dentro de un arreglo `registros`, y el detalle
 * del archivo en otro anidado. Los códigos de estado no están todos
 * documentados, así que se decide por lo que SÍ es seguro: hay archivo
 * generado o no lo hay, y el texto del estado dice si terminó o falló.
 */
export function leerTicket(cuerpo: unknown): Ticket | null {
  const raiz = cuerpo as { registros?: unknown[] } | null;
  const r = (raiz?.registros?.[0] ?? null) as Record<string, unknown> | null;
  if (!r) return null;

  const detalle = (r.detalleTicket as Record<string, unknown>[] | undefined)?.[0] ?? {};
  // El nombre puede venir en el detalle o en un arreglo `archivoReporte`,
  // según el servicio que generó el ticket.
  const reporte = (r.archivoReporte as Record<string, unknown>[] | undefined)?.[0] ?? {};
  const nombre = (detalle.nomArchivoReporte ?? reporte.nomArchivoReporte ?? r.nomArchivoReporte) as string | undefined;
  // El manual avisa: si codTipoArchivoReporte viene nulo, hay que mandar el
  // mismo valor nulo. Se manda vacío, que es como se representa en una URL.
  // Es lo único de estas rutas que no está verificado contra el servicio.
  const tipo = (detalle.codTipoArchivoReporte ?? reporte.codTipoArchivoReporte
    ?? r.codTipoArchivoReporte ?? null) as string | null;

  const estado = String(r.codEstadoProceso ?? "");
  const desc = String(r.desEstadoProceso ?? "");
  const texto = desc.toLowerCase();
  const numTicket = String(r.numTicket ?? detalle.numTicket ?? "");
  const periodo = String(r.perTributario ?? "");
  const codProceso = String(r.codProceso ?? "");

  return {
    numTicket,
    estado,
    descripcion: desc,
    terminado: !!nombre,
    fallado: /error|rechaz|fall/.test(texto),
    archivo: nombre
      ? { nombre, tipo: tipo ?? "", periodo, codProceso, numTicket }
      : null,
  };
}

// ════════════════════════════════════════════════════════════════

async function pedir(url: string, token: string, traer: typeof globalThis.fetch) {
  const res = await traer(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const d = await res.text().catch(() => "");
    throw new Error(`SUNAT respondió HTTP ${res.status} en ${new URL(url).pathname}. ${d.slice(0, 400)}`);
  }
  return res;
}

export interface OpcionesDescarga {
  tipo?: TipoArchivo;
  /** Cada cuánto preguntar por el ticket y cuánto esperar en total. */
  cadaMs?: number;
  limiteMs?: number;
  fetch?: typeof globalThis.fetch;
  alAvanzar?: (paso: string) => void;
}

/**
 * Los tres pasos, de principio a fin. Devuelve el archivo tal como lo manda
 * SUNAT: comprimido.
 */
export async function descargarPropuestaRce(
  cred: CredencialesSunat, periodo: string, o: OpcionesDescarga = {}
): Promise<{ ticket: string; nombre: string; contenido: ArrayBuffer }> {
  const traer = o.fetch ?? globalThis.fetch;
  const avisar = o.alAvanzar ?? (() => {});
  const { valor: token } = await obtenerToken(cred, { fetch: traer });

  avisar(`pidiendo la exportación del período ${periodo}`);
  const res1 = await pedir(urlExportarPropuesta(periodo, o.tipo ?? "csv"), token, traer);
  const j1 = await res1.json() as { numTicket?: string };
  const numTicket = j1.numTicket;
  if (!numTicket) throw new Error(`SUNAT aceptó el pedido pero no devolvió ticket: ${JSON.stringify(j1).slice(0, 300)}`);
  avisar(`ticket ${numTicket}`);

  const cada = o.cadaMs ?? 5000;
  const limite = Date.now() + (o.limiteMs ?? 300000);
  let ticket: Ticket | null = null;

  while (Date.now() < limite) {
    await new Promise(r => setTimeout(r, cada));
    const res2 = await pedir(urlEstadoTicket(periodo, numTicket), token, traer);
    ticket = leerTicket(await res2.json());
    avisar(`estado: ${ticket?.descripcion || ticket?.estado || "sin respuesta"}`);
    if (ticket?.fallado) throw new Error(`SUNAT rechazó el proceso: ${ticket.descripcion}`);
    if (ticket?.terminado) break;
  }

  if (!ticket?.archivo) {
    throw new Error(`El ticket ${numTicket} no terminó dentro del tiempo de espera.`);
  }

  avisar(`bajando ${ticket.archivo.nombre}`);
  const res3 = await pedir(urlArchivo(ticket.archivo), token, traer);
  return { ticket: numTicket, nombre: ticket.archivo.nombre, contenido: await res3.arrayBuffer() };
}

// ════════════════════════════════════════════════════════════════
// Los tres pasos por separado
//
// `descargarPropuestaRce` espera hasta que el ticket termine, lo que sirve
// desde un script pero no desde la aplicación: cada petición al servidor
// tiene un minuto de vida y el ticket puede tardar más. Desde la pantalla se
// llama a un paso por vez y es el navegador el que vuelve a preguntar.

export interface OpcionesPaso {
  fetch?: typeof globalThis.fetch;
}

/** Paso 1: encola la exportación y devuelve el número de ticket. */
export async function pedirExportacion(
  cred: CredencialesSunat, periodo: string, tipo: TipoArchivo = "csv", o: OpcionesPaso = {}
): Promise<string> {
  const traer = o.fetch ?? globalThis.fetch;
  const { valor: token } = await obtenerToken(cred, { fetch: traer });
  const res = await pedir(urlExportarPropuesta(periodo, tipo), token, traer);
  const j = await res.json() as { numTicket?: string };
  if (!j.numTicket) {
    throw new Error(`SUNAT aceptó el pedido pero no devolvió ticket: ${JSON.stringify(j).slice(0, 300)}`);
  }
  return j.numTicket;
}

/** Paso 2: pregunta en qué va el ticket. Una sola vez, sin esperar. */
export async function consultarTicket(
  cred: CredencialesSunat, periodo: string, numTicket: string, o: OpcionesPaso = {}
): Promise<Ticket | null> {
  const traer = o.fetch ?? globalThis.fetch;
  const { valor: token } = await obtenerToken(cred, { fetch: traer });
  const res = await pedir(urlEstadoTicket(periodo, numTicket), token, traer);
  return leerTicket(await res.json());
}

/** Paso 3: baja el archivo que dejó listo el ticket. */
export async function bajarArchivo(
  cred: CredencialesSunat, archivo: ArchivoDelTicket, o: OpcionesPaso = {}
): Promise<ArrayBuffer> {
  const traer = o.fetch ?? globalThis.fetch;
  const { valor: token } = await obtenerToken(cred, { fetch: traer });
  const res = await pedir(urlArchivo(archivo), token, traer);
  return res.arrayBuffer();
}
