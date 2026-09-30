// Supabase: qué falta confirmar, guardar lo confirmado, publicar la hoja de detalle.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { pedir, RUC, PERIODOS, MAS_RECIENTE_PRIMERO } from "./config.mts";
import { dormir, type Bitacora } from "./bitacora.mts";
import { prepararLote, identidad } from "../../../lib/sunat/cpe-importacion.ts";
import type { ComprobanteCpe } from "../../../lib/sunat/cpe-xml.ts";
import { publicarHoja } from "../../../lib/drive/servidor.ts";
import { filasItemsSunat, filaDetalleDesdeRpc, detalleCpeCompleto, TIPOS_ITEMS } from "../../../lib/export/items-sunat.ts";
import { clave, type Pendiente } from "./tipos.mts";

let sb: SupabaseClient | null = null;
export async function base(forzar = false): Promise<SupabaseClient> {
  if (sb && !forzar) return sb;
  const c = createClient(pedir("SUPABASE_URL", "PROJECT_URL"), pedir("SUPABASE_ANON_KEY", "ANON_KEY"),
    { auth: { autoRefreshToken: true, persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email: pedir("ROBOT_CORREO"), password: pedir("ROBOT_CLAVE") });
  if (error) throw new Error(`No se pudo entrar a la base: ${error.message}`);
  sb = c;
  return c;
}

type Pagina<T> = (d: number, h: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
/** PostgREST corta en 1000 filas sin avisar: se pagina siempre. */
async function todas<T>(etiqueta: string, pagina: Pagina<T>): Promise<T[]> {
  const filas: T[] = [];
  for (let d = 0; ; d += 1000) {
    const { data, error } = await pagina(d, d + 999);
    if (error) throw new Error(`No se pudo leer ${etiqueta}: ${error.message}`);
    filas.push(...(data ?? []));
    if ((data ?? []).length < 1000) return filas;
  }
}

/** Archivo acumulado (entre corridas) de lo que SUNAT dijo que no existe. */
export const ARCHIVO_NO_EXISTE = join(process.cwd(), "logs", "cpe-no-existe.jsonl");

/**
 * Lo que el SIRE dice que existe (01/07/08, serie no-E) y todavía no está en
 * `cpe_comprobante`. Mismo criterio que consultar-cpe-individual.mts, con la
 * comparación normalizada (serie en mayúsculas, número sin ceros a la izquierda).
 */
export async function pendientes(b: Bitacora): Promise<Pendiente[]> {
  const c = await base();
  type FilaSire = { proveedor_ruc: string; proveedor_nombre: string | null; tipo_comprobante: string; serie: string; numero: string; fecha_emision: string | null; periodo: string | null };
  const asc = !MAS_RECIENTE_PRIMERO;
  const sire = await todas<FilaSire>("comprobantes_sunat", (d, h) => {
    let q = c.from("comprobantes_sunat")
      .select("proveedor_ruc, proveedor_nombre, tipo_comprobante, serie, numero, fecha_emision, periodo")
      .eq("empresa_ruc", RUC).not("serie", "ilike", "E%").in("tipo_comprobante", ["01", "07", "08"]).neq("proveedor_ruc", "0");
    if (PERIODOS.length) q = q.in("periodo", PERIODOS);
    return q.order("fecha_emision", { ascending: asc }).order("id", { ascending: asc }).range(d, h);
  });
  type FilaCpe = { proveedor_ruc: string; tipo_comprobante: string; serie: string; numero: string };
  const ya = await todas<FilaCpe>("cpe_comprobante", (d, h) => c.from("cpe_comprobante")
    .select("proveedor_ruc, tipo_comprobante, serie, numero").eq("empresa_ruc", RUC).not("serie", "ilike", "E%").order("id").range(d, h));

  const vistos = new Set(ya.map(x => clave({ proveedorRuc: x.proveedor_ruc, tipoComprobante: x.tipo_comprobante, serie: x.serie, numero: x.numero })));
  const noExisten = leerNoExisten();
  const lista = sire.filter(x => x.proveedor_ruc && x.tipo_comprobante && x.serie && x.numero).map(x => ({
    proveedorRuc: x.proveedor_ruc, proveedorNombre: x.proveedor_nombre, tipoComprobante: x.tipo_comprobante,
    serie: x.serie, numero: x.numero, fechaEmision: x.fecha_emision, periodo: x.periodo,
  })).filter(p => !vistos.has(clave(p)));
  const final = lista.filter(p => !noExisten.has(clave(p)));
  if (final.length < lista.length) b.log("info", "cola", `se saltan ${lista.length - final.length} que SUNAT ya dijo que no existen (REINTENTAR_NO_EXISTE=1 para pedirlos igual)`);
  return final;
}

/**
 * MODO=pdf: lo que YA está en cpe_comprobante pero sin PDF en Drive.
 *
 * Volver a pasarlos por la tubería completa es seguro: el XML ya subido se
 * reconoce por nombre en Drive («existe», no se duplica) y `guardar_cpe`
 * conserva los enlaces que ya había (coalesce) — solo llena el del PDF.
 */
export async function pendientesSinPdf(b: Bitacora): Promise<Pendiente[]> {
  const c = await base();
  type Fila = { proveedor_ruc: string; proveedor_nombre: string | null; tipo_comprobante: string; serie: string; numero: string; fecha_emision: string | null; periodo: string | null };
  const filas = await todas<Fila>("cpe_comprobante sin PDF", (d, h) => {
    let q = c.from("cpe_comprobante")
      .select("proveedor_ruc, proveedor_nombre, tipo_comprobante, serie, numero, fecha_emision, periodo")
      .eq("empresa_ruc", RUC).is("pdf_drive_url", null).in("tipo_comprobante", ["01", "07", "08"]);
    if (PERIODOS.length) q = q.in("periodo", PERIODOS);
    return q.order("fecha_emision", { ascending: !MAS_RECIENTE_PRIMERO }).order("id").range(d, h);
  });
  b.log("info", "cola", `en cpe_comprobante sin PDF: ${filas.length}`);
  return filas.filter(x => x.proveedor_ruc && x.serie && x.numero).map(x => ({
    proveedorRuc: x.proveedor_ruc, proveedorNombre: x.proveedor_nombre, tipoComprobante: x.tipo_comprobante,
    serie: x.serie, numero: x.numero, fechaEmision: x.fecha_emision, periodo: x.periodo,
  }));
}

function leerNoExisten(): Set<string> {
  const s = new Set<string>();
  if (!existsSync(ARCHIVO_NO_EXISTE) || process.env.REINTENTAR_NO_EXISTE === "1") return s;
  for (const l of readFileSync(ARCHIVO_NO_EXISTE, "utf8").split("\n")) {
    try { if (l.trim()) s.add((JSON.parse(l) as { clave: string }).clave); } catch { /* línea rota */ }
  }
  return s;
}

export type Confirmado = { c: ComprobanteCpe; xmlUrl: string | null; pdfUrl: string | null };

/** `guardar_cpe` (idempotente) con 3 intentos; si no entra, el lote queda en disco. */
export async function guardarLote(b: Bitacora, comprobantes: Confirmado[]): Promise<{ guardados: number; items: number }> {
  const docs = prepararLote(comprobantes.map(x => x.c), RUC);
  const porId = new Map(comprobantes.map(x => [identidad(x.c), x]));
  for (const d of docs) { const par = porId.get(identidad(d)); d.xmlDriveUrl = par?.xmlUrl ?? null; d.pdfDriveUrl = par?.pdfUrl ?? null; }
  for (let i = 1; i <= 3; i++) {
    const { data, error } = await (await base(i > 1)).rpc("guardar_cpe", { p_empresa_ruc: RUC, p_docs: docs });
    if (!error) {
      const r = (Array.isArray(data) ? data[0] : data) as { nuevos: number; actualizados: number; items: number };
      b.log("info", "base", `guardados ${docs.length}: ${r?.nuevos} nuevos, ${r?.actualizados} actualizados, ${r?.items} ítems`);
      return { guardados: (r?.nuevos ?? 0) + (r?.actualizados ?? 0), items: r?.items ?? 0 };
    }
    b.log("error", "base", `guardar_cpe falló (intento ${i}/3): ${error.message}`, { error });
    await dormir(3000 * i);
  }
  const archivo = join(b.dir, `lote-no-guardado-${Date.now()}.json`);
  writeFileSync(archivo, JSON.stringify(docs));
  b.log("error", "base", `el lote quedó en ${archivo}`);
  return { guardados: 0, items: 0 };
}

/** Reescribe «COMPROBANTES SUNAT - DETALLE» con todo el detalle de la base. */
export async function publicarDetalle(b: Bitacora): Promise<void> {
  if (!process.env.GOOGLE_DRIVE_FOLDER_ID) { b.log("info", "hoja", "sin GOOGLE_DRIVE_FOLDER_ID: no se publica"); return; }
  const t0 = Date.now();
  try {
    const filas = (await detalleCpeCompleto(await base(), null)).map(filaDetalleDesdeRpc);
    const r = await publicarHoja({ filas: filasItemsSunat(filas), nombre: "COMPROBANTES SUNAT - DETALLE", carpetas: ["SUNAT"], tipos: TIPOS_ITEMS });
    b.log("info", "hoja", `detalle publicado: ${filas.length} ítems en ${((Date.now() - t0) / 1000).toFixed(0)}s · ${r.url}`);
  } catch (e) {
    b.log("error", "hoja", `no se pudo publicar: ${e instanceof Error ? e.message : e}`);
  }
}
