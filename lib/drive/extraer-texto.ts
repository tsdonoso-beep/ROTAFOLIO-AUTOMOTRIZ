/**
 * Sacar el texto de un archivo bajado de Drive, en la máquina que corre el
 * script (GitHub Actions): nada sale a otro servicio.
 *
 *   · PDF con texto (la mayoría de facturas electrónicas impresas desde el
 *     sistema del proveedor): `pdftotext`, al instante y sin errores de OCR.
 *   · PDF escaneado (sin texto adentro) e imágenes: OCR con `tesseract`
 *     (español e inglés), después de pasar el PDF a imagen con `pdftoppm`.
 *   · XML y ZIP: se leen como texto / se descomprimen (lo hace quien llama).
 *
 * Necesita poppler-utils y tesseract-ocr (+ spa, eng) instalados; el
 * workflow los instala. `herramientasDeLectura()` dice si están.
 */

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Páginas que se miran: el comprobante va al principio; un PDF unido puede traer la OC primero. */
const PAGINAS_TEXTO = 10;
const PAGINAS_OCR = 3;
/** Por debajo de esto (letras y números), el PDF no tiene texto adentro: es un escaneo. */
const MINIMO_DE_TEXTO = 80;

/**
 * Dónde está cada programa. En GitHub y en Linux, en el PATH. En Windows
 * suelen quedar fuera: LECTOR_POPPLER es la carpeta «bin» de Poppler y
 * LECTOR_TESSERACT la ruta de tesseract.exe (ver docs/carpetas-oc-local.md).
 */
function ruta(programa: "pdftotext" | "pdftoppm" | "tesseract"): string {
  if (programa === "tesseract") return process.env.LECTOR_TESSERACT?.trim() || "tesseract";
  const carpeta = process.env.LECTOR_POPPLER?.trim();
  return carpeta ? join(carpeta, programa) : programa;
}

function correr(nombre: "pdftotext" | "pdftoppm" | "tesseract", args: string[], tiempo = 120_000): Promise<string> {
  const programa = ruta(nombre);
  return new Promise((resolver, rechazar) => {
    // OMP_THREAD_LIMIT=1: tesseract usa un hilo; el paralelo lo pone quien llama (varios archivos a la vez).
    execFile(programa, args, {
      timeout: tiempo, maxBuffer: 32 * 1024 * 1024, encoding: "utf8", env: { ...process.env, OMP_THREAD_LIMIT: "1" },
    }, (error, salida, errores) => {
      if (error) rechazar(new Error(`${programa}: ${(errores || error.message).toString().trim().slice(0, 200)}`));
      else resolver(salida);
    });
  });
}

export type Herramientas = { pdf: boolean; ocr: boolean };

/** Qué se puede leer en esta máquina. */
export async function herramientasDeLectura(): Promise<Herramientas> {
  const hay = async (p: "pdftotext" | "pdftoppm" | "tesseract", a: string[]) => { try { await correr(p, a, 10_000); return true; } catch { return false; } };
  const [pdf, ppm, tess] = await Promise.all([hay("pdftotext", ["-v"]), hay("pdftoppm", ["-v"]), hay("tesseract", ["--version"])]);
  let idiomas = "";
  if (tess) { try { idiomas = await correr("tesseract", ["--list-langs"], 10_000); } catch { /* sin idiomas */ } }
  return { pdf, ocr: tess && ppm && /\bspa\b/.test(idiomas) };
}

const letras = (t: string) => t.replace(/[^A-Za-z0-9]/g, "").length;

async function enCarpetaTemporal<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "lectura-"));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

async function ocrDeImagenes(dir: string, imagenes: string[]): Promise<string> {
  const partes: string[] = [];
  for (const img of imagenes) partes.push(await correr("tesseract", [join(dir, img), "stdout", "-l", "spa+eng"], 120_000));
  return partes.join("\n");
}

/**
 * El texto de un PDF: el que trae adentro o, si es un escaneo, el del OCR.
 * Devuelve también cómo se obtuvo.
 */
export async function textoDePdf(datos: Buffer, h: Herramientas): Promise<{ texto: string; metodo: "TEXTO DEL PDF" | "OCR" }> {
  return enCarpetaTemporal(async dir => {
    const pdf = join(dir, "a.pdf");
    await writeFile(pdf, datos);
    let texto = "";
    if (h.pdf) {
      try { texto = await correr("pdftotext", ["-l", String(PAGINAS_TEXTO), "-enc", "UTF-8", pdf, "-"], 60_000); }
      catch { texto = ""; } // PDF protegido o dañado: se intenta por OCR
    }
    if (letras(texto) >= MINIMO_DE_TEXTO || !h.ocr) return { texto, metodo: "TEXTO DEL PDF" };
    await correr("pdftoppm", ["-r", "300", "-l", String(PAGINAS_OCR), "-gray", "-png", pdf, join(dir, "p")], 180_000);
    const imagenes = (await readdir(dir)).filter(f => /^p.*\.png$/.test(f)).sort();
    return { texto: await ocrDeImagenes(dir, imagenes), metodo: "OCR" };
  });
}

/** El texto de una imagen (foto o captura de la factura), por OCR. */
export async function textoDeImagen(datos: Buffer, extension: string): Promise<string> {
  return enCarpetaTemporal(async dir => {
    const nombre = `a.${extension.replace(/[^a-z0-9]/gi, "") || "png"}`;
    await writeFile(join(dir, nombre), datos);
    return ocrDeImagenes(dir, [nombre]);
  });
}
