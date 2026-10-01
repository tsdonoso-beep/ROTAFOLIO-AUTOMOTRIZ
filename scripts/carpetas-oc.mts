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
// Cuando el nombre no alcanza («scan001.pdf», «WhatsApp Image…», «FACTURA
// LUCY.pdf» sin número, una «INVOICE»), el archivo se abre y se lee POR
// DENTRO: el XML o el ZIP del comprobante, el texto del PDF o, si es un
// escaneo o una foto, OCR (lib/drive/lectura.ts y extraer-texto.ts). Cada
// archivo se lee una sola vez: lo leído queda en la base (lectura_archivo) y
// la noche siguiente solo se leen los nuevos o los que cambiaron.
//
// Además arma el LEGAJO de cada OC (qué documentos tiene y cuál le falta,
// como la vista de LegajoPorOC.gs), le pone centro de costo (el de CG o el
// cuadro; si no está, el de su carpeta de proyecto) y, en las corridas
// completas, anota qué cambió desde la anterior: OC nuevas o que ya no
// están, archivos agregados, eliminados o modificados, OC que se completaron.
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
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  conectarDrive, publicarHoja, escribirPestana, explicarFallo, type Drive, type Hojas,
} from "../lib/drive/servidor.ts";
import type { TipoColumna } from "../lib/export/comprobantes-sunat.ts";
import {
  carpetaDeOC, clasificarArchivo, esComprobante, rucsEnNombre, type CarpetaDeOC, type Procedencia,
} from "../lib/drive/carpetas-oc.ts";
import {
  lecturaDeTexto, lecturaDeXml, prioridadDeLectura, tipoDeLectura, type Lectura,
} from "../lib/drive/lectura.ts";
import { herramientasDeLectura, textoDePdf, textoDeImagen, type Herramientas } from "../lib/drive/extraer-texto.ts";
import { leerZip } from "../lib/sunat/zip.ts";
import { Semaforo, procesarCola } from "../lib/drive/cola.ts";
// En la computadora (pnpm carpetas:local) la clave de la cuenta de servicio
// viene de un archivo (GOOGLE_SA_KEY_FILE en .env.local), como en cpe:local.
import { cargarClaveDeArchivo } from "./local/comun/config.mts";
import { clavesDeArchivo, type CentroDeCosto } from "../lib/drive/legajo-carpeta.ts";
import {
  analizarOCs, ccPrincipalPorOc, catalogoDeCG, type AnalisisOC, type ProyectoCC,
} from "../lib/drive/analisis-carpetas.ts";
import { compararFotos, type Cambio, type FotoArchivo, type FotoOC } from "../lib/drive/cambios-carpetas.ts";

// ── Configuración desde el entorno ────────────────────────────────

cargarClaveDeArchivo();

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
const PARALELO_DE_A_UNA = Number(process.env.PARALELO_DE_A_UNA?.trim() || "16");
const SIN_MEMBRESIA = /shared drive membership/i;
// La lectura por dentro: cuántos archivos como mucho, por cuántos minutos y
// cuántos a la vez. Lo que no alcance queda para la noche siguiente.
const LEER_MAX = Number(process.env.LEER_MAX?.trim() || (DEBUG ? "200" : "3000"));
const LEER_MINUTOS = Number(process.env.LEER_MINUTOS?.trim() || (DEBUG ? "15" : "45"));
// Dos topes distintos: descargas a la vez (espera de red, pueden ser muchas)
// y OCR a la vez (CPU: uno por núcleo; cada OCR es un proceso aparte).
// Mientras unos archivos se bajan, otros ya se están leyendo.
const DESCARGAS = Number(process.env.DESCARGAS?.trim() || "8");
const PROCESADORES = Number(process.env.PROCESADORES?.trim() || process.env.LECTORES?.trim() || String(Math.max(2, availableParallelism())));

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
  kb: number; modificado: string; modificadoIso: string; parece: string; serie: string; rucs: string[];
  pistas: string[];
  /** Lo que se leyó por dentro, si se abrió (ahora o en una corrida anterior). */
  lectura?: Lectura;
};

/** Si es un comprobante: por el nombre o por lo que se leyó adentro. */
const esComprobanteArch = (a: Archivo) => esComprobante(a.parece) || a.lectura?.estado === "LEÍDO";
/** La serie del comprobante: la del nombre o, si no, la leída por dentro. */
const serieDe = (a: Archivo) => a.serie || (a.lectura?.estado === "LEÍDO" ? a.lectura.serie : "");

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
        kb: Math.round(Number(f.size ?? 0) / 1024), modificado: fecha(f.modifiedTime), modificadoIso: f.modifiedTime ?? "",
        parece: c.parece, serie: c.serie, rucs: rucsEnNombre(nombre), pistas: c.pistas,
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
  let ultimoAviso = Date.now();
  // Una cola continua: apenas se lee una carpeta, sus subcarpetas entran a
  // la cola y cualquier trabajador libre las toma (no se espera a terminar
  // un «nivel» del árbol para empezar el siguiente).
  await procesarCola<Pendiente>({
    inicial: [raiz],
    trabajadores: () => carpetasPorConsulta === 1 ? PARALELO_DE_A_UNA : PARALELO,
    tomar: () => carpetasPorConsulta,
    fn: async lote => {
      const nuevas = await leerGrupo(drive, lote);
      if (Date.now() - ultimoAviso > 15000) {
        ultimoAviso = Date.now();
        console.log(`  … ${carpetasLeidas} carpetas leídas, ${ocs.size} OC, ${archivos.length} archivos`);
      }
      return nuevas;
    },
    alFallar: (lote, e) => {
      const motivo = e instanceof Error ? e.message : String(e);
      if (SIN_MEMBRESIA.test(motivo) && lote.length > 1) {
        // Se vuelven a leer de a una.
        if (carpetasPorConsulta > 1) console.log("⚠ Unidad compartida sin membresía: se lee una carpeta por consulta.");
        carpetasPorConsulta = 1;
        return lote;
      }
      for (const p of lote) fallos.push(`${p.ruta.join(" / ") || "(carpeta madre)"}: ${motivo}`);
    },
  });
}

// ── La lectura por dentro ─────────────────────────────────────────

/** Una fila de lectura_archivo: lo leído de un archivo, para no volver a leerlo. */
type FilaLectura = {
  archivo_id: string; modificado: string; estado: string; metodo: string; tipo: string; serie: string;
  ruc: string; claves: string; oc_referencia: string; detalle: string;
};

const deFila = (f: FilaLectura): Lectura => ({
  estado: f.estado as Lectura["estado"], metodo: (f.metodo ?? "") as Lectura["metodo"], tipo: f.tipo ?? "",
  serie: f.serie ?? "", ruc: f.ruc ?? "", claves: (f.claves ?? "").split(",").filter(Boolean),
  ocReferencia: f.oc_referencia ?? "", detalle: f.detalle ?? "",
});

const aFila = (a: Archivo, l: Lectura): FilaLectura => ({
  archivo_id: a.id, modificado: a.modificadoIso, estado: l.estado, metodo: l.metodo, tipo: l.tipo, serie: l.serie,
  ruc: l.ruc, claves: l.claves.join(","), oc_referencia: l.ocReferencia, detalle: l.detalle,
});

const lecturaConError = (detalle: string): Lectura =>
  ({ estado: "ERROR", metodo: "", tipo: "", serie: "", ruc: "", claves: [], ocReferencia: "", detalle: detalle.slice(0, 200) });

/** Cómo fue la lectura de esta corrida, para el resumen. */
const lectura = {
  candidatos: 0, deAntes: 0, noHaceFalta: 0, ahora: 0, quedan: 0, sinHerramientas: 0, guardadas: 0,
  porMetodo: new Map<string, number>(), avisos: [] as string[],
};

async function bajar(drive: Drive, a: Archivo): Promise<Buffer> {
  if (a.mime === "application/vnd.google-apps.document") {
    const r = await conReintentos("exportar documento", () =>
      drive.files.export({ fileId: a.id, mimeType: "text/plain" }, { responseType: "arraybuffer" }));
    return Buffer.from(r.data as ArrayBuffer);
  }
  const r = await conReintentos("bajar archivo", () =>
    drive.files.get({ fileId: a.id, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" }));
  return Buffer.from(r.data as ArrayBuffer);
}

/** Baja un archivo y lo lee según su tipo. Nunca lanza: un error queda como lectura con ERROR. */
const red = new Semaforo(DESCARGAS);
const cpu = new Semaforo(PROCESADORES);
const conCpu = <T,>(fn: () => Promise<T>) => cpu.usar(fn);
/** Para el OCR página por página: basta con que aparezca un comprobante con número. */
const yaBasta = (texto: string) => lecturaDeTexto(texto, "OCR").estado === "LEÍDO";

async function leerArchivo(drive: Drive, a: Archivo, h: Herramientas): Promise<Lectura> {
  const como = tipoDeLectura(a.nombre, a.mime);
  try {
    const datos = await red.usar(() => bajar(drive, a));
    if (como === "XML") return lecturaDeXml([datos.toString("utf8")], "XML");
    if (como === "ZIP") {
      const xmls = leerZip(datos, 64 * 1024 * 1024)
        .filter(x => /\.xml$/i.test(x.nombre)).map(x => x.contenido.toString("utf8"));
      if (!xmls.length) return { ...lecturaConError(""), estado: "SIN COMPROBANTE", metodo: "ZIP", detalle: "el ZIP no trae XML" };
      return lecturaDeXml(xmls, "ZIP");
    }
    let texto: string, metodo: Lectura["metodo"];
    if (como === "DOCUMENTO DE GOOGLE") { texto = datos.toString("utf8"); metodo = "DOCUMENTO DE GOOGLE"; }
    else if (como === "PDF") ({ texto, metodo } = await textoDePdf(datos, h, { limitarOcr: conCpu, basta: yaBasta }));
    else {
      const ext = /\.([a-z0-9]{2,5})$/i.exec(a.nombre)?.[1] ?? a.mime.split("/")[1] ?? "png";
      texto = await conCpu(() => textoDeImagen(datos, ext));
      metodo = "OCR";
    }
    const l = lecturaDeTexto(texto, metodo);
    // En depuración, el texto de lo que no se reconoció queda en el artefacto
    // (textos/), para ver por qué y mejorar la regla.
    if (DEBUG && l.estado !== "LEÍDO") {
      mkdirSync(join(SALIDA, "textos"), { recursive: true });
      writeFileSync(join(SALIDA, "textos", `${a.oc?.oc ?? "sin-oc"} ${a.nombre.replace(/[\/\\:*?"<>|]/g, "_").slice(0, 80)}.txt`),
        `${a.url}\n${metodo}\n\n${texto.slice(0, 4000)}`);
    }
    return l;
  } catch (e) {
    return lecturaConError(e instanceof Error ? e.message : String(e));
  }
}

/**
 * Abre los archivos que el nombre no explica (prioridadDeLectura) y lee qué
 * comprobante traen. Lo leído en corridas anteriores no se vuelve a leer
 * (salvo que el archivo haya cambiado, o que la vez anterior diera error).
 * Primero los más prometedores, y entre ellos los de OC que todavía no
 * tienen ningún comprobante con número.
 */
async function leerPorDentro(drive: Drive, sb: Base | null): Promise<void> {
  const h = await herramientasDeLectura();
  if (!h.pdf) lectura.avisos.push("falta pdftotext (poppler-utils): los PDF se leen solo por OCR");
  if (!h.ocr) lectura.avisos.push("falta tesseract con español: los escaneos y fotos no se leen");

  const anteriores = new Map<string, FilaLectura>();
  if (sb) {
    try {
      for (const f of await todas<FilaLectura>(sb, "lectura_archivo",
        "archivo_id,modificado,estado,metodo,tipo,serie,ruc,claves,oc_referencia,detalle", ["archivo_id"])) {
        anteriores.set(f.archivo_id, f);
      }
    } catch (e) {
      lectura.avisos.push(`no se pudo traer lo leído antes (${e instanceof Error ? e.message : e}): se lee todo de nuevo`);
    }
  }

  // Primero lo ya leído en corridas anteriores (sin cambios desde entonces).
  const candidatos: Array<{ a: Archivo; p: number }> = [];
  for (const a of archivos) {
    if (!a.oc) continue;
    const p = prioridadDeLectura(a);
    if (p < 0) continue;
    lectura.candidatos++;
    const antes = anteriores.get(a.id);
    if (antes && antes.modificado === a.modificadoIso && antes.estado !== "ERROR") {
      a.lectura = deFila(antes);
      lectura.deAntes++;
      continue;
    }
    candidatos.push({ a, p });
  }

  // Las OC que ya tienen un comprobante con número (por el nombre o leído).
  const ocConNumero = new Set(archivos.filter(a => a.oc && esComprobanteArch(a) && serieDe(a)).map(a => a.oc!.carpetaId));
  const pendientes: Array<{ a: Archivo; p: number; reintento: boolean }> = [];
  for (const { a, p } of candidatos) {
    // Un archivo que solo dice «OC» casi siempre es la propia OC: se abre
    // solo si la OC todavía no tiene ningún comprobante con número.
    if (p === 1 && ocConNumero.has(a.oc!.carpetaId)) { lectura.noHaceFalta++; continue; }
    const antes = anteriores.get(a.id);
    const como = tipoDeLectura(a.nombre, a.mime);
    if ((como === "PDF" && !h.pdf && !h.ocr) || (como === "IMAGEN" && !h.ocr)) { lectura.sinHerramientas++; continue; }
    pendientes.push({ a, p, reintento: antes?.estado === "ERROR" });
  }
  pendientes.sort((x, y) =>
    Number(x.reintento) - Number(y.reintento) || y.p - x.p ||
    Number(ocConNumero.has(x.a.oc!.carpetaId)) - Number(ocConNumero.has(y.a.oc!.carpetaId)) || x.a.kb - y.a.kb);

  const cola = pendientes.slice(0, LEER_MAX);
  const tope = Date.now() + LEER_MINUTOS * 60_000;
  const nuevas: FilaLectura[] = [];
  let siguiente = 0, guardando = false, ultimoAviso = Date.now();

  // En la corrida real, lo leído se guarda de a poco: si algo corta la
  // corrida, lo ya leído no se pierde.
  const guardar = async (todo: boolean) => {
    if (DEBUG || !sb || guardando) return;
    guardando = true;
    try {
      while (nuevas.length - lectura.guardadas >= (todo ? 1 : 50)) {
        const lote = nuevas.slice(lectura.guardadas, lectura.guardadas + 200);
        const { error } = await sb.rpc("guardar_lecturas_archivo", { p_filas: lote });
        if (error) { lectura.avisos.push(`no se pudo guardar lo leído: ${error.message}`); return; }
        lectura.guardadas += lote.length;
      }
    } finally { guardando = false; }
  };

  const trabajador = async () => {
    while (siguiente < cola.length && Date.now() < tope) {
      const { a, p } = cola[siguiente++];
      // Los que solo dicen «OC» van al final: si para entonces la OC ya tiene
      // su comprobante leído, no hace falta abrirlos.
      if (p === 1 && archivos.some(x => x.oc?.carpetaId === a.oc!.carpetaId && x.lectura?.estado === "LEÍDO")) {
        lectura.noHaceFalta++;
        continue;
      }
      const l = await leerArchivo(drive, a, h);
      a.lectura = l;
      lectura.ahora++;
      const clave = l.estado === "ERROR" ? "error" : l.metodo || "sin método";
      lectura.porMetodo.set(clave, (lectura.porMetodo.get(clave) ?? 0) + 1);
      nuevas.push(aFila(a, l));
      if (Date.now() - ultimoAviso > 15000) {
        ultimoAviso = Date.now();
        console.log(`  … leídos por dentro ${lectura.ahora} de ${cola.length}`);
      }
      await guardar(false);
    }
  };
  if (cola.length) console.log(`▶ Lectura por dentro: ${cola.length} archivos (de ${pendientes.length} pendientes), hasta ${DESCARGAS} descargas y ${PROCESADORES} OCR a la vez`);
  // Tantos trabajadores como descargas + OCR: siempre hay archivos bajando mientras otros se leen.
  await Promise.all(Array.from({ length: Math.max(1, DESCARGAS + PROCESADORES) }, trabajador));
  await guardar(true);
  lectura.quedan = Math.max(0, pendientes.length - siguiente);
}

// ── Las tablas ─────────────────────────────────────────────────────

const CAB_OCS = [
  "OC", "Tipo", "Proveedor (nombre de la carpeta)", "Proyecto (nombre de la carpeta)", "Carpeta del proyecto",
  "Archivos", "Comprobantes", "Series (nombre o lectura)", "RUC (nombre o lectura)", "XML",
  "Leídos por dentro", "Última modificación", "Carpeta de la OC", "Nombre de la carpeta", "Misma OC en otra carpeta",
  "Estado del legajo", "Le falta", "Documentos", "Centro de costo", "Código CC", "Centro de costo según",
];
const TIPOS_OCS: TipoColumna[] = [
  "texto", "texto", "texto", "texto", "texto", "numero", "numero", "texto", "texto", "numero",
  "numero", "fecha", "texto", "texto", "texto",
  "texto", "texto", "texto", "texto", "texto", "texto",
];
const CAB_ARCHIVOS = [
  "OC", "Proveedor (nombre de la carpeta)", "Carpeta del proyecto", "Subcarpeta", "Archivo", "Parece",
  "Serie en el nombre", "RUC en el nombre", "Leído por dentro", "Tipo leído", "Serie leída", "RUC leído",
  "OC que cita", "Tamaño (KB)", "Modificado", "Enlace", "Carpeta de la OC",
];
const TIPOS_ARCHIVOS: TipoColumna[] = [
  "texto", "texto", "texto", "texto", "texto", "texto", "texto", "texto", "texto", "texto", "texto", "texto",
  "texto", "numero", "fecha", "texto", "texto",
];

/** «LEÍDO · OCR», «SIN COMPROBANTE · TEXTO DEL PDF», o vacío si no se abrió. */
const textoDeLectura = (l?: Lectura) => l ? [l.estado, l.metodo, l.detalle].filter(Boolean).join(" · ") : "";

const CAB_CC = [
  "Carpeta del proyecto", "OC", "OC en CG / cuadro", "Centro de costo", "Código CC", "Según", "Revisar", "Por qué",
];
const TIPOS_CC: TipoColumna[] = ["texto", "numero", "numero", "texto", "texto", "texto", "texto", "texto"];
const CAB_CAMBIOS = ["Fecha", "OC", "Cambio", "Detalle", "Enlace", "Carpeta de la OC"];
const TIPOS_CAMBIOS: TipoColumna[] = ["fecha", "texto", "texto", "texto", "texto", "texto"];

/** Cómo se lee la fuente del centro de costo en la hoja. */
const SEGUN: Record<string, string> = {
  CG: "Control de Gestión (la OC)", CUADRO: "Cuadro de aprobaciones (la OC)", MANUAL: "Corregido a mano",
  NOMBRE: "Nombre de la carpeta del proyecto", ADMINISTRATIVO: "Carpeta administrativa (área general)", "SIN ASIGNAR": "Sin asignar",
};

const urlCarpeta = (id: string) => `https://drive.google.com/drive/folders/${id}`;
const aFecha = (s: string) => s ? s.split("/").reverse().join("") : "";

function agruparPorCarpeta(): Map<string, Archivo[]> {
  const porCarpeta = new Map<string, Archivo[]>();
  for (const a of archivos) if (a.oc) {
    const l = porCarpeta.get(a.oc.carpetaId) ?? [];
    l.push(a);
    porCarpeta.set(a.oc.carpetaId, l);
  }
  return porCarpeta;
}

function tablas(porCarpeta: Map<string, Archivo[]>, analisis: Map<string, AnalisisOC>) {
  const carpetasPorOc = new Map<string, OC[]>();
  for (const o of ocs.values()) carpetasPorOc.set(o.oc, [...(carpetasPorOc.get(o.oc) ?? []), o]);

  const filasOcs = [...ocs.values()]
    .sort((a, b) => a.oc.slice(5).localeCompare(b.oc.slice(5)) || a.oc.localeCompare(b.oc) || a.carpetaNombre.localeCompare(b.carpetaNombre))
    .map(o => {
      const l = porCarpeta.get(o.carpetaId) ?? [];
      const series = [...new Set(l.map(serieDe).filter(Boolean))];
      const rucs = [...new Set(l.flatMap(a => [...a.rucs, a.lectura?.estado === "LEÍDO" ? a.lectura.ruc : ""]).filter(Boolean))];
      const ultima = l.map(a => a.modificado).filter(Boolean).sort((x, y) => aFecha(y).localeCompare(aFecha(x)))[0] ?? "";
      const otras = (carpetasPorOc.get(o.oc) ?? []).filter(x => x.carpetaId !== o.carpetaId);
      return [
        o.oc, o.tipo, o.proveedor, o.proyecto, o.proyectoCarpeta,
        String(l.length), String(l.filter(esComprobanteArch).length),
        series.join(" / "), rucs.join(" / "), String(l.filter(a => a.parece === "XML").length),
        String(l.filter(a => a.lectura?.estado === "LEÍDO").length),
        ultima, urlCarpeta(o.carpetaId), o.carpetaNombre,
        otras.map(x => `${x.proyectoCarpeta} / ${x.carpetaNombre}`).join(" | "),
        ...columnasDeLegajo(analisis.get(o.carpetaId)),
      ];
    });

  const filasArchivos = archivos
    .filter(a => a.oc)
    .sort((a, b) => a.oc!.oc.localeCompare(b.oc!.oc) || a.sub.localeCompare(b.sub) || a.nombre.localeCompare(b.nombre))
    .map(a => [
      a.oc!.oc, a.oc!.proveedor, a.oc!.proyectoCarpeta, a.sub, a.nombre, a.parece, a.serie, a.rucs.join(" / "),
      textoDeLectura(a.lectura), a.lectura?.tipo ?? "", a.lectura?.serie ?? "", a.lectura?.ruc ?? "",
      a.lectura?.ocReferencia ?? "", String(a.kb), a.modificado, a.url, urlCarpeta(a.oc!.carpetaId),
    ]);

  return { filasOcs, filasArchivos };
}

function columnasDeLegajo(a?: AnalisisOC): string[] {
  if (!a) return ["", "", "", "", "", ""];
  return [a.docs.estado, a.docs.leFalta.join(", "), a.documentos, a.cc.nombre, a.cc.codigo, SEGUN[a.cc.fuente] ?? a.cc.fuente];
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
// El tipo exacto de la consulta de Supabase cambia con cada filtro; aquí basta con que tenga eq/like/gte/order/range.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Consulta = any;

async function todas<T>(sb: Base, tabla: string, columnas: string, orden: string[], filtro: (q: Consulta) => Consulta = q => q): Promise<T[]> {
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
    if (esta) c.en++; else c.noEn++;
    const suyos = [...(f.enlaces.get(oc) ?? [])];
    let enlace: string;
    if (!suyos.length) { enlace = "sin enlace (o no se pudo abrir)"; c.sinEnlace++; }
    else if (suyos.some(id => ids.has(carpetaDeLaOC.get(id) ?? ""))) { enlace = "misma carpeta"; c.misma++; }
    else if (suyos.some(id => carpetaDeLaOC.has(id) || vistas.has(id))) { enlace = "otra carpeta de la madre"; c.otra++; }
    else { enlace = completo ? "fuera de la carpeta madre" : "fuera de lo leído"; c.fuera++; }

    const enMadre = carpetas.reduce((n, o) => n + (porCarpeta.get(o.carpetaId) ?? []).filter(esComprobanteArch).length, 0);
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

async function subirALaBase(sb: Base, porCarpeta: Map<string, Archivo[]>, analisis: Map<string, AnalisisOC>, completo: boolean) {
  const carpetas = [...ocs.values()].map(o => {
    const l = porCarpeta.get(o.carpetaId) ?? [];
    const a = analisis.get(o.carpetaId);
    return {
      ccCodigo: a?.cc.codigo ?? "", ccNombre: a?.cc.nombre ?? "", ccFuente: a?.cc.fuente ?? "",
      documentos: a?.documentos ?? "", leFalta: a?.docs.leFalta.join(", ") ?? "", estado: a?.docs.estado ?? "",
      oc: o.oc, tipo: o.tipo, proveedor: o.proveedor, proyecto: o.proyecto, proyectoCarpeta: o.proyectoCarpeta,
      archivos: l.length, comprobantes: l.filter(esComprobanteArch).length,
      series: [...new Set(l.map(serieDe).filter(Boolean))].join(" / "),
      rucs: [...new Set(l.flatMap(a => a.rucs))].join(" / "),
      carpetaUrl: urlCarpeta(o.carpetaId), carpetaNombre: o.carpetaNombre,
    };
  });
  const deArchivos = [...ocs.values()].flatMap(o => (porCarpeta.get(o.carpetaId) ?? []).map(a => {
    const l = a.lectura;
    return {
      oc: o.oc, proveedorRuc: a.rucs.join(" / "), proveedor: o.proveedor, carpetaUrl: urlCarpeta(o.carpetaId),
      nombre: a.nombre, url: a.url, tipoArchivo: a.mime, serie: a.serie,
      // Si el nombre no decía que era un comprobante y la lectura sí lo encontró, manda la lectura.
      parece: l?.estado === "LEÍDO" && !esComprobante(a.parece) ? l.tipo : a.parece,
      estadoLectura: l?.estado ?? "", rucLeido: l?.ruc ?? "", serieLeida: l?.estado === "LEÍDO" ? l.serie : "",
      modificado: a.modificadoIso,
    };
  }));

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

// ── El legajo de cada OC: documentos y centro de costo ─────────────

/**
 * Lo que la base sabe del centro de costo: el de cada OC (CG para las
 * nacionales; el cuadro de aprobaciones, vía el legajo, para las
 * importaciones), el catálogo de CG y lo que Contabilidad corrigió a mano.
 */
async function datosDeCentroDeCosto(sb: Base) {
  const cg = await todas<{ oc: string; cc_codigo: string | null; cc_nombre: string | null; lineas: number | null }>(
    sb, "oc_base_cg", "oc,cc_codigo,cc_nombre,lineas", ["oc", "cc_codigo", "cc_nombre"], q => q.eq("empresa_ruc", EMPRESA_RUC));
  let ccPorOc = ccPrincipalPorOc(cg);
  if (IMPO) {
    const leg = await todas<{ oc: string; cc_codigo: string | null; cc_nombre: string | null }>(
      sb, "oc_legajo", "oc,cc_codigo,cc_nombre", ["oc", "carpeta_url"],
      q => q.eq("empresa_ruc", EMPRESA_RUC).eq("procedencia", "Importación"));
    ccPorOc = new Map();
    for (const l of leg) if (l.cc_nombre && !ccPorOc.has(l.oc)) ccPorOc.set(l.oc, { codigo: l.cc_codigo ?? "", nombre: l.cc_nombre });
  }
  const manuales = await todas<{ proyecto_carpeta: string; cc_codigo: string | null; cc_nombre: string | null }>(
    sb, "proyecto_centro_costo", "proyecto_carpeta,cc_codigo,cc_nombre", ["proyecto_carpeta"],
    q => q.eq("empresa_ruc", EMPRESA_RUC).eq("procedencia", PROCEDENCIA).eq("fuente", "MANUAL"));
  const manual = new Map<string, CentroDeCosto>(
    manuales.filter(m => m.cc_nombre).map(m => [m.proyecto_carpeta.trim(), { codigo: m.cc_codigo ?? "", nombre: m.cc_nombre! }]));
  return { ccPorOc, catalogo: catalogoDeCG(cg), manual };
}

function analizar(porCarpeta: Map<string, Archivo[]>, datos: Awaited<ReturnType<typeof datosDeCentroDeCosto>> | null) {
  return analizarOCs({
    importacion: IMPO,
    ccPorOc: datos?.ccPorOc ?? new Map(), manual: datos?.manual ?? new Map(), catalogo: datos?.catalogo ?? [],
    ocs: [...ocs.values()].map(o => ({
      clave: o.carpetaId, oc: o.oc, tipo: o.tipo, proyectoCarpeta: o.proyectoCarpeta,
      archivos: (porCarpeta.get(o.carpetaId) ?? []).map(a => ({ claves: clavesDeArchivo(a.parece, a.lectura?.claves) })),
    })),
  });
}

function filasDeCentroDeCosto(proyectos: ProyectoCC[]): string[][] {
  return proyectos.map(p => [
    p.proyectoCarpeta, String(p.ocs), String(p.ocsEnCg), p.nombre, p.codigo,
    p.manual ? SEGUN.MANUAL : SEGUN[p.fuente] ?? p.fuente, p.revisar ? "Sí" : "", p.detalle,
  ]);
}

// ── Qué cambió desde la corrida anterior ──────────────────────────

/** La foto que dejó en la base la corrida anterior de esta carpeta madre. */
async function fotoAnterior(sb: Base): Promise<{ ocs: FotoOC[]; archivos: FotoArchivo[] }> {
  const ocsAntes = await todas<{ oc: string; carpeta_url: string; carpeta_nombre: string | null; proveedor: string | null; le_falta: string | null; estado: string | null }>(
    sb, "oc_carpeta", "oc,carpeta_url,carpeta_nombre,proveedor,le_falta,estado", ["oc", "carpeta_url"],
    q => q.eq("empresa_ruc", EMPRESA_RUC).eq("procedencia", PROCEDENCIA));
  // La OC nacional tiene 4 dígitos y la de importación 3: así se separan en oc_archivo.
  const archivosAntes = await todas<{ oc: string; carpeta_url: string | null; url: string; nombre: string; modificado: string | null }>(
    sb, "oc_archivo", "oc,carpeta_url,url,nombre,modificado", ["oc", "url"],
    q => q.eq("empresa_ruc", EMPRESA_RUC).eq("origen", "CARPETA").like("oc", IMPO ? "___-%" : "____-%"));
  return {
    ocs: ocsAntes.map(o => ({ oc: o.oc, carpetaUrl: o.carpeta_url, carpetaNombre: o.carpeta_nombre ?? "",
      proveedor: o.proveedor ?? "", leFalta: o.le_falta ?? "", estado: o.estado ?? "" })),
    archivos: archivosAntes.map(a => ({ oc: a.oc, carpetaUrl: a.carpeta_url ?? "", url: a.url, nombre: a.nombre, modificado: a.modificado ?? "" })),
  };
}

function fotoActual(porCarpeta: Map<string, Archivo[]>, analisis: Map<string, AnalisisOC>): { ocs: FotoOC[]; archivos: FotoArchivo[] } {
  const lista = [...ocs.values()];
  return {
    ocs: lista.map(o => {
      const a = analisis.get(o.carpetaId);
      return { oc: o.oc, carpetaUrl: urlCarpeta(o.carpetaId), carpetaNombre: o.carpetaNombre, proveedor: o.proveedor,
        leFalta: a?.docs.leFalta.join(", ") ?? "", estado: a?.docs.estado ?? "" };
    }),
    archivos: lista.flatMap(o => (porCarpeta.get(o.carpetaId) ?? []).map(a => ({
      oc: o.oc, carpetaUrl: urlCarpeta(o.carpetaId), url: a.url, nombre: a.nombre, modificado: a.modificadoIso,
    }))),
  };
}

// ── Publicar la hoja ────────────────────────────────────────────────

async function asegurarPestana(hojas: Hojas, id: string, nombre: string) {
  const meta = await hojas.spreadsheets.get({ spreadsheetId: id, fields: "sheets(properties(title))" });
  if ((meta.data.sheets ?? []).some(s => s.properties?.title === nombre)) return;
  await hojas.spreadsheets.batchUpdate({
    spreadsheetId: id, requestBody: { requests: [{ addSheet: { properties: { title: nombre } } }] },
  });
}

/** La parte del resumen sobre la lectura por dentro. */
function resumenDeLectura(deOc: Archivo[]): string {
  const leidos = deOc.filter(a => a.lectura);
  const conComprobante = leidos.filter(a => a.lectura!.estado === "LEÍDO");
  const nuevosPorLectura = conComprobante.filter(a => !esComprobante(a.parece));
  const cuenta = (f: (a: Archivo) => boolean) => leidos.filter(f).length;
  const ejemplos = conComprobante.slice(0, 15).map(a =>
    `| ${a.oc!.oc} | ${a.nombre.replace(/\|/g, "/")} | ${a.lectura!.tipo} | ${a.lectura!.serie} | ${a.lectura!.ruc} | ${a.lectura!.metodo} |`);
  return [
    "### Lectura por dentro",
    "",
    `- Archivos que el nombre no explica: **${lectura.candidatos}** (XML/ZIP sin serie, «factura» o «invoice» sin número, nombres genéricos, «OTRO»)`,
    `- Leídos en esta corrida: **${lectura.ahora}**; ya leídos antes: ${lectura.deAntes}; quedan para la próxima: ${Math.max(0, lectura.quedan)}` +
      (lectura.noHaceFalta ? `; no hace falta abrirlos (solo dicen «OC» y la OC ya tiene su comprobante): ${lectura.noHaceFalta}` : "") +
      (lectura.sinHerramientas ? `; sin herramienta para leerlos: ${lectura.sinHerramientas}` : ""),
    `- Cómo se leyeron (esta corrida): ${[...lectura.porMetodo.entries()].map(([m, n]) => `${m} ${n}`).join(", ") || "—"}`,
    `- Con comprobante y número: **${conComprobante.length}** (con RUC del emisor: ${cuenta(a => a.lectura!.estado === "LEÍDO" && !!a.lectura!.ruc)}); ` +
      `de ellos, **${nuevosPorLectura.length}** que por el nombre no parecían comprobante`,
    `- Sin comprobante: ${cuenta(a => a.lectura!.estado === "SIN COMPROBANTE")}; sin texto: ${cuenta(a => a.lectura!.estado === "SIN TEXTO")}; con error: ${cuenta(a => a.lectura!.estado === "ERROR")}`,
    ...(DEBUG ? ["- Depuración: lo leído **no** se guarda; la corrida real lo vuelve a leer y lo guarda."] :
      [`- Guardado en la base: ${lectura.guardadas}`]),
    ...lectura.avisos.map(a => `- ⚠ ${a}`),
    ...(ejemplos.length ? ["", "| OC | Archivo | Tipo | Serie | RUC | Cómo |", "|---|---|---|---|---|---|", ...ejemplos] : []),
    "",
    "El detalle de cada archivo leído está en `lecturas.csv`.",
  ].join("\n");
}

/** La parte del resumen sobre el legajo y el centro de costo de cada OC. */
function resumenDeLegajo(analisis: Map<string, AnalisisOC>, proyectos: ProyectoCC[], aviso: string): string {
  const lista = [...analisis.values()];
  const cuenta = (f: (a: AnalisisOC) => boolean) => lista.filter(f).length;
  const faltas = new Map<string, number>();
  for (const a of lista) for (const d of a.docs.leFalta) faltas.set(d, (faltas.get(d) ?? 0) + 1);
  const porFuente = new Map<string, number>();
  for (const a of lista) porFuente.set(a.cc.fuente, (porFuente.get(a.cc.fuente) ?? 0) + 1);
  return [
    "### Legajo de cada OC",
    "",
    `- Completas: **${cuenta(a => a.docs.estado === "OK")}**; incompletas: **${cuenta(a => a.docs.estado === "INCOMPLETA")}**; carpetas vacías: ${cuenta(a => a.docs.estado === "VACÍA")}`,
    `- Lo que más falta: ${[...faltas.entries()].sort((a, b) => b[1] - a[1]).map(([d, n]) => `${d} ${n}`).join(", ") || "—"}`,
    "",
    "### Centro de costo",
    "",
    `- Por OC: ${[...porFuente.entries()].sort((a, b) => b[1] - a[1]).map(([f, n]) => `${SEGUN[f] ?? f} ${n}`).join("; ")}`,
    `- OC **sin centro de costo en ${IMPO ? "el cuadro" : "CG"}** que ahora lo tienen por su carpeta: **${cuenta(a => !["CG", "CUADRO", "SIN ASIGNAR"].includes(a.cc.fuente))}**`,
    ...(aviso ? [`- ⚠ Sin datos de la base para el centro de costo (${aviso}): solo se asigna por el nombre de la carpeta`] : []),
    "",
    "| Carpeta del proyecto | OC | En " + (IMPO ? "cuadro" : "CG") + " | Centro de costo | Según | Revisar |",
    "|---|---:|---:|---|---|---|",
    ...proyectos.map(p => `| ${p.proyectoCarpeta} | ${p.ocs} | ${p.ocsEnCg} | ${p.nombre || "—"} | ${p.manual ? SEGUN.MANUAL : SEGUN[p.fuente]} | ${p.revisar ? "Sí" : ""} |`),
    "",
    "Detalle por carpeta en `centro-de-costo.csv` (y en la pestaña CENTRO DE COSTO de la hoja).",
  ].join("\n");
}

/** La parte del resumen sobre lo que cambió desde la corrida anterior. */
function resumenDeCambios(cambios: Cambio[], nota: string): string {
  if (nota) return `### Cambios desde la corrida anterior\n\n- ${nota}`;
  const porTipo = new Map<string, number>();
  for (const c of cambios) porTipo.set(c.tipo, (porTipo.get(c.tipo) ?? 0) + 1);
  return [
    "### Cambios desde la corrida anterior",
    "",
    cambios.length ? `- ${[...porTipo.entries()].map(([t, n]) => `${t}: **${n}**`).join("; ")}` : "- Sin cambios",
    ...cambios.slice(0, 25).map(c => `- ${c.oc} · ${c.tipo} · ${c.detalle.replace(/\|/g, "/")}`),
    ...(cambios.length > 25 ? [`- … y ${cambios.length - 25} más en \`cambios.csv\``] : []),
  ].join("\n");
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
  const finRecorrido = Date.now();

  // La base: para no releer lo ya leído, para comparar con CG y para subir.
  // En depuración es opcional (si no hay acceso, se lee todo y no se compara).
  let sb: Base | null = null, sinBase = "";
  try { sb = await entrarALaBase(); }
  catch (e) {
    if (!DEBUG) throw e;
    sinBase = e instanceof Error ? e.message : String(e);
  }

  await leerPorDentro(drive, sb);
  const porCarpeta = agruparPorCarpeta();

  // El legajo de cada OC y su centro de costo.
  let datosCC: Awaited<ReturnType<typeof datosDeCentroDeCosto>> | null = null, avisoCC = "";
  if (sb) {
    try { datosCC = await datosDeCentroDeCosto(sb); }
    catch (e) { if (!DEBUG) throw e; avisoCC = e instanceof Error ? e.message : String(e); }
  } else avisoCC = sinBase;
  const { porOc: analisis, proyectos } = analizar(porCarpeta, datosCC);
  const { filasOcs, filasArchivos } = tablas(porCarpeta, analisis);

  // Qué cambió: solo con dos fotos completas (si no, lo no visto parecería eliminado).
  const completo = !SUBCARPETA && fallos.length === 0;
  let cambios: Cambio[] = [], notaCambios = "";
  if (!completo) notaCambios = "corrida parcial (una subcarpeta o carpetas sin leer): no se comparan cambios";
  else if (!sb) notaCambios = "sin acceso a la base: no se comparan cambios";
  else {
    const antes = await fotoAnterior(sb);
    if (!antes.ocs.length) notaCambios = "primera carga: desde la próxima corrida se anota lo que cambie";
    else cambios = compararFotos(antes, fotoActual(porCarpeta, analisis));
  }

  // Lo que quedó fuera de una carpeta de OC: para ver si hay nombres que no se entienden.
  const sueltos = archivos.filter(a => !a.oc);
  const carpetasSinOc = new Map<string, number>();
  for (const a of sueltos) carpetasSinOc.set(a.ruta, (carpetasSinOc.get(a.ruta) ?? 0) + 1);

  const deOc = archivos.filter(a => a.oc);
  const comprobantes = deOc.filter(esComprobanteArch);
  const conSerie = deOc.filter(a => serieDe(a));
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
    if (esComprobanteArch(a)) p.comprobantes++;
  }
  const parece = new Map<string, number>();
  for (const a of deOc) parece.set(a.parece, (parece.get(a.parece) ?? 0) + 1);
  const gb = archivos.reduce((s, a) => s + a.kb, 0) / 1024 / 1024;

  let resumen = [
    `## Carpeta madre de ${IMPO ? "importaciones" : "compras nacionales"}${SUBCARPETA ? ` (solo «${SUBCARPETA}»)` : ""}`,
    "",
    `- Carpetas leídas: **${carpetasLeidas}** (${consultas} consultas a Drive, ${Math.round((finRecorrido - inicio) / 1000)} s)`,
    `- OC distintas: **${ocsUnicas.size}** en ${ocs.size} carpetas de OC (${[...ocs.values()].filter(o => o.tipo === "OS").length} de servicio)`,
    `- Archivos dentro de una OC: **${deOc.length}** (${gb.toFixed(1)} GB en total)`,
    `- Comprobantes (factura, boleta, RH, nota, XML; por nombre o leídos por dentro): **${comprobantes.length}**, con serie: **${conSerie.length}** (${deOc.filter(a => a.serie).length} por el nombre, ${deOc.filter(a => !a.serie && serieDe(a)).length} leídas por dentro)`,
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
    "",
    resumenDeLectura(deOc),
    "",
    resumenDeLegajo(analisis, proyectos, avisoCC),
    "",
    resumenDeCambios(cambios, notaCambios),
  ].join("\n");

  let comparacion = "";
  try {
    if (!sb) throw new Error(sinBase);
    comparacion = comparar(IMPO ? await fuenteCuadro(sb) : await fuenteCG(sb), porCarpeta, !SUBCARPETA);
  } catch (e) {
    if (!DEBUG) throw e;
    comparacion = `_No se pudo comparar con ${IMPO ? "el cuadro" : "CG"}: ${e instanceof Error ? e.message : e}_`;
  }
  resumen += "\n" + comparacion + "\n";

  console.log("\n" + resumen + "\n");
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, resumen + "\n");

  writeFileSync(join(SALIDA, "ocs.csv"), csv([CAB_OCS, ...filasOcs]));
  writeFileSync(join(SALIDA, "archivos.csv"), csv([CAB_ARCHIVOS, ...filasArchivos]));
  writeFileSync(join(SALIDA, "fuera-de-oc.csv"), csv([["Ruta", "Archivo", "Parece", "Serie", "Enlace"],
    ...sueltos.map(a => [a.ruta, a.nombre, a.parece, a.serie, a.url])]));
  writeFileSync(join(SALIDA, "lecturas.csv"), csv([
    ["OC", "Archivo", "Parece (nombre)", "Leído por dentro", "Tipo leído", "Serie leída", "RUC leído", "OC que cita", "Documentos adentro", "Enlace"],
    ...deOc.filter(a => a.lectura).map(a => [a.oc!.oc, a.nombre, a.parece, textoDeLectura(a.lectura), a.lectura!.tipo,
      a.lectura!.serie, a.lectura!.ruc, a.lectura!.ocReferencia, a.lectura!.claves.join(", "), a.url])]));
  writeFileSync(join(SALIDA, "centro-de-costo.csv"), csv([CAB_CC, ...filasDeCentroDeCosto(proyectos)]));
  writeFileSync(join(SALIDA, "cambios.csv"), csv([["OC", "Cambio", "Detalle", "Enlace", "Carpeta de la OC"],
    ...cambios.map(c => [c.oc, c.tipo, c.detalle, c.enlace, c.carpetaUrl])]));
  writeFileSync(join(SALIDA, "resumen.md"), resumen);
  console.log(`✓ Resultado en ${SALIDA} (ocs.csv, archivos.csv, lecturas.csv, centro-de-costo.csv, cambios.csv, fuera-de-oc.csv, comparacion-*.csv, resumen.md)`);

  if (DEBUG) return;

  if (!ocs.size) {
    console.error("✗ No se encontró ninguna carpeta de OC: no se toca la base ni la hoja.");
    process.exit(1);
  }
  await subirALaBase(sb!, porCarpeta, analisis, completo);

  // La regla de cada carpeta de proyecto (sin pisar lo corregido a mano).
  if (proyectos.length) {
    const { data, error } = await sb!.rpc("guardar_centro_costo_proyectos", {
      p_empresa_ruc: EMPRESA_RUC,
      p_filas: proyectos.filter(p => !p.manual).map(p => ({
        procedencia: PROCEDENCIA, proyectoCarpeta: p.proyectoCarpeta, ccCodigo: p.codigo, ccNombre: p.nombre,
        fuente: p.fuente, detalle: p.detalle, revisar: p.revisar, ocs: p.ocs, ocsEnCg: p.ocsEnCg,
      })),
    });
    if (error) throw new Error(`guardar_centro_costo_proyectos: ${error.message}`);
    console.log(`✓ Base: centro de costo de ${data} carpetas de proyecto`);
  }
  for (let i = 0; i < cambios.length; i += 500) {
    const { error } = await sb!.rpc("guardar_cambios_carpetas", {
      p_empresa_ruc: EMPRESA_RUC, p_procedencia: PROCEDENCIA, p_filas: cambios.slice(i, i + 500),
    });
    if (error) throw new Error(`guardar_cambios_carpetas: ${error.message}`);
  }
  if (cambios.length) console.log(`✓ Base: ${cambios.length} cambios anotados`);

  const hoja = await publicarHoja({ filas: [CAB_OCS, ...filasOcs], nombre: NOMBRE_HOJA, carpetas: CARPETAS_HOJA, tipos: TIPOS_OCS });
  await asegurarPestana(hojas, hoja.id, "ARCHIVOS");
  await escribirPestana(hojas, hoja.id, "ARCHIVOS", [CAB_ARCHIVOS, ...filasArchivos], TIPOS_ARCHIVOS);
  await asegurarPestana(hojas, hoja.id, "CENTRO DE COSTO");
  await escribirPestana(hojas, hoja.id, "CENTRO DE COSTO", [CAB_CC, ...filasDeCentroDeCosto(proyectos)], TIPOS_CC);
  // Los cambios de los últimos 60 días, del más nuevo al más viejo.
  const desde = new Date(Date.now() - 60 * 86400_000).toISOString();
  const ultimos = await todas<{ fecha: string; oc: string; tipo: string; detalle: string | null; enlace: string | null; carpeta_url: string | null; id: number }>(
    sb!, "carpeta_cambio", "id,fecha,oc,tipo,detalle,enlace,carpeta_url", ["id"],
    q => q.eq("empresa_ruc", EMPRESA_RUC).eq("procedencia", PROCEDENCIA).gte("fecha", desde));
  await asegurarPestana(hojas, hoja.id, "CAMBIOS");
  await escribirPestana(hojas, hoja.id, "CAMBIOS", [CAB_CAMBIOS, ...ultimos.reverse().map(c =>
    [fecha(c.fecha), c.oc, c.tipo, c.detalle ?? "", c.enlace ?? "", c.carpeta_url ?? ""])], TIPOS_CAMBIOS);
  console.log(`✓ Hoja: ${hoja.url}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\nHoja: ${hoja.url}\n`);
}

main().catch(e => {
  console.error("✗", explicarFallo(e));
  process.exit(1);
});
