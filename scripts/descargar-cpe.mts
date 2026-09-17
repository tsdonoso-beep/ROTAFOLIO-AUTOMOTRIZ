// Bajar los comprobantes (XML y PDF) del portal de SUNAT y archivarlos en Drive
//
// El detalle de ítems no lo da ninguna API: sale del XML, y al XML solo se
// llega por la pantalla «Consultar Factura y Nota» de SOL, que tiene login.
// Por eso esto maneja un navegador de verdad (Playwright), no peticiones
// sueltas. Corre en GitHub Actions —Apps Script no puede manejar un navegador
// y Vercel corta al minuto— y reusa los secretos que ya están: el usuario y la
// clave de SOL son los mismos del SIRE.
//
// Qué hace: entra, va a la consulta, y fila por fila baja el XML y el PDF de
// cada comprobante y los sube a la carpeta de Drive del proyecto. Con el XML
// además arma el detalle de ítems y, si hay credenciales de la base, lo guarda
// con `guardar_cpe` para que la hoja se llene sola.
//
// DOS FASES:
//   • Depuración (DEBUG=1, por omisión mientras afinamos): entra, llega a la
//     pantalla y sube capturas y HTML de cada paso como artefacto. No baja
//     nada. Sirve para ver el portal real y fijar los selectores marcados
//     «AFINAR» sin que la clave pase por otras manos.
//   • Descarga (DEBUG=0): baja XML+PDF, los archiva en Drive y guarda el
//     detalle.

import { chromium, type Page, type Download } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";
import { normalizarClavePrivada, correoDeServicio } from "../lib/drive/servidor.ts";
import { leerComprobanteXml } from "../lib/sunat/cpe-xml.ts";
import { prepararLote } from "../lib/sunat/cpe-importacion.ts";

// ── Configuración desde el entorno ────────────────────────────────

function pedir(...nombres: string[]): string {
  for (const n of nombres) { const v = (process.env[n] ?? "").trim(); if (v) return v; }
  console.error(`✗ Falta ${nombres.join(" o ")} en el entorno.`);
  process.exit(1);
}

const RUC       = process.env.SUNAT_RUC?.trim() || "20512201611";
const USUARIO   = pedir("SUNAT_INROPRIN_USUARIO");     // el secundario de SOL, ej. APISIREE
const CLAVE     = pedir("SUNAT_INROPRIN_CLAVE");
const CLIENT_ID = pedir("SUNAT_INROPRIN_CLIENT_ID");   // el mismo del SIRE

// El usuario del portal es el secundario solo, sin el RUC pegado adelante.
const USUARIO_SOL = USUARIO.startsWith(RUC) ? USUARIO.slice(RUC.length) : USUARIO;

const DEBUG = process.env.DEBUG !== "0";
const TIPO_CONSULTA = process.env.TIPO_CONSULTA?.trim() || "FE Recibidas";

// La carpeta de Drive del proyecto donde se archivan los comprobantes.
const CARPETA_DRIVE = process.env.SUNAT_DRIVE_FOLDER?.trim() || "1RnyGimYdnhbQ3nKxGOoBc_iRz38fxCnX";

// La página de login de SOL, tal como la sirve el portal: lleva el client_id.
const LOGIN_URL = process.env.SOL_LOGIN_URL?.trim()
  || `https://api-seguridad.sunat.gob.pe/v1/clientessol/${CLIENT_ID}/oauth2/loginMenuSol?lang=es-PE&showDni=true`;

function ddmmyyyy(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}
const HOY = new Date();
const FECHA_FIN = process.env.FECHA_FIN?.trim() || ddmmyyyy(HOY);
const FECHA_INICIO = process.env.FECHA_INICIO?.trim()
  || ddmmyyyy(new Date(HOY.getTime() - 30 * 24 * 3600 * 1000));

const CAPTURAS = join(process.cwd(), "capturas");
mkdirSync(CAPTURAS, { recursive: true });

let paso = 0;
async function evidencia(page: Page, nombre: string) {
  paso++;
  const base = join(CAPTURAS, `${String(paso).padStart(2, "0")}-${nombre}`);
  try {
    await page.screenshot({ path: `${base}.png`, fullPage: true });
    writeFileSync(`${base}.html`, await page.content());
    console.log(`  · evidencia: ${nombre}`);
  } catch (e) {
    console.log(`  · no se pudo capturar ${nombre}: ${e instanceof Error ? e.message : e}`);
  }
}

// ── Login ─────────────────────────────────────────────────────────

/**
 * Entra a SOL con RUC, usuario secundario y clave.
 *
 * El formulario tiene una pestaña RUC/DNI; RUC ya viene elegida. Los ids son
 * los que sirve el portal (confirmados con la captura del login real). Si
 * cambian, la evidencia de depuración lo muestra.
 */
async function entrar(page: Page) {
  console.log(`Entrando a SOL como ${RUC} / ${USUARIO_SOL}…`);
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await evidencia(page, "login");

  await page.fill("#txtRuc", RUC);
  await page.fill("#txtUsuario", USUARIO_SOL);
  await page.fill("#txtContrasena", CLAVE);
  await evidencia(page, "login-lleno");

  // El botón dice «Iniciar sesión»; históricamente su id es btnAceptar. Se
  // prueba por id y, si no, por texto.
  const boton = (await page.$("#btnAceptar")) ? "#btnAceptar" : "text=Iniciar sesión";
  await Promise.all([
    page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {}),
    page.click(boton),
  ]);
  await evidencia(page, "post-login");

  const cuerpo = (await page.content()).toLowerCase();
  if (/captcha|recaptcha|código de verificación|verification code/.test(cuerpo)) {
    throw new Error("El login mostró un captcha/verificación. Revisa la captura 'post-login'.");
  }
  if (/usuario o clave|clave incorrecta|no coinciden/.test(cuerpo)) {
    throw new Error("SOL rechazó las credenciales. Revisa 'post-login'.");
  }
}

// ── Navegar a la consulta y bajar ─────────────────────────────────

/**
 * Llega a «Consultar Factura y Nota», pide el rango y devuelve las descargas.
 *
 * AFINAR: el menú de SOL vive en iframes y se arma con JavaScript; la ruta
 * exacta —Empresas → Comprobantes de pago → SEE-SOL → Factura Electrónica →
 * Consultar Factura y Nota— y los selectores de la tabla se fijan con la
 * evidencia del primer run de depuración. La descarga es fila por fila: el
 * enlace «Descargar Factura (XML)» y el «Descargar PDF» de cada comprobante.
 */
async function consultarYBajar(page: Page): Promise<Array<{ nombre: string; datos: Buffer; tipo: string }>> {
  console.log("Navegando a Consultar Factura y Nota…");
  await evidencia(page, "menu-inicio");

  if (DEBUG) return [];

  const salida: Array<{ nombre: string; datos: Buffer; tipo: string }> = [];

  // AFINAR ↓↓↓ — se completa con la evidencia del run de depuración.
  //   1. Entrar al menú Comprobantes de pago → ... → Consultar Factura y Nota
  //      (ubicar y cambiar al iframe correcto con page.frameLocator).
  //   2. Llenar Fecha Inicio/Fin, elegir el Tipo de Consulta, clic Aceptar.
  //   3. Recorrer las filas y, por cada una, capturar las dos descargas:
  //
  //   const marco = page.frameLocator("iframe#... ");
  //   await marco.locator("#fechaInicio").fill(FECHA_INICIO);
  //   await marco.locator("#fechaFin").fill(FECHA_FIN);
  //   ... elegir TIPO_CONSULTA ... clic Aceptar ...
  //   const filas = marco.locator("tabla filas");
  //   for (const fila of await filas.all()) {
  //     salida.push(await bajar(page, () => fila.locator("a:has-text('XML')").click()));
  //     salida.push(await bajar(page, () => fila.locator("a:has-text('PDF')").click()));
  //   }
  // AFINAR ↑↑↑

  console.log(`(pendiente de fijar selectores; rango ${FECHA_INICIO}–${FECHA_FIN}, ${TIPO_CONSULTA})`);
  return salida;
}

/** Dispara una descarga y la devuelve como buffer con su nombre. */
// Se usa desde consultarYBajar una vez fijados los selectores (bloque AFINAR).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function bajar(page: Page, accion: () => Promise<void>): Promise<{ nombre: string; datos: Buffer; tipo: string }> {
  const [descarga] = await Promise.all([
    page.waitForEvent("download", { timeout: 60000 }) as Promise<Download>,
    accion(),
  ]);
  const stream = await descarga.createReadStream();
  const trozos: Buffer[] = [];
  for await (const t of stream) trozos.push(t as Buffer);
  const nombre = descarga.suggestedFilename();
  const tipo = /\.pdf$/i.test(nombre) ? "application/pdf"
    : /\.xml$/i.test(nombre) ? "application/xml" : "application/octet-stream";
  return { nombre, datos: Buffer.concat(trozos), tipo };
}

// ── Archivar en Drive ─────────────────────────────────────────────

function clienteDrive() {
  const email = correoDeServicio(process.env.GOOGLE_SA_EMAIL, process.env.GOOGLE_SA_PRIVATE_KEY);
  const key = normalizarClavePrivada(process.env.GOOGLE_SA_PRIVATE_KEY);
  if (!email || !key) { console.error("✗ Faltan GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY."); process.exit(1); }
  const auth = new google.auth.JWT({ email, key, scopes: ["https://www.googleapis.com/auth/drive"] });
  return google.drive({ version: "v3", auth });
}

/**
 * Sube un archivo a la carpeta, sin repetir el que ya está.
 *
 * `supportsAllDrives` porque la carpeta puede vivir en una unidad compartida,
 * que la API ignora sin ese parámetro. La carpeta tiene que estar compartida
 * con el correo de la cuenta de servicio como Editor.
 */
async function subirADrive(drive: ReturnType<typeof clienteDrive>, f: { nombre: string; datos: Buffer; tipo: string }): Promise<"nuevo" | "existe"> {
  const q = `name = '${f.nombre.replace(/'/g, "\\'")}' and '${CARPETA_DRIVE}' in parents and trashed = false`;
  const ya = await drive.files.list({ q, fields: "files(id)", supportsAllDrives: true, includeItemsFromAllDrives: true });
  if (ya.data.files && ya.data.files.length > 0) return "existe";

  await drive.files.create({
    requestBody: { name: f.nombre, parents: [CARPETA_DRIVE] },
    media: { mimeType: f.tipo, body: Readable.from(f.datos) },
    fields: "id",
    supportsAllDrives: true,
  });
  return "nuevo";
}

// ── Guardar el detalle (opcional, si hay base) ────────────────────

async function guardarDetalle(xmls: string[]) {
  const url = process.env.SUPABASE_URL || process.env.PROJECT_URL;
  if (!url || xmls.length === 0) return;
  const lote = prepararLote(xmls.map(leerComprobanteXml), RUC);
  if (lote.length === 0) return;

  const sb = createClient(url, pedir("SUPABASE_ANON_KEY", "ANON_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: eLogin } = await sb.auth.signInWithPassword({
    email: pedir("ROBOT_CORREO"), password: pedir("ROBOT_CLAVE"),
  });
  if (eLogin) { console.error("⚠ No se guardó el detalle (login):", eLogin.message); return; }
  const { data, error } = await sb.rpc("guardar_cpe", { p_empresa_ruc: RUC, p_docs: lote });
  if (error) { console.error("⚠ No se guardó el detalle:", error.message); return; }
  const r = (Array.isArray(data) ? data[0] : data) as { nuevos: number; actualizados: number; items: number };
  console.log(`Detalle guardado: ${r?.nuevos} nuevos, ${r?.actualizados} actualizados, ${r?.items} ítems.`);
}

function decodificar(buf: Buffer): string {
  const cabeza = buf.subarray(0, 120).toString("latin1").toLowerCase();
  const enc = /encoding=["']([^"']+)["']/.exec(cabeza)?.[1] ?? "utf-8";
  return buf.toString(/8859-1|latin1|windows-1252/.test(enc) ? "latin1" : "utf8");
}

// ── Principal ─────────────────────────────────────────────────────

const navegador = await chromium.launch({ headless: true });
const contexto = await navegador.newContext({ acceptDownloads: true });
const page = await contexto.newPage();

try {
  await entrar(page);
  const archivos = await consultarYBajar(page);

  if (DEBUG) {
    console.log("\nModo depuración: no se bajó nada. Revisa el artefacto 'capturas/'.");
  } else if (archivos.length === 0) {
    console.log("No se bajó ningún archivo en el rango.");
  } else {
    const drive = clienteDrive();
    let nuevos = 0, existentes = 0;
    for (const f of archivos) {
      if ((await subirADrive(drive, f)) === "nuevo") nuevos++; else existentes++;
    }
    console.log(`Archivados en Drive: ${nuevos} nuevos, ${existentes} ya estaban.`);

    const xmls = archivos.filter(f => /\.xml$/i.test(f.nombre)).map(f => decodificar(f.datos));
    await guardarDetalle(xmls);
  }
} catch (e) {
  await evidencia(page, "error");
  console.error("✗", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await navegador.close();
}
