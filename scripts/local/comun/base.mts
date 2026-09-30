// Supabase: qué falta confirmar, guardar lo confirmado, publicar la hoja de detalle.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { pedir, RUC, PERIODOS, MAS_RECIENTE_PRIMERO, RUCS, SERIES } from "./config.mts";
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

const PAGINA = 500;
type ErrorPg = { message: string; code?: string; details?: string | null; hint?: string | null };
/** Una página: las filas con id mayor a `despuesDe` (null = desde el principio), ordenadas por id, de a `tamano`. */
type Pagina<T> = (despuesDe: string | null, tamano: number) => PromiseLike<{ data: T[] | null; error: ErrorPg | null }>;

/**
 * Lee una tabla entera, de a PAGINA filas, por CURSOR (id > el último visto).
 *
 * Antes era por offset (`.range(1000, 1999)`…): cada página obligaba a la base
 * a recorrer y descartar todas las anteriores, y con la base ocupada (otra
 * corrida guardando lotes) las últimas pasaban el statement_timeout de
 * Supabase («canceling statement due to statement timeout», código 57014) —
 * 30/09/2026, en el sondeo de una segunda laptop. Por cursor, todas las
 * páginas cuestan lo mismo. Si igual se corta por tiempo, se reintenta con
 * páginas más chicas (500 → 250 → … → 50): la regla de acceso de
 * cpe_comprobante evalúa `seguridad.puede_ver_todo()` por cada fila revisada,
 * y con la base cargada ni 500 entraban en el tope (ver migración 043).
 */
async function todas<T extends { id: string }>(b: Bitacora | null, etiqueta: string, pagina: Pagina<T>): Promise<T[]> {
  const filas: T[] = [];
  let ultimo: string | null = null;
  let tamano = PAGINA;
  for (;;) {
    let r: { data: T[] | null; error: ErrorPg | null } = { data: null, error: null };
    for (let intento = 1; intento <= 8; intento++) {
      r = await pagina(ultimo, tamano);
      if (!r.error) break;
      const tiempo = r.error.code === "57014" || /timeout/i.test(r.error.message);
      if (tiempo) tamano = Math.max(50, Math.floor(tamano / 2));
      b?.log("aviso", "base", `leer ${etiqueta} falló (intento ${intento}/8, sigue de a ${tamano}): ${r.error.code ?? ""} ${r.error.message}`, { error: r.error });
      if (!tiempo || intento === 8) throw new Error(`No se pudo leer ${etiqueta}: ${r.error.code ?? ""} ${r.error.message}`);
      await dormir(1000 * intento);
    }
    const data = r.data ?? [];
    filas.push(...data);
    if (data.length < tamano) return filas;
    ultimo = data[data.length - 1].id;
  }
}

/** Orden por fecha de emisión (y id para desempatar), como lo pedía la consulta antes de ir por cursor. */
function porFecha<T extends { id: string; fecha_emision: string | null }>(filas: T[], asc: boolean): T[] {
  const k = (x: T) => `${x.fecha_emision ?? "9999-99-99"}|${x.id}`;
  return filas.sort((a, z) => (asc ? 1 : -1) * k(a).localeCompare(k(z)));
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
  type FilaSire = { id: string; proveedor_ruc: string; proveedor_nombre: string | null; tipo_comprobante: string; serie: string; numero: string; fecha_emision: string | null; periodo: string | null };
  const asc = !MAS_RECIENTE_PRIMERO;
  const sire = porFecha(await todas<FilaSire>(b, "comprobantes_sunat", (despues, tamano) => {
    let q = c.from("comprobantes_sunat")
      .select("id, proveedor_ruc, proveedor_nombre, tipo_comprobante, serie, numero, fecha_emision, periodo")
      .eq("empresa_ruc", RUC).in("tipo_comprobante", ["01", "07", "08"]).neq("proveedor_ruc", "0");
    if (SERIES === "noE") q = q.not("serie", "ilike", "E%");
    if (SERIES === "E") q = q.ilike("serie", "E%");
    if (PERIODOS.length) q = q.in("periodo", PERIODOS);
    if (RUCS.length) q = q.in("proveedor_ruc", RUCS);
    if (despues) q = q.gt("id", despues);
    return q.order("id").limit(tamano);
  }), asc);
  const ya = await yaGuardados(b);
  const vistos = new Set(ya.map(x => clave(x)));
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
  const unicos = new Map<string, Pendiente>();
  for (const x of await yaGuardados(b)) {
    if (x.conPdf || !["01", "07", "08"].includes(x.tipoComprobante)) continue;
    if (PERIODOS.length && !PERIODOS.includes(x.periodo ?? "")) continue;
    unicos.set(clave(x), { proveedorRuc: x.proveedorRuc, proveedorNombre: null, tipoComprobante: x.tipoComprobante, serie: x.serie, numero: x.numero, fechaEmision: x.fechaEmision, periodo: x.periodo });
  }
  const lista = [...unicos.values()].sort((a, z) => (MAS_RECIENTE_PRIMERO ? -1 : 1) * (a.fechaEmision ?? "").localeCompare(z.fechaEmision ?? ""));
  b.log("info", "cola", `guardados sin PDF: ${lista.length}`);
  return lista;
}

/**
 * Qué comprobantes ya están guardados, leído de `detalle_cpe` (la misma
 * función que arma la hoja de detalle) y NO de la tabla cpe_comprobante.
 *
 * La regla de acceso de cpe_comprobante evalúa `seguridad.puede_ver_todo()`
 * por cada fila; con ~12 700 filas (30/09/2026) ni una página de 50 entraba en
 * el statement_timeout de Supabase. `detalle_cpe` es security definer (sin esa
 * regla por fila) y ya se usaba para publicar la hoja sin problemas. Trae una
 * fila por ítem: se deduplica por comprobante. Un comprobante sin ítems no
 * aparece y se volvería a bajar: inofensivo (guardar_cpe es idempotente).
 * El arreglo de fondo es la migración 043.
 */
async function yaGuardados(b: Bitacora): Promise<Array<Pendiente & { conPdf: boolean }>> {
  const t0 = Date.now();
  const filas = await detalleCpeCompleto(await base(), null);
  const m = new Map<string, Pendiente & { conPdf: boolean }>();
  for (const d of filas) {
    const x = {
      proveedorRuc: String(d.proveedor_ruc ?? ""), proveedorNombre: null, tipoComprobante: String(d.tipo_comprobante ?? ""),
      serie: String(d.serie ?? ""), numero: String(d.numero ?? ""), fechaEmision: (d.fecha_emision as string) ?? null,
      periodo: (d.periodo as string) ?? null, conPdf: !!d.enlace_pdf,
    };
    if (!x.proveedorRuc || !x.serie || !x.numero) continue;
    const k = clave(x);
    const previo = m.get(k);
    m.set(k, previo ? { ...previo, conPdf: previo.conPdf || x.conPdf } : x);
  }
  b.log("info", "base", `ya guardados: ${m.size} comprobantes (${filas.length} ítems, leídos en ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  return [...m.values()];
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
