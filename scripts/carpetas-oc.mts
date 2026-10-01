// Leer la carpeta madre de compras nacionales («5. Ordenes de Compra») y
// anotar, de cada OC, su carpeta y los comprobantes que tiene adentro
//
// Compras guarda cada OC nacional en una carpeta con nombre fijo:
//   «OC 2026 - 0200 COMERCIALIZADORA LUCY - TALLERES ESPECIALIZADOS»
// dentro de la carpeta de su proyecto («01) TALLERES ESPECIALIZADOS»). Esto
// recorre todo el árbol y anota SOLO NOMBRES —no descarga ni abre ningún
// archivo—: qué OC es cada carpeta y qué parece cada archivo (factura, guía,
// XML…), con la serie del comprobante cuando el nombre la trae. Con eso la
// base une cada factura de SUNAT con su OC sin depender de los enlaces de CG.
//
// Lo mismo sirve para la carpeta de importaciones (PROCEDENCIA=importacion):
// ahí la OC va con 3 dígitos («172-2026»), como en el cuadro de aprobaciones,
// y la comparación es contra el legajo del cuadro en vez de CG.
//
// Lee con la cuenta de servicio de Drive (la misma que publica las hojas):
// la carpeta madre tiene que estar compartida con ella como Lector.
//
// DOS FASES:
//   • Depuración (DEBUG=1, por omisión): recorre (o solo la subcarpeta
//     SUBCARPETA) y deja el resultado en salida/carpetas-oc/ y en el resumen
//     de la corrida. No toca la base ni publica la hoja.
//   • Real (DEBUG=0): además sube los archivos a la base (origen CARPETA) y
//     publica la hoja «OC - CARPETAS COMPRAS NACIONALES».

import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  conectarDrive, publicarHoja, escribirPestana, explicarFallo, type Drive, type Hojas,
} from "../lib/drive/servidor.ts";
import type { TipoColumna } from "../lib/export/comprobantes-sunat.ts";
import {
  carpetaDeOC, clasificarArchivo, esComprobante, rucsEnNombre, type CarpetaDeOC, type Procedencia,
} from "../lib/drive/carpetas-oc.ts";

// ── Configuración desde el entorno ────────────────────────────────

const DEBUG = process.env.DEBUG !== "0";
// «nacional» (por omisión) o «importacion»: cambia la carpeta madre, la
// hoja, y la OC (nacional con 4 dígitos, importación con 3).
const PROCEDENCIA: Procedencia = /^imp/i.test(process.env.PROCEDENCIA?.trim() ?? "") ? "Importación" : "Nacional";
const IMPO = PROCEDENCIA === "Importación";
const CARPETA_MADRE = process.env.CARPETA_MADRE?.trim() ||
  (IMPO ? "1oJjtLinBgWej-ofRisFyheC29UwdicKi" : "1oGUtE0IhqwanRsmuuA7QlQRB_koZzOH3");
// Parte del nombre de una carpeta de proyecto («TALLERES»): recorre solo esa.
const SUBCARPETA = process.env.SUBCARPETA?.trim() ?? "";
const EMPRESA_RUC = process.env.EMPRESA_RUC?.trim() || "20512201611";
const NOMBRE_HOJA = IMPO ? "OC - CARPETAS IMPORTACIONES" : "OC - CARPETAS COMPRAS NACIONALES";
const CARPETAS_HOJA = ["SUNAT"];
// Cuántas carpetas se preguntan en una sola consulta a Drive, y cuántas consultas a la vez.
// En una unidad compartida de la que la cuenta de servicio no es miembro
// (solo le compartieron la carpeta), Drive no acepta «A o B o C in parents»:
// responde «requires shared drive membership». Ahí se pasa a una carpeta por
// consulta, con más consultas a la vez (1 de octubre de 2026, primera corrida).
let carpetasPorConsulta = 25;
const PARALELO = Number(process.env.PARALELO?.trim() || "4");
const PARALELO_DE_A_UNA = Number(process.env.PARALELO_DE_A_UNA?.trim() || "10");
const SIN_MEMBRESIA = /shared drive membership/i;

const SALIDA = join(process.cwd(), "salida", "carpetas-oc", IMPO ? "importaciones" : "nacionales");
mkdirSync(SALIDA, { recursive: true });

const MIME_CARPETA = "application/vnd.google-apps.folder";
const MIME_ATAJO = "application/vnd.google-apps.shortcut";
const DRIVES = { supportsAllDrives: true, includeItemsFromAllDrives: true };

// ── El recorrido ──────────────────────────────────────────────────

/** La OC a la que pertenece una carpeta, con la carpeta donde empieza. */
type OC = CarpetaDeOC & { carpetaId: string; carpetaNombre: string; proyectoCarpeta: string };

/** Una carpeta por revisar: dónde está y de qué OC es (si ya se sabe). */
type Pendiente = { id: string; ruta: string[]; proyectoCarpeta: string; oc: OC | null; sub: string };

type Archivo = {
  oc: OC | null; ruta: string; sub: string; nombre: string; id: string; url: string; mime: string;
  kb: number; modificado: string; parece: string; serie: string; rucs: string[];
};

// Si la carpeta madre está en una unidad compartida, las consultas se hacen
// sobre esa unidad; si está en «Mi unidad» de alguien, sobre lo compartido.
let donde: { corpora: string; driveId?: string } = { corpora: "user" };

const ocs = new Map<string, OC>();         // por id de carpeta
const archivos: Archivo[] = [];
const vistas = new Set<string>();
// Cada carpeta leída que está dentro de una OC → la carpeta de esa OC.
const carpetaDeLaOC = new Map<string, string>();
const fallos: string[] = [];
let carpetasLeidas = 0, consultas = 0;

function pausa(ms: number) { return new Promise(r => setTimeout(r, ms)); }

/** Una consulta a Drive con reintentos ante cupo excedido o fallas del servidor. */
async function conReintentos<T>(que: string, fn: () => Promise<T>): Promise<T> {
  for (let intento = 1; ; intento++) {
    try {
      consultas++;
      return await fn();
    } catch (e) {
      const err = e as { code?: number; message?: string };
      const msg = err.message ?? String(e);
      const pasajero = err.code === 429 || (err.code ?? 0) >= 500 ||
        /rate ?limit|userRateLimitExceeded|backendError|ECONNRESET|ETIMEDOUT|socket hang up|fetch failed/i.test(msg);
      if (!pasajero || intento >= 6) throw e;
      const espera = Math.min(60000, 2000 * 2 ** (intento - 1)) + Math.random() * 1000;
      console.log(`⚠ ${que}: ${msg.slice(0, 120)} — reintento ${intento}/5 en ${Math.round(espera / 1000)} s`);
      await pausa(espera);
    }
  }
}

/** «dd/mm/aaaa», como esperan las columnas de fecha de las hojas. */
function fecha(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const lima = new Date(d.getTime() - 5 * 3600 * 1000);
  return `${String(lima.getUTCDate()).padStart(2, "0")}/${String(lima.getUTCMonth() + 1).padStart(2, "0")}/${lima.getUTCFullYear()}`;
}

/** Qué contexto hereda una subcarpeta de su carpeta de arriba. */
function hijaDe(padre: Pendiente, id: string, nombre: string): Pendiente {
  const ruta = [...padre.ruta, nombre];
  const enLaRaiz = padre.ruta.length === 0;
  const proyectoCarpeta = enLaRaiz ? nombre : padre.proyectoCarpeta;
  // Dentro de una OC solo cuenta como OTRA OC si el nombre empieza con OC/OS
  // y es otro número; si no, es una subcarpeta («Factura y Guía»).
  const leida = carpetaDeOC(nombre, !!padre.oc, PROCEDENCIA);
  if (leida && (!padre.oc || leida.oc !== padre.oc.oc)) {
    const oc: OC = { ...leida, carpetaId: id, carpetaNombre: nombre, proyectoCarpeta };
    ocs.set(id, oc);
    carpetaDeLaOC.set(id, id);
    return { id, ruta, proyectoCarpeta, oc, sub: "" };
  }
  if (padre.oc) carpetaDeLaOC.set(id, padre.oc.carpetaId);
  return { id, ruta, proyectoCarpeta, oc: padre.oc, sub: padre.oc ? (padre.sub ? padre.sub + " / " : "") + nombre : "" };
}

type ItemDrive = {
  id?: string | null; name?: string | null; mimeType?: string | null; parents?: string[] | null;
  size?: string | null; modifiedTime?: string | null; webViewLink?: string | null;
  shortcutDetails?: { targetId?: string | null; targetMimeType?: string | null } | null;
};

/** Lee el contenido de varias carpetas en una sola consulta (paginada). */
async function leerGrupo(drive: Drive, grupo: Pendiente[]): Promise<Pendiente[]> {
  const porId = new Map(grupo.map(p => [p.id, p]));
  const q = "(" + grupo.map(p => `'${p.id}' in parents`).join(" or ") + ") and trashed = false";
  const nuevas: Pendiente[] = [];
  let pageToken: string | undefined;
  do {
    const r = await conReintentos("listar carpetas", () => drive.files.list({
      q, pageSize: 1000, pageToken, ...DRIVES, ...donde,
      fields: "nextPageToken, files(id,name,mimeType,parents,size,modifiedTime,webViewLink,shortcutDetails)",
    }));
    for (const f of (r.data.files ?? []) as ItemDrive[]) {
      const padre = porId.get((f.parents ?? []).find(x => porId.has(x)) ?? "");
      if (!padre || !f.id) continue;
      const nombre = f.name ?? "";
      const atajo = f.mimeType === MIME_ATAJO;
      const mime = (atajo ? f.shortcutDetails?.targetMimeType : f.mimeType) ?? "";
      const id = (atajo ? f.shortcutDetails?.targetId : f.id) ?? f.id;
      if (mime === MIME_CARPETA) {
        if (vistas.has(id)) continue;
        if (padre.ruta.length === 0 && SUBCARPETA && !nombre.toUpperCase().includes(SUBCARPETA.toUpperCase())) continue;
        vistas.add(id);
        nuevas.push(hijaDe(padre, id, nombre));
        continue;
      }
      const c = clasificarArchivo(nombre, padre.sub, mime);
      archivos.push({
        oc: padre.oc, ruta: padre.ruta.join(" / "), sub: padre.sub,
        nombre: atajo ? nombre + " (acceso directo)" : nombre, id, mime,
        url: atajo ? `https://drive.google.com/file/d/${id}/view` : f.webViewLink ?? `https://drive.google.com/file/d/${id}/view`,
        kb: Math.round(Number(f.size ?? 0) / 1024), modificado: fecha(f.modifiedTime),
        parece: c.parece, serie: c.serie, rucs: rucsEnNombre(nombre),
      });
    }
    pageToken = r.data.nextPageToken ?? undefined;
  } while (pageToken);
  carpetasLeidas += grupo.length;
  return nuevas;
}

async function recorrer(drive: Drive): Promise<void> {
  const raiz: Pendiente = { id: CARPETA_MADRE, ruta: [], proyectoCarpeta: "", oc: null, sub: "" };
  vistas.add(CARPETA_MADRE);
  let cola: Pendiente[] = [raiz];
  let ultimoAviso = Date.now();
  while (cola.length) {
    const grupos: Pendiente[][] = [];
    for (let i = 0; i < cola.length; i += carpetasPorConsulta) grupos.push(cola.slice(i, i + carpetasPorConsulta));
    cola = [];
    // De a varios grupos a la vez: rápido, sin pasar el cupo de Drive.
    for (let i = 0; i < grupos.length;) {
      const paralelo = carpetasPorConsulta === 1 ? PARALELO_DE_A_UNA : PARALELO;
      const tanda = grupos.slice(i, i + paralelo);
      i += paralelo;
      const res = await Promise.allSettled(tanda.map(g => leerGrupo(drive, g)));
      res.forEach((x, k) => {
        if (x.status === "fulfilled") { cola.push(...x.value); return; }
        const motivo = x.reason instanceof Error ? x.reason.message : String(x.reason);
        if (SIN_MEMBRESIA.test(motivo) && tanda[k].length > 1) {
          // Se vuelven a leer de a una en la vuelta siguiente.
          if (carpetasPorConsulta > 1) console.log("⚠ Unidad compartida sin membresía: se lee una carpeta por consulta.");
          carpetasPorConsulta = 1;
          cola.push(...tanda[k]);
          return;
        }
        for (const p of tanda[k]) fallos.push(`${p.ruta.join(" / ") || "(carpeta madre)"}: ${motivo}`);
      });
      if (Date.now() - ultimoAviso > 15000) {
        ultimoAviso = Date.now();
        console.log(`  … ${carpetasLeidas} carpetas leídas, ${ocs.size} OC, ${archivos.length} archivos`);
      }
    }
  }
}

// ── Las tablas ─────────────────────────────────────────────────────

const CAB_OCS = [
  "OC", "Tipo", "Proveedor (nombre de la carpeta)", "Proyecto (nombre de la carpeta)", "Carpeta del proyecto",
  "Archivos", "Comprobantes", "Series en los nombres", "RUC en los nombres", "XML",
  "Última modificación", "Carpeta de la OC", "Nombre de la carpeta", "Misma OC en otra carpeta",
];
const TIPOS_OCS: TipoColumna[] = [
  "texto", "texto", "texto", "texto", "texto", "numero", "numero", "texto", "texto", "numero",
  "fecha", "texto", "texto", "texto",
];
const CAB_ARCHIVOS = [
  "OC", "Proveedor (nombre de la carpeta)", "Carpeta del proyecto", "Subcarpeta", "Archivo", "Parece",
  "Serie en el nombre", "RUC en el nombre", "Tamaño (KB)", "Modificado", "Enlace", "Carpeta de la OC",
];
const TIPOS_ARCHIVOS: TipoColumna[] = [
  "texto", "texto", "texto", "texto", "texto", "texto", "texto", "texto", "numero", "fecha", "texto", "texto",
];

const urlCarpeta = (id: string) => `https://drive.google.com/drive/folders/${id}`;
const aFecha = (s: string) => s ? s.split("/").reverse().join("") : "";

function tablas() {
  const porCarpeta = new Map<string, Archivo[]>();
  for (const a of archivos) if (a.oc) {
    const l = porCarpeta.get(a.oc.carpetaId) ?? [];
    l.push(a);
    porCarpeta.set(a.oc.carpetaId, l);
  }
  const carpetasPorOc = new Map<string, OC[]>();
  for (const o of ocs.values()) carpetasPorOc.set(o.oc, [...(carpetasPorOc.get(o.oc) ?? []), o]);

  const filasOcs = [...ocs.values()]
    .sort((a, b) => a.oc.slice(5).localeCompare(b.oc.slice(5)) || a.oc.localeCompare(b.oc) || a.carpetaNombre.localeCompare(b.carpetaNombre))
    .map(o => {
      const l = porCarpeta.get(o.carpetaId) ?? [];
      const series = [...new Set(l.map(a => a.serie).filter(Boolean))];
      const rucs = [...new Set(l.flatMap(a => a.rucs))];
      const ultima = l.map(a => a.modificado).filter(Boolean).sort((x, y) => aFecha(y).localeCompare(aFecha(x)))[0] ?? "";
      const otras = (carpetasPorOc.get(o.oc) ?? []).filter(x => x.carpetaId !== o.carpetaId);
      return [
        o.oc, o.tipo, o.proveedor, o.proyecto, o.proyectoCarpeta,
        String(l.length), String(l.filter(a => esComprobante(a.parece)).length),
        series.join(" / "), rucs.join(" / "), String(l.filter(a => a.parece === "XML").length),
        ultima, urlCarpeta(o.carpetaId), o.carpetaNombre,
        otras.map(x => `${x.proyectoCarpeta} / ${x.carpetaNombre}`).join(" | "),
      ];
    });

  const filasArchivos = archivos
    .filter(a => a.oc)
    .sort((a, b) => a.oc!.oc.localeCompare(b.oc!.oc) || a.sub.localeCompare(b.sub) || a.nombre.localeCompare(b.nombre))
    .map(a => [
      a.oc!.oc, a.oc!.proveedor, a.oc!.proyectoCarpeta, a.sub, a.nombre, a.parece, a.serie, a.rucs.join(" / "),
      String(a.kb), a.modificado, a.url, urlCarpeta(a.oc!.carpetaId),
    ]);

  return { filasOcs, filasArchivos, porCarpeta };
}

function csv(filas: string[][]): string {
  return "﻿" + filas.map(f => f.map(c => /[",;\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(",")).join("\n");
}

// ── La base ─────────────────────────────────────────────────────────

/** Una variable del entorno; si falta, un error (en depuración la base es opcional). */
function leer(...nombres: string[]): string {
  for (const n of nombres) { const v = (process.env[n] ?? "").trim(); if (v) return v; }
  throw new Error(`falta ${nombres.join(" o ")} en el entorno`);
}

function clienteSupabase() {
  return createClient(leer("SUPABASE_URL", "PROJECT_URL"), leer("SUPABASE_ANON_KEY", "ANON_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } });
}
type Base = ReturnType<typeof clienteSupabase>;

async function entrarALaBase(): Promise<Base> {
  const sb = clienteSupabase();
  const { error } = await sb.auth.signInWithPassword({ email: leer("ROBOT_CORREO"), password: leer("ROBOT_CLAVE") });
  if (error) throw new Error(`No se pudo entrar como el robot: ${error.message}`);
  return sb;
}

/**
 * Todas las filas de una tabla, de a 1000 (el tope de cada consulta). Con un
 * orden fijo: sin él, dos páginas pueden repetir o saltarse filas.
 */
async function todas<T>(sb: Base, tabla: string, columnas: string, orden: string[], filtro: (q: any) => any = q => q): Promise<T[]> {
  const salida: T[] = [];
  for (let desde = 0; ; desde += 1000) {
    let q = filtro(sb.from(tabla).select(columnas));
    for (const c of orden) q = q.order(c);
    const { data, error } = await q.range(desde, desde + 999);
    if (error) throw new Error(`${tabla}: ${error.message}`);
    salida.push(...(data as T[]));
    if (!data || data.length < 1000) return salida;
  }
}

const idDeCarpeta = (url: string) => /\/folders\/([\w-]{10,})/.exec(url ?? "")?.[1] ?? "";
/** «115-2026» → «0115-2026», como en la base de CG; vacío si no es una OC. */
const oc4 = (t: string) => { const m = /(\d{1,5})\s*-\s*(20\d\d)/.exec(t ?? ""); return m ? `${m[1].padStart(4, "0")}-${m[2]}` : ""; };

/** Lo que otra fuente sabe de cada OC: si la tiene, a qué carpeta enlaza y cuántos comprobantes se vieron ahí. */
type Fuente = {
  nombre: string; corto: string; archivo: string;
  listado: Set<string>; enlaces: Map<string, Set<string>>; comprobantes: Map<string, number>;
};

function anotar(f: Fuente, oc: string, url: string, parece?: string) {
  const id = idDeCarpeta(url);
  if (id) f.enlaces.set(oc, (f.enlaces.get(oc) ?? new Set()).add(id));
  if (parece !== undefined && esComprobante(parece)) f.comprobantes.set(oc, (f.comprobantes.get(oc) ?? 0) + 1);
}

/**
 * Nacionales: Control de Gestión (oc_base_cg) y lo que la captura encontró
 * siguiendo sus enlaces (oc_archivo, origen CAPTURA).
 */
async function fuenteCG(sb: Base): Promise<Fuente> {
  const f: Fuente = { nombre: "Frente a Control de Gestión", corto: "CG", archivo: "comparacion-cg.csv",
    listado: new Set((await todas<{ oc: string }>(sb, "oc_base_cg", "oc", ["oc", "cc_codigo", "cc_nombre"])).map(r => r.oc)),
    enlaces: new Map(), comprobantes: new Map() };
  const captura = await todas<{ oc: string; carpeta_url: string; parece: string }>(
    sb, "oc_archivo", "oc,carpeta_url,parece", ["oc", "url"], q => q.eq("origen", "CAPTURA"));
  for (const r of captura) {
    for (const o of String(r.oc ?? "").split(" / ").map(oc4).filter(Boolean)) anotar(f, o, r.carpeta_url, r.parece ?? "");
  }
  return f;
}

/**
 * Importaciones: el cuadro de aprobaciones, como lo dejó el legajo
 * (oc_legajo y oc_archivo con origen LEGAJO). Ahí la OC ya viene con 3 dígitos.
 */
async function fuenteCuadro(sb: Base): Promise<Fuente> {
  const f: Fuente = { nombre: "Frente al cuadro de aprobaciones (legajo)", corto: "cuadro", archivo: "comparacion-cuadro.csv",
    listado: new Set(), enlaces: new Map(), comprobantes: new Map() };
  const legajo = await todas<{ oc: string; carpeta_url: string }>(
    sb, "oc_legajo", "oc,carpeta_url", ["oc", "carpeta_url"], q => q.eq("procedencia", "Importación"));
  for (const r of legajo) { f.listado.add(r.oc); anotar(f, r.oc, r.carpeta_url); }
  const archivos = await todas<{ oc: string; parece: string }>(
    sb, "oc_archivo", "oc,parece", ["oc", "url"], q => q.eq("origen", "LEGAJO"));
  for (const r of archivos) {
    for (const o of String(r.oc ?? "").split(" / ")) {
      if (f.listado.has(o) && esComprobante(r.parece ?? "")) f.comprobantes.set(o, (f.comprobantes.get(o) ?? 0) + 1);
    }
  }
  return f;
}

/**
 * ¿La carpeta madre trae más que la otra fuente, o lo mismo? Por cada OC de
 * la madre: si la fuente la tiene, si su enlace apunta a la misma carpeta, y
 * dónde se vieron más comprobantes.
 */
function comparar(f: Fuente, porCarpeta: Map<string, Archivo[]>, completo: boolean): string {
  const porOc = new Map<string, OC[]>();
  for (const o of ocs.values()) porOc.set(o.oc, [...(porOc.get(o.oc) ?? []), o]);

  const c = { en: 0, noEn: 0, misma: 0, otra: 0, fuera: 0, sinEnlace: 0, soloMadre: 0, soloFuente: 0, ambas: 0, masEnMadre: 0 };
  const filas: string[][] = [["OC", "Proveedor (carpeta)", "Carpeta del proyecto", `Está en ${f.corto}`, `Enlace de ${f.corto}`,
    "Comprobantes en la madre", `Comprobantes vistos por ${f.corto}`, "Carpeta en la madre", `Carpeta del enlace de ${f.corto}`]];
  for (const [oc, carpetas] of [...porOc.entries()].sort()) {
    const ids = new Set(carpetas.map(o => o.carpetaId));
    const esta = f.listado.has(oc);
    esta ? c.en++ : c.noEn++;
    const suyos = [...(f.enlaces.get(oc) ?? [])];
    let enlace: string;
    if (!suyos.length) { enlace = "sin enlace (o no se pudo abrir)"; c.sinEnlace++; }
    else if (suyos.some(id => ids.has(carpetaDeLaOC.get(id) ?? ""))) { enlace = "misma carpeta"; c.misma++; }
    else if (suyos.some(id => carpetaDeLaOC.has(id) || vistas.has(id))) { enlace = "otra carpeta de la madre"; c.otra++; }
    else { enlace = completo ? "fuera de la carpeta madre" : "fuera de lo leído"; c.fuera++; }

    const enMadre = carpetas.reduce((n, o) => n + (porCarpeta.get(o.carpetaId) ?? []).filter(a => esComprobante(a.parece)).length, 0);
    const enFuente = f.comprobantes.get(oc) ?? 0;
    if (enMadre && !enFuente) c.soloMadre++;
    else if (!enMadre && enFuente) c.soloFuente++;
    else if (enMadre && enFuente) c.ambas++;
    if (enMadre > enFuente) c.masEnMadre++;
    filas.push([oc, carpetas[0].proveedor, carpetas[0].proyectoCarpeta, esta ? "Sí" : "No", enlace,
      String(enMadre), String(enFuente), carpetas.map(o => urlCarpeta(o.carpetaId)).join(" | "),
      suyos.map(urlCarpeta).join(" | ")]);
  }
  writeFileSync(join(SALIDA, f.archivo), csv(filas));

  // Solo con la madre completa tiene sentido contar lo que la fuente tiene y la madre no.
  const anio = new Date().getFullYear();
  const faltan = completo ? [...f.listado].filter(oc => oc.endsWith(`-${anio}`) && !porOc.has(oc)).length : null;
  return [
    `### ${f.nombre}`,
    "",
    `De las **${porOc.size}** OC de la carpeta madre${completo ? "" : " leídas"}:`,
    `- Están en ${f.corto}: **${c.en}**; **no** están: **${c.noEn}**`,
    `- El enlace de ${f.corto} apunta a la misma carpeta (o a una subcarpeta): **${c.misma}**; a otra carpeta de la madre: ${c.otra}; ${completo ? "fuera de la madre" : "fuera de lo leído"}: ${c.fuera}; sin enlace: ${c.sinEnlace}`,
    `- Con comprobante solo en la madre: **${c.soloMadre}**; solo en ${f.corto}: ${c.soloFuente}; en las dos: ${c.ambas}`,
    `- OC donde la madre tiene más comprobantes que ${f.corto}: **${c.masEnMadre}**`,
    ...(faltan !== null ? [`- OC de ${anio} que ${f.corto} tiene y la madre no: ${faltan}`] : []),
    "",
    `El detalle por OC está en \`${f.archivo}\`.`,
  ].join("\n");
}

async function subirALaBase(sb: Base, filasOcs: string[][], porCarpeta: Map<string, Archivo[]>, completo: boolean) {
  const carpetas = filasOcs.map(f => ({
    oc: f[0], tipo: f[1], proveedor: f[2], proyecto: f[3], proyectoCarpeta: f[4],
    archivos: Number(f[5]), comprobantes: Number(f[6]), series: f[7], rucs: f[8],
    carpetaUrl: f[11], carpetaNombre: f[12],
  }));
  const deArchivos = [...ocs.values()].flatMap(o => (porCarpeta.get(o.carpetaId) ?? []).map(a => ({
    oc: o.oc, proveedorRuc: a.rucs.join(" / "), proveedor: o.proveedor, carpetaUrl: urlCarpeta(o.carpetaId),
    nombre: a.nombre, url: a.url, tipoArchivo: a.mime, parece: a.parece, serie: a.serie,
  })));

  // Solo una corrida completa y sin fallas reemplaza lo anterior; si no, se suma.
  for (const [parte, filas] of [["CARPETAS", carpetas], ["ARCHIVOS", deArchivos]] as const) {
    let total = 0;
    for (let i = 0; i < filas.length; i += 1000) {
      const { data, error: e } = await sb.rpc("cargar_carpetas_oc", {
        p_empresa_ruc: EMPRESA_RUC, p_parte: parte, p_filas: filas.slice(i, i + 1000).map(f => ({ ...f, procedencia: PROCEDENCIA })),
        p_desde_cero: completo && i === 0,
      });
      if (e) throw new Error(`cargar_carpetas_oc (${parte}): ${e.message}`);
      total += Number(data ?? 0);
    }
    console.log(`✓ Base: ${total} filas de ${parte === "CARPETAS" ? "carpetas de OC" : "archivos"}${completo ? " (reemplazó lo anterior)" : " (sumadas a lo anterior)"}`);
  }
}

// ── Publicar la hoja ────────────────────────────────────────────────

async function asegurarPestana(hojas: Hojas, id: string, nombre: string) {
  const meta = await hojas.spreadsheets.get({ spreadsheetId: id, fields: "sheets(properties(title))" });
  if ((meta.data.sheets ?? []).some(s => s.properties?.title === nombre)) return;
  await hojas.spreadsheets.batchUpdate({
    spreadsheetId: id, requestBody: { requests: [{ addSheet: { properties: { title: nombre } } }] },
  });
}

// ── Principal ───────────────────────────────────────────────────────

async function main() {
  const inicio = Date.now();
  const { drive, hojas } = conectarDrive();
  let madre: string;
  try {
    const r = await drive.files.get({ fileId: CARPETA_MADRE, fields: "id,name,mimeType,driveId", ...DRIVES });
    madre = r.data.name ?? CARPETA_MADRE;
    if (r.data.driveId) donde = { corpora: "drive", driveId: r.data.driveId };
  } catch (e) {
    console.error(`✗ No se pudo abrir la carpeta madre (${CARPETA_MADRE}): ${explicarFallo(e)}`);
    console.error("  Compártela como Lector con el correo de la cuenta de servicio (GOOGLE_SA_EMAIL).");
    process.exit(1);
  }
  console.log(`▶ Carpeta madre: «${madre}»${SUBCARPETA ? ` — solo los proyectos que dicen «${SUBCARPETA}»` : ""}${DEBUG ? " (depuración: no toca la base ni la hoja)" : ""}`);

  await recorrer(drive);
  const { filasOcs, filasArchivos, porCarpeta } = tablas();

  // Lo que quedó fuera de una carpeta de OC: para ver si hay nombres que no se entienden.
  const sueltos = archivos.filter(a => !a.oc);
  const carpetasSinOc = new Map<string, number>();
  for (const a of sueltos) carpetasSinOc.set(a.ruta, (carpetasSinOc.get(a.ruta) ?? 0) + 1);

  const deOc = archivos.filter(a => a.oc);
  const comprobantes = deOc.filter(a => esComprobante(a.parece));
  const conSerie = deOc.filter(a => a.serie);
  const ocsUnicas = new Set([...ocs.values()].map(o => o.oc));
  const ocsConComprobante = new Set(comprobantes.map(a => a.oc!.oc));
  const ocsConSerie = new Set(conSerie.map(a => a.oc!.oc));
  const porProyecto = new Map<string, { ocs: Set<string>; archivos: number; comprobantes: number }>();
  for (const o of ocs.values()) {
    const p = porProyecto.get(o.proyectoCarpeta) ?? { ocs: new Set(), archivos: 0, comprobantes: 0 };
    p.ocs.add(o.oc);
    porProyecto.set(o.proyectoCarpeta, p);
  }
  for (const a of deOc) {
    const p = porProyecto.get(a.oc!.proyectoCarpeta)!;
    p.archivos++;
    if (esComprobante(a.parece)) p.comprobantes++;
  }
  const parece = new Map<string, number>();
  for (const a of deOc) parece.set(a.parece, (parece.get(a.parece) ?? 0) + 1);
  const gb = archivos.reduce((s, a) => s + a.kb, 0) / 1024 / 1024;

  let resumen = [
    `## Carpeta madre de ${IMPO ? "importaciones" : "compras nacionales"}${SUBCARPETA ? ` (solo «${SUBCARPETA}»)` : ""}`,
    "",
    `- Carpetas leídas: **${carpetasLeidas}** (${consultas} consultas a Drive, ${Math.round((Date.now() - inicio) / 1000)} s)`,
    `- OC distintas: **${ocsUnicas.size}** en ${ocs.size} carpetas de OC (${[...ocs.values()].filter(o => o.tipo === "OS").length} de servicio)`,
    `- Archivos dentro de una OC: **${deOc.length}** (${gb.toFixed(1)} GB en total, sin descargar nada)`,
    `- Comprobantes (factura, boleta, RH, nota, XML): **${comprobantes.length}**, con serie en el nombre: **${conSerie.length}**`,
    `- OC con al menos un comprobante: **${ocsConComprobante.size}**; con serie legible: **${ocsConSerie.size}**`,
    `- Archivos fuera de una carpeta de OC: ${sueltos.length} (en ${carpetasSinOc.size} carpetas)`,
    fallos.length ? `- ⚠ Carpetas que no se pudieron leer: ${fallos.length}` : "- Sin fallas de lectura",
    "",
    "| Proyecto | OC | Archivos | Comprobantes |",
    "|---|---:|---:|---:|",
    ...[...porProyecto.entries()].sort((a, b) => b[1].archivos - a[1].archivos)
      .map(([p, x]) => `| ${p} | ${x.ocs.size} | ${x.archivos} | ${x.comprobantes} |`),
    "",
    "| Parece | Archivos |",
    "|---|---:|",
    ...[...parece.entries()].sort((a, b) => b[1] - a[1]).map(([p, n]) => `| ${p} | ${n} |`),
    "",
    carpetasSinOc.size ? "**Carpetas con archivos que no están dentro de una OC** (las 15 con más archivos):" : "",
    ...[...carpetasSinOc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([r, n]) => `- ${r || "(carpeta madre)"} — ${n}`),
    "",
    ...(fallos.length ? ["**No se pudieron leer:**", ...fallos.slice(0, 20).map(f => `- ${f}`)] : []),
  ].join("\n");

  // La base hace falta para comparar con CG; en depuración, si no hay acceso, solo se omite la comparación.
  let sb: Base | null = null, comparacion = "";
  try {
    sb = await entrarALaBase();
    comparacion = comparar(IMPO ? await fuenteCuadro(sb) : await fuenteCG(sb), porCarpeta, !SUBCARPETA);
  } catch (e) {
    if (!DEBUG) throw e;
    comparacion = `_No se pudo comparar con CG: ${e instanceof Error ? e.message : e}_`;
  }
  resumen += "\n" + comparacion + "\n";

  console.log("\n" + resumen + "\n");
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, resumen + "\n");

  writeFileSync(join(SALIDA, "ocs.csv"), csv([CAB_OCS, ...filasOcs]));
  writeFileSync(join(SALIDA, "archivos.csv"), csv([CAB_ARCHIVOS, ...filasArchivos]));
  writeFileSync(join(SALIDA, "fuera-de-oc.csv"), csv([["Ruta", "Archivo", "Parece", "Serie", "Enlace"],
    ...sueltos.map(a => [a.ruta, a.nombre, a.parece, a.serie, a.url])]));
  writeFileSync(join(SALIDA, "resumen.md"), resumen);
  console.log(`✓ Resultado en ${SALIDA} (ocs.csv, archivos.csv, fuera-de-oc.csv, comparacion-*.csv, resumen.md)`);

  if (DEBUG) return;

  if (!ocs.size) {
    console.error("✗ No se encontró ninguna carpeta de OC: no se toca la base ni la hoja.");
    process.exit(1);
  }
  await subirALaBase(sb!, filasOcs, porCarpeta, !SUBCARPETA && fallos.length === 0);

  const hoja = await publicarHoja({ filas: [CAB_OCS, ...filasOcs], nombre: NOMBRE_HOJA, carpetas: CARPETAS_HOJA, tipos: TIPOS_OCS });
  await asegurarPestana(hojas, hoja.id, "ARCHIVOS");
  await escribirPestana(hojas, hoja.id, "ARCHIVOS", [CAB_ARCHIVOS, ...filasArchivos], TIPOS_ARCHIVOS);
  console.log(`✓ Hoja: ${hoja.url}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\nHoja: ${hoja.url}\n`);
}

main().catch(e => {
  console.error("✗", explicarFallo(e));
  process.exit(1);
});
