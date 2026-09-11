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

export interface Ticket {
  numTicket: string;
  estado: string;
  descripcion: string;
  terminado: boolean;
  fallado: boolean;
  archivo: { nombre: string; tipo: string } | null;
}

// ════════════════════════════════════════════════════════════════
// Las partes que se pueden razonar sin red

export function urlExportarPropuesta(periodo: string, tipo: TipoArchivo = "csv"): string {
  return `${BASE}/rce/propuesta/web/propuesta/${periodo}/exportacioncomprobantepropuesta`
    + `?codTipoArchivo=${CODIGO_ARCHIVO[tipo]}`;
}

export function urlEstadoTicket(periodo: string, numTicket: string): string {
  const q = new URLSearchParams({
    perIni: periodo, perFin: periodo, page: "1", perPage: "20", numTicket,
  });
  return `${MASIVO}/consultaestadotickets?${q}`;
}

export function urlArchivo(nombre: string, tipo: string): string {
  const q = new URLSearchParams({
    nomArchivoReporte: nombre, codTipoArchivoReporte: tipo,
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
  const nombre = (detalle.nomArchivoReporte ?? r.nomArchivoReporte) as string | undefined;
  // El manual avisa: si codTipoArchivoReporte viene nulo, se repite el
  // mismo valor que se pidió al exportar.
  const tipo = (detalle.codTipoArchivoReporte ?? r.codTipoArchivoReporte ?? null) as string | null;

  const estado = String(r.codEstadoProceso ?? "");
  const desc = String(r.desEstadoProceso ?? "");
  const texto = desc.toLowerCase();

  return {
    numTicket: String(r.numTicket ?? ""),
    estado,
    descripcion: desc,
    terminado: !!nombre,
    fallado: /error|rechaz|fall/.test(texto),
    archivo: nombre ? { nombre, tipo: tipo ?? "" } : null,
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
  const res3 = await pedir(urlArchivo(ticket.archivo.nombre, ticket.archivo.tipo), token, traer);
  return { ticket: numTicket, nombre: ticket.archivo.nombre, contenido: await res3.arrayBuffer() };
}
