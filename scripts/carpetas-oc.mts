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
  carpetaDeOC, clasificarArchivo, esComprobante, rucsEnNombre, type CarpetaDeOC,
} from "../lib/drive/carpetas-oc.ts";

// ── Configuración desde el entorno ────────────────────────────────

function pedir(...nombres: string[]): string {
  for (const n of nombres) { const v = (process.env[n] ?? "").trim(); if (v) return v; }
  console.error(`✗ Falta ${nombres.join(" o ")} en el entorno.`);
  process.exit(1);
}

const DEBUG = process.env.DEBUG !== "0";
const CARPETA_MADRE = process.env.CARPETA_MADRE?.trim() || "1oGUtE0IhqwanRsmuuA7QlQRB_koZzOH3";
// Parte del nombre de una carpeta de proyecto («TALLERES»): recorre solo esa.
const SUBCARPETA = process.env.SUBCARPETA?.trim() ?? "";
const EMPRESA_RUC = process.env.EMPRESA_RUC?.trim() || "20512201611";
const NOMBRE_HOJA = "OC - CARPETAS COMPRAS NACIONALES";
const CARPETAS_HOJA = ["SUNAT"];
// Cuántas carpetas se preguntan en una sola consulta a Drive, y cuántas consultas a la vez.
const CARPETAS_POR_CONSULTA = 25;
const PARALELO = Number(process.env.PARALELO?.trim() || "4");

const SALIDA = join(process.cwd(), "salida", "carpetas-oc");
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
  const leida = padre.oc ? carpetaDeOC(nombre, true) : carpetaDeOC(nombre);
  if (leida && (!padre.oc || leida.oc !== padre.oc.oc)) {
    const oc: OC = { ...leida, carpetaId: id, carpetaNombre: nombre, proyectoCarpeta };
    ocs.set(id, oc);
    return { id, ruta, proyectoCarpeta, oc, sub: "" };
  }
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
    for (let i = 0; i < cola.length; i += CARPETAS_POR_CONSULTA) grupos.push(cola.slice(i, i + CARPETAS_POR_CONSULTA));
    cola = [];
    // De a PARALELO grupos a la vez: rápido, sin pasar el cupo de Drive.
    for (let i = 0; i < grupos.length; i += PARALELO) {
      const tanda = grupos.slice(i, i + PARALELO);
      const res = await Promise.allSettled(tanda.map(g => leerGrupo(drive, g)));
      res.forEach((x, k) => {
        if (x.status === "fulfilled") cola.push(...x.value);
        else {
          const motivo = x.reason instanceof Error ? x.reason.message : String(x.reason);
          for (const p of tanda[k]) fallos.push(`${p.ruta.join(" / ") || "(carpeta madre)"}: ${motivo}`);
        }
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

// ── Subir a la base ─────────────────────────────────────────────────

async function subirALaBase(filasOcs: string[][], porCarpeta: Map<string, Archivo[]>, completo: boolean) {
  const url = pedir("SUPABASE_URL", "PROJECT_URL");
  const sb = createClient(url, pedir("SUPABASE_ANON_KEY", "ANON_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await sb.auth.signInWithPassword({ email: pedir("ROBOT_CORREO"), password: pedir("ROBOT_CLAVE") });
  if (error) throw new Error(`No se pudo entrar como el robot: ${error.message}`);

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
        p_empresa_ruc: EMPRESA_RUC, p_parte: parte, p_filas: filas.slice(i, i + 1000),
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

  const resumen = [
    `## Carpeta madre de compras nacionales${SUBCARPETA ? ` (solo «${SUBCARPETA}»)` : ""}`,
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

  console.log("\n" + resumen + "\n");
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, resumen + "\n");

  writeFileSync(join(SALIDA, "ocs.csv"), csv([CAB_OCS, ...filasOcs]));
  writeFileSync(join(SALIDA, "archivos.csv"), csv([CAB_ARCHIVOS, ...filasArchivos]));
  writeFileSync(join(SALIDA, "fuera-de-oc.csv"), csv([["Ruta", "Archivo", "Parece", "Serie", "Enlace"],
    ...sueltos.map(a => [a.ruta, a.nombre, a.parece, a.serie, a.url])]));
  writeFileSync(join(SALIDA, "resumen.md"), resumen);
  console.log(`✓ Resultado en ${SALIDA} (ocs.csv, archivos.csv, fuera-de-oc.csv, resumen.md)`);

  if (DEBUG) return;

  if (!ocs.size) {
    console.error("✗ No se encontró ninguna carpeta de OC: no se toca la base ni la hoja.");
    process.exit(1);
  }
  await subirALaBase(filasOcs, porCarpeta, !SUBCARPETA && fallos.length === 0);

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
