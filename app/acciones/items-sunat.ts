"use server";
// Importar el detalle de los comprobantes, desde la pantalla
//
// El detalle de ítems no se baja por API: sale del XML de cada comprobante,
// que una persona obtiene en «Consultar Factura y Nota → Descarga masiva» y
// sube acá como ZIP. Esto lo abre, lee cada XML, y lo guarda.
//
// Escribe en la base a través de `guardar_cpe`, que reemplaza los ítems de un
// comprobante ya visto: reimportar el mismo ZIP no duplica nada.

import { solicitanteActual, clienteServidor } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";
import { leerZip } from "@/lib/sunat/zip";
import { leerComprobanteXml } from "@/lib/sunat/cpe-xml";
import { prepararLote } from "@/lib/sunat/cpe-importacion";
import {
  filasItemsSunat, nombreArchivoItems, TIPOS_ITEMS, type FilaDetalleCpe,
} from "@/lib/export/items-sunat";
import { publicarHoja, explicarFallo } from "@/lib/drive/servidor";

export interface ResultadoImportacion {
  ok: boolean;
  motivo?: string;
  /** Cuántos XML se encontraron en el ZIP. */
  archivos?: number;
  nuevos?: number;
  actualizados?: number;
  items?: number;
  /** Cuántos quedaron como OTRO: ni emitidos ni recibidos por esta empresa. */
  ajenos?: number;
}

/**
 * El RUC de una empresa a partir de su abreviatura.
 *
 * El importador no necesita las credenciales del SIRE —no llama a SUNAT, lee
 * un archivo—, pero sí el RUC, para decidir si cada comprobante es recibido o
 * emitido y para guardarlo a nombre de la empresa correcta.
 */
async function rucDeEmpresa(abreviatura: string): Promise<string | null> {
  const sb = await clienteServidor();
  const { data } = await sb
    .from("empresas").select("ruc").eq("abreviatura", abreviatura).single();
  return data?.ruc ?? null;
}

/**
 * Convierte los bytes de un XML a texto respetando su codificación.
 *
 * SUNAT declara sus comprobantes en ISO-8859-1, no en UTF-8; leerlos como
 * UTF-8 parte las tildes y las eñes. Se mira el prólogo del propio archivo y
 * se decodifica como diga, con UTF-8 de reserva, que es lo que asume XML sin
 * declaración.
 */
function decodificarXml(buf: Buffer): string {
  const cabeza = buf.subarray(0, 120).toString("latin1").toLowerCase();
  const m = /encoding=["']([^"']+)["']/.exec(cabeza);
  const enc = (m?.[1] ?? "utf-8").trim();
  const latin = /8859-1|latin1|iso-8859-1|windows-1252/.test(enc);
  return buf.toString(latin ? "latin1" : "utf8");
}

/**
 * Saca todos los XML de un ZIP, entrando en los ZIP anidados.
 *
 * La descarga de un comprobante suelto trae el XML junto a un CSS y un XSL de
 * presentación, que se ignoran. La masiva puede traer un ZIP por comprobante
 * dentro de uno grande, así que se recorre hacia adentro.
 */
function xmlsDelZip(datos: Buffer): string[] {
  const out: string[] = [];
  for (const a of leerZip(datos)) {
    if (/\.zip$/i.test(a.nombre)) out.push(...xmlsDelZip(a.contenido));
    else if (/\.xml$/i.test(a.nombre)) out.push(decodificarXml(a.contenido));
  }
  return out;
}

/**
 * Importa un ZIP de la descarga masiva.
 *
 * Recibe el archivo en base64 porque viaja desde el navegador dentro de una
 * acción de servidor. Todo el trabajo pesado —abrir, leer, guardar— pasa en
 * el servidor; el navegador solo manda los bytes.
 */
export async function importarComprobantesZip(
  abreviatura: string, base64: string
): Promise<ResultadoImportacion> {
  const solicitante = await solicitanteActual();
  if (!solicitante || !autoriza(solicitante, "editar_catalogos").ok) {
    return { ok: false, motivo: "Solo Administración del sistema puede importar comprobantes." };
  }

  const ruc = await rucDeEmpresa(abreviatura);
  if (!ruc) return { ok: false, motivo: "Esa empresa no existe." };

  let xmls: string[];
  try {
    xmls = xmlsDelZip(Buffer.from(base64, "base64"));
  } catch (e) {
    return { ok: false, motivo: `No se pudo abrir el ZIP: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (xmls.length === 0) {
    return { ok: false, motivo: "El ZIP no trae ningún XML. ¿Es el archivo de la descarga masiva?" };
  }

  const lote = prepararLote(xmls.map(leerComprobanteXml), ruc);
  if (lote.length === 0) {
    return { ok: false, motivo: "Ninguno de los XML se pudo leer como comprobante." };
  }
  const ajenos = lote.filter(d => d.origen === "OTRO").length;

  const sb = await clienteServidor();
  const { data, error } = await sb.rpc("guardar_cpe", { p_empresa_ruc: ruc, p_docs: lote });
  if (error) return { ok: false, motivo: error.message };

  const r = (Array.isArray(data) ? data[0] : data) as
    { nuevos: number; actualizados: number; items: number } | null;

  return {
    ok: true,
    archivos: xmls.length,
    nuevos: r?.nuevos ?? 0,
    actualizados: r?.actualizados ?? 0,
    items: r?.items ?? 0,
    ajenos,
  };
}

// ════════════════════════════════════════════════════════════════
// La hoja del detalle

export interface HojaItems {
  nombre: string;
  filas: string[][];
  cuantos: number;
}

async function filasDetalle(periodo?: string): Promise<FilaDetalleCpe[] | null> {
  const solicitante = await solicitanteActual();
  if (!solicitante || !autoriza(solicitante, "exportar").ok) return null;

  const sb = await clienteServidor();
  const { data, error } = await sb.rpc("detalle_cpe", { p_periodo: periodo ?? null });
  if (error || !Array.isArray(data)) return null;

  const aNum = (v: unknown) => (v == null || v === "" ? null : Number(v));
  return (data as Record<string, unknown>[]).map(d => ({
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
    enlace: (d.enlace as string) ?? null,
  }));
}

/** Cuántos comprobantes importados hay y de qué períodos. */
export async function periodosDeItems(): Promise<Array<{ periodo: string; cuantos: number }>> {
  const solicitante = await solicitanteActual();
  if (!solicitante || !autoriza(solicitante, "exportar").ok) return [];

  const sb = await clienteServidor();
  const { data } = await sb.rpc("periodos_de_cpe");
  return Array.isArray(data)
    ? (data as Array<{ periodo: string; cuantos: number }>).map(p => ({ periodo: p.periodo, cuantos: Number(p.cuantos) }))
    : [];
}

/** Arma la hoja del detalle, para bajarla como CSV. */
export async function hojaDeItems(periodo?: string): Promise<HojaItems | null> {
  const filas = await filasDetalle(periodo);
  if (!filas) return null;
  return {
    nombre: nombreArchivoItems(periodo ?? null),
    filas: filasItemsSunat(filas),
    cuantos: filas.length,
  };
}

/**
 * Publica el detalle como hoja de Google, en su propio archivo.
 *
 * Va aparte del histórico de cabeceras a propósito: son dos vistas distintas
 * —una por comprobante, otra por ítem— y publicarlas juntas haría que una
 * pisara la pestaña de datos de la otra.
 */
export async function publicarItemsEnDrive(): Promise<
  { ok: true; url: string; cuantos: number; reemplazada: boolean } | { ok: false; motivo: string }
> {
  const hoja = await hojaDeItems();
  if (!hoja) return { ok: false, motivo: "No se pudo armar la hoja. ¿Sigue abierta la sesión?" };
  if (hoja.cuantos === 0) {
    return { ok: false, motivo: "No hay ítems importados todavía. Sube un ZIP de la descarga masiva primero." };
  }

  try {
    const r = await publicarHoja({
      filas: hoja.filas,
      nombre: "COMPROBANTES SUNAT - DETALLE",
      carpetas: ["SUNAT"],
      tipos: TIPOS_ITEMS,
    });
    return { ok: true, url: r.url, cuantos: hoja.cuantos, reemplazada: r.reemplazada };
  } catch (e) {
    return { ok: false, motivo: explicarFallo(e) };
  }
}
