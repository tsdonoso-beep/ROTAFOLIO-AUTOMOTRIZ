// Archivar en Drive (misma carpeta y orden que descargar-cpe.mts) con respaldo en disco antes de subir.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { google } from "googleapis";
import { normalizarClavePrivada, correoDeServicio, carpeta } from "../../../lib/drive/servidor.ts";
import { leerZip } from "../../../lib/sunat/zip.ts";
import { leerComprobanteXml, documentoPrincipal } from "../../../lib/sunat/cpe-xml.ts";
import { origenDe, periodoDe } from "../../../lib/sunat/cpe-importacion.ts";
import { RUC, CARPETA_DRIVE } from "./config.mts";
import { dormir, type Bitacora } from "./bitacora.mts";
import type { Confirmado } from "./guardar.mts";
import { crearSubidor } from "./cache-drive.mts";

export interface Archivo {
  nombre: string;
  datos: Buffer;
  tipo: string;
}

export const DIR_SALIDA = join(process.cwd(), "salida", "cpe");

export function tipoPorNombre(nombre: string): string {
  return /\.pdf$/i.test(nombre)
    ? "application/pdf"
    : /\.zip$/i.test(nombre)
      ? "application/zip"
      : /\.xml$/i.test(nombre)
        ? "application/xml"
        : "application/octet-stream";
}

function decodificar(buf: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return buf.toString("latin1");
  }
}

/** El o los XML de una descarga: sueltos o dentro de un ZIP. */
export function xmlsDe(f: Archivo): string[] {
  if (/\.zip$/i.test(f.nombre) || f.datos.subarray(0, 2).toString("latin1") === "PK") {
    return leerZip(f.datos)
      .filter(a => /\.xml$/i.test(a.nombre))
      .map(a => decodificar(a.contenido));
  }
  if (/\.xml$/i.test(f.nombre)) return [decodificar(f.datos)];
  return [];
}

type Drive = ReturnType<typeof google.drive>;
let cliente: Drive | null = null;
export function drive(): Drive {
  if (cliente) return cliente;
  const email = correoDeServicio(process.env.GOOGLE_SA_EMAIL, process.env.GOOGLE_SA_PRIVATE_KEY);
  const key = normalizarClavePrivada(process.env.GOOGLE_SA_PRIVATE_KEY);
  if (!email || !key) {
    console.error("✗ Faltan GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY (o GOOGLE_SA_KEY_FILE).");
    process.exit(1);
  }
  cliente = google.drive({ version: "v3", auth: new google.auth.JWT({ email, key, scopes: ["https://www.googleapis.com/auth/drive"] }) });
  return cliente;
}

/** Reintenta lo que Google deja reintentar (cupo, 5xx, cortes de red). */
async function reintentable<T>(b: Bitacora, que: string, fn: () => Promise<T>, intentos = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (i >= intentos || !/rate limit|quota|429|500|502|503|ECONNRESET|ETIMEDOUT|socket hang up/i.test(m)) throw e;
      b.log("aviso", "drive", `${que}: reintento ${i}/${intentos} en ${5 * i}s: ${m.split("\n")[0]}`);
      await dormir(5000 * i);
    }
  }
}

/** Sube sin repetir: la carpeta se lista una vez (cache-drive.mts) y cada archivo cuesta una llamada. */
let subidor: ReturnType<typeof crearSubidor> | null = null;
function subir(carpetaId: string, f: Archivo) {
  subidor ??= crearSubidor(drive() as unknown as Parameters<typeof crearSubidor>[0]);
  return subidor(carpetaId, f);
}

const carpetas = new Map<string, Promise<string>>();
function carpetaDe(origen: "RECIBIDO" | "EMITIDO" | "OTRO", periodo: string | null): Promise<string> {
  const sub = origen === "RECIBIDO" ? "Recibidas" : origen === "EMITIDO" ? "Emitidas" : "Otros";
  const mes = periodo && /^\d{6}$/.test(periodo) ? `${periodo.slice(0, 4)}-${periodo.slice(4, 6)}` : "Sin fecha";
  const k = `${sub}/${mes}`;
  let pr = carpetas.get(k);
  if (!pr) {
    pr = (async () => carpeta(drive(), mes, await carpeta(drive(), sub, CARPETA_DRIVE)))();
    pr.catch(() => carpetas.delete(k));
    carpetas.set(k, pr);
  }
  return pr;
}

export const statsDrive = { nuevos: 0, existian: 0, fallidos: 0 };

/**
 * Respaldo en disco → leer XML → subir XML y PDF en paralelo. Devuelve lo que
 * hay que guardar en la base, o null si falló (queda en disco y en la bitácora).
 */
export async function archivar(
  b: Bitacora,
  etiqueta: string,
  periodo: string | null,
  xml: Archivo,
  pdf: Archivo | null,
): Promise<Confirmado | null> {
  const dirLocal = join(DIR_SALIDA, periodo ?? "sin-periodo");
  mkdirSync(dirLocal, { recursive: true });
  writeFileSync(join(dirLocal, xml.nombre), xml.datos);
  if (pdf) writeFileSync(join(dirLocal, pdf.nombre), pdf.datos);
  try {
    const doc = documentoPrincipal(xmlsDe(xml));
    if (!doc) throw new Error(`«${xml.nombre}» no trae el XML del comprobante (${xml.datos.length} bytes)`);
    const c = leerComprobanteXml(doc);
    if (!c.proveedorRuc || !c.serie || !c.numero)
      throw new Error(`«${xml.nombre}»: el XML no dice RUC/serie/número; no se guarda para no dejar una fila vacía`);
    const carpetaId = await reintentable(b, `carpeta ${etiqueta}`, () => carpetaDe(origenDe(c, RUC), periodoDe(c.fechaEmision)));
    const [rx, rp] = await Promise.all([
      reintentable(b, `xml ${etiqueta}`, () => subir(carpetaId, xml)),
      pdf ? reintentable(b, `pdf ${etiqueta}`, () => subir(carpetaId, pdf)) : Promise.resolve(null),
    ]);
    for (const r of [rx, rp])
      if (r) {
        if (r.estado === "nuevo") statsDrive.nuevos++;
        else statsDrive.existian++;
      }
    return { c, xmlUrl: rx.url, pdfUrl: rp?.url ?? null };
  } catch (e) {
    statsDrive.fallidos++;
    b.log("error", "drive", `${etiqueta}: no se pudo archivar: ${e instanceof Error ? e.message : e} (quedó en ${dirLocal})`);
    b.jsonl("subidas-fallidas.jsonl", { etiqueta, archivo: xml.nombre, error: String(e) });
    return null;
  }
}
