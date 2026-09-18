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

import { chromium, type Page, type Frame, type Download } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";
import { normalizarClavePrivada, correoDeServicio, carpeta } from "../lib/drive/servidor.ts";
import { leerZip } from "../lib/sunat/zip.ts";
import { leerComprobanteXml, type ComprobanteCpe } from "../lib/sunat/cpe-xml.ts";
import { prepararLote, origenDe, periodoDe, identidad, type DocLote } from "../lib/sunat/cpe-importacion.ts";

// ── Configuración desde el entorno ────────────────────────────────

function pedir(...nombres: string[]): string {
  for (const n of nombres) { const v = (process.env[n] ?? "").trim(); if (v) return v; }
  console.error(`✗ Falta ${nombres.join(" o ")} en el entorno.`);
  process.exit(1);
}

const RUC       = process.env.SUNAT_RUC?.trim() || "20512201611";
const USUARIO   = pedir("SUNAT_INROPRIN_USUARIO");     // el secundario de SOL, ej. APISIREE
const CLAVE     = pedir("SUNAT_INROPRIN_CLAVE");

// El usuario del portal es el secundario solo, sin el RUC pegado adelante.
const USUARIO_SOL = USUARIO.startsWith(RUC) ? USUARIO.slice(RUC.length) : USUARIO;

const DEBUG = process.env.DEBUG !== "0";
const TIPO_CONSULTA = process.env.TIPO_CONSULTA?.trim() || "FE Recibidas";

// La carpeta de Drive del proyecto donde se archivan los comprobantes.
const CARPETA_DRIVE = process.env.SUNAT_DRIVE_FOLDER?.trim() || "1RnyGimYdnhbQ3nKxGOoBc_iRz38fxCnX";

// La entrada del menú de SOL. Sin sesión, rebota sola a la pantalla de login
// con el client_id y el redirect_uri correctos del menú —los del API SIRE no
// sirven para el login web: dejan el ?code= colgado sin volver al menú—.
const LOGIN_URL = process.env.SOL_LOGIN_URL?.trim()
  || "https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm";

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

/**
 * Navega con reintentos.
 *
 * e-menu.sunat.gob.pe corta la conexión (ERR_CONNECTION_RESET) a veces desde
 * IPs de datacenter; un par de reintentos con espera suele pasar. Si insiste,
 * es un bloqueo de verdad y hay que decirlo, no seguir como si nada.
 */
async function irConReintento(page: Page, url: string, intentos = 4) {
  let ultimo: unknown;
  for (let i = 1; i <= intentos; i++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      return;
    } catch (e) {
      ultimo = e;
      console.log(`  · intento ${i}/${intentos} falló: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
      await page.waitForTimeout(3000 * i);
    }
  }
  throw ultimo;
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
  await irConReintento(page, LOGIN_URL);
  // MenuInternet, sin sesión, rebota a la pantalla de login: se espera el
  // formulario en vez de asumir que ya está.
  await page.waitForSelector("#txtRuc", { timeout: 60000 });
  await evidencia(page, "login");

  await page.fill("#txtRuc", RUC);
  await page.fill("#txtUsuario", USUARIO_SOL);
  await page.fill("#txtContrasena", CLAVE);
  await evidencia(page, "login-lleno");

  // El botón dice «Iniciar sesión»; históricamente su id es btnAceptar. Se
  // prueba por id y, si no, por texto.
  const boton = (await page.$("#btnAceptar")) ? "#btnAceptar" : "text=Iniciar sesión";
  await page.click(boton);

  // Tras el login, SUNAT rebota por api-seguridad (?code=...) y recién
  // después aterriza en el menú (MenuInternet.htm). El primer run se quedó en
  // esa pantalla intermedia: hay que esperar a que la cadena termine, no al
  // primer «networkidle».
  await page.waitForURL(/MenuInternet\.htm/i, { timeout: 60000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  console.log(`  · tras login, URL: ${page.url()}`);
  await evidencia(page, "post-login");

  const cuerpo = (await page.content()).toLowerCase();
  if (/captcha|recaptcha|código de verificación|verification code/.test(cuerpo)) {
    throw new Error("El login mostró un captcha/verificación. Revisa la captura 'post-login'.");
  }
  if (/usuario o clave|clave incorrecta|no coinciden/.test(cuerpo)) {
    throw new Error("SOL rechazó las credenciales. Revisa 'post-login'.");
  }
  if (!/MenuInternet|e-menu\.sunat/i.test(page.url())) {
    throw new Error(`No se llegó al menú tras el login; quedó en ${page.url()}. Revisa 'post-login'.`);
  }
}

/**
 * Hace clic en un texto, sin importar en qué frame esté.
 *
 * El menú de SOL se dibuja dentro de un iframe; buscar el texto solo en el
 * documento principal no lo encuentra y el clic expira. Esto recorre todos los
 * frames —el principal incluido— hasta hallarlo.
 */
async function clicEnAlgunMarco(page: Page, texto: string, timeoutMs = 20000): Promise<boolean> {
  const fin = Date.now() + timeoutMs;
  while (Date.now() < fin) {
    for (const f of page.frames()) {
      try {
        const loc = f.locator(`text=${texto}`).first();
        if (await loc.count()) { await loc.click({ timeout: 5000 }); return true; }
      } catch { /* el marco puede estar navegando; se reintenta */ }
    }
    await page.waitForTimeout(500);
  }
  return false;
}

// ── Navegar a la consulta y bajar ─────────────────────────────────

// Los campos de texto de SUNAT no siempre traen type="text": muchos son
// <input> a secas, que `input[type="text"]` no captura. Se toma todo input que
// no sea de los tipos que claramente no son de texto.
const SEL_TEXTO = 'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="image"]):not([type="checkbox"]):not([type="radio"]):not([type="password"])';

/**
 * Encuentra el iframe donde vive el formulario de la consulta.
 *
 * El módulo (ol-ti-itconscpemype) se carga en un iframe del menú, pero el
 * formulario en sí vive en un iframe ANIDADO dentro de ese: el frame externo
 * matchea la URL pero no tiene campos. Por eso no basta con la URL —así se
 * eligió un frame vacío y salieron «0 comprobantes»—: se busca el frame que de
 * verdad tiene el `select` de tipo y los campos de fecha, y se espera a que
 * cargue.
 */
async function marcoConsulta(page: Page, intentos = 30): Promise<Frame> {
  let respaldo: Frame | null = null;
  let maxInputs = -1;
  for (let i = 0; i < intentos; i++) {
    for (const f of page.frames()) {
      try {
        // El formulario tiene el campo de fecha «fec_desde»: es la marca segura.
        if (await f.locator('input[name="fec_desde"]').count()) return f;
        const inputs = await f.locator(SEL_TEXTO).count();
        if (inputs > maxInputs) { maxInputs = inputs; respaldo = f; }
      } catch { /* el marco puede estar navegando */ }
    }
    await page.waitForTimeout(1000);
  }
  return respaldo ?? page.mainFrame();
}

/** Pone una fecha en el campo con ese `name`, abriéndolo si es de solo lectura. */
async function ponerFechaPorNombre(marco: Frame, nombre: string, valor: string) {
  const campo = marco.locator(`input[name="${nombre}"]`).first();
  await campo.evaluate((el, v) => {
    const i = el as HTMLInputElement;
    i.removeAttribute("readonly");
    i.value = v as string;
    i.dispatchEvent(new Event("input", { bubbles: true }));
    i.dispatchEvent(new Event("change", { bubbles: true }));
    i.dispatchEvent(new Event("blur", { bubbles: true }));
  }, valor).catch((e: unknown) => console.log(`  ⚠ no se pudo poner ${nombre}: ${e instanceof Error ? e.message.split("\n")[0] : e}`));
}

/**
 * Elige el Tipo de Consulta, que es un combobox (input visible + hidden), no
 * un <select>. Se hace como un humano: clic en el visible y clic en la opción.
 */
async function elegirTipo(marco: Frame, etiqueta: string) {
  const visible = marco.locator('[id="criterio.tipoConsulta"]').first();
  if (!(await visible.count())) { console.log("  ⚠ no encontré el campo de tipo"); return; }
  await visible.click().catch(() => {});
  await marco.page().waitForTimeout(800);
  const opcion = marco.locator(
    `li:has-text("${etiqueta}"), .ui-menu-item:has-text("${etiqueta}"), option:has-text("${etiqueta}"), a:has-text("${etiqueta}")`
  ).first();
  if (await opcion.count()) { await opcion.click().catch(() => {}); return; }
  // Respaldo: teclear el texto y Enter.
  await visible.fill(etiqueta).catch(() => {});
  await visible.press("Enter").catch(() => {});
}

/**
 * Clic en el botón «Aceptar» —el que muestra la tabla—, nunca en «Solicitud
 * de descarga masiva».
 *
 * Los dos son botones y el genérico `input[type=button]` caía en el de descarga
 * masiva, que dispara el flujo asíncrono por correo y deja la pantalla sin la
 * tabla de resultados. Por eso se busca «Aceptar» por su texto/atributos
 * exactos y se evita el genérico.
 */
async function clicAceptar(marco: Frame) {
  const intentos = [
    () => marco.locator('input[value="Aceptar"], input[value=" Aceptar "]'),
    () => marco.locator('img[alt="Aceptar"], img[title="Aceptar"], [title="Aceptar"]'),
    () => marco.getByText("Aceptar", { exact: true }),
    () => marco.locator('a:has-text("Aceptar")'),
  ];
  for (const get of intentos) {
    const loc = get().first();
    if (await loc.count()) { await loc.click({ timeout: 10000 }).catch(() => {}); return; }
  }
  console.log("  ⚠ no encontré el botón Aceptar");
}

/**
 * Llega a «Consultar Factura y Nota», pide el rango y devuelve las descargas.
 *
 * El menú «¿Qué necesitas hacer?» está en el documento principal; la consulta,
 * en un iframe. Las fechas se escriben directo (dd/mm/yyyy) en vez de pelear
 * con el calendario emergente. Aceptar trae la tabla, y de cada fila cuelgan
 * los enlaces «Descargar Factura (XML)» y «Descargar PDF».
 */
interface ArchivoBajado { nombre: string; datos: Buffer; tipo: string }
interface FilaBajada { xml: ArchivoBajado | null; pdf: ArchivoBajado | null }

async function consultarYBajar(page: Page): Promise<FilaBajada[]> {
  console.log("Menú → Empresas → Consulta de Facturas y Notas Electrónicas…");
  await evidencia(page, "menu-inicio");
  console.log(`  · frames: ${page.frames().map(f => f.url() || "(vacío)").join(" | ")}`);

  if (!await clicEnAlgunMarco(page, "Empresas")) console.log("  ⚠ no encontré «Empresas»");
  await page.waitForTimeout(1500);
  await evidencia(page, "empresas");

  if (!await clicEnAlgunMarco(page, "Consulta de Facturas y Notas Electrónicas")) {
    // Alternativa: la ruta por menú, si el acceso directo no está.
    await clicEnAlgunMarco(page, "Comprobantes de pago");
    await page.waitForTimeout(1000);
    await clicEnAlgunMarco(page, "Consultar Factura y Nota");
  }
  await page.waitForTimeout(3000);
  await evidencia(page, "consulta-abierta");

  const marco = await marcoConsulta(page);
  console.log(`  · marco de la consulta: ${marco.url() || "(principal)"}`);

  // Radiografía: qué hay de verdad en cada frame, para fijar los selectores
  // sin adivinar. Se imprime al log; en depuración es la evidencia clave.
  if (DEBUG) await radiografia(page);

  // Fechas: por su nombre real (fec_desde / fec_hasta), no por posición —la
  // radiografía mostró que hay varios inputs de texto y contar posiciones caía
  // en los equivocados—.
  await ponerFechaPorNombre(marco, "fec_desde", FECHA_INICIO);
  await ponerFechaPorNombre(marco, "fec_hasta", FECHA_FIN);

  // Tipo de Consulta: no es un <select> sino un combobox (input visible
  // #criterio.tipoConsulta + hidden name=tipoConsulta). Se maneja como un
  // humano: clic en el visible y clic en la opción.
  await elegirTipo(marco, TIPO_CONSULTA);

  // Confirmar qué quedó puesto de verdad en el formulario.
  const leer = async (n: string) => (await marco.locator(`input[name="${n}"]`).first().inputValue().catch(() => "?"));
  console.log(`  · form: fec_desde=${await leer("fec_desde")} fec_hasta=${await leer("fec_hasta")} tipo(hidden)=${await leer("tipoConsulta")}`);
  await evidencia(page, "consulta-lista");

  // Aceptar: es un <input type="button"> con su texto en value.
  await clicAceptar(marco);

  // Tras Aceptar, la tabla de resultados carga en OTRO frame (anidado), no en
  // el del formulario. Se busca en TODOS los frames el que tenga los enlaces
  // «Descargar Factura», sondeando hasta que aparezcan.
  let res: Frame = marco;
  let descargas = 0;
  for (let i = 0; i < 25; i++) {
    for (const f of page.frames()) {
      try {
        const c = await f.locator('a:has-text("Descargar Factura")').count();
        if (c > descargas) { descargas = c; res = f; }
      } catch { /* frame navegando */ }
    }
    if (descargas > 0) break;
    await page.waitForTimeout(2000);
  }
  await evidencia(page, "resultados");
  console.log(`  · resultados: ${descargas} enlaces «Descargar Factura» en ${res.url().slice(0, 70)}`);
  if (descargas === 0) {
    // Si no hay enlaces, radiografiar para ver dónde quedó la tabla.
    await radiografia(page);
  }

  if (DEBUG) {
    const cuantos = await res.locator('a:has-text("Descargar Factura")').count();
    console.log(`Modo depuración: se ven ${cuantos} comprobantes. No se baja nada.`);
    return [];
  }

  const salida: FilaBajada[] = [];
  const xml = res.locator('a:has-text("Descargar Factura")');
  const pdf = res.locator('a:has-text("Descargar PDF")');
  const n = await xml.count();
  console.log(`Bajando ${n} comprobantes (XML + PDF)…`);

  for (let i = 0; i < n; i++) {
    let xmlArchivo: ArchivoBajado | null = null;
    let pdfArchivo: ArchivoBajado | null = null;
    try { xmlArchivo = await bajar(page, () => xml.nth(i).click()); } catch (e) { console.log(`  · XML fila ${i + 1}: ${e instanceof Error ? e.message : e}`); }
    try { pdfArchivo = await bajar(page, () => pdf.nth(i).click()); } catch (e) { console.log(`  · PDF fila ${i + 1}: ${e instanceof Error ? e.message : e}`); }
    salida.push({ xml: xmlArchivo, pdf: pdfArchivo });
  }
  return salida;
}

/**
 * Imprime la estructura de cada frame: inputs, selects y enlaces.
 *
 * Es para diagnosticar a ciegas desde el log de Actions: dice en qué frame
 * está el formulario, cómo se llaman sus campos, si el «Tipo de Consulta» es
 * un select o un widget, y cómo son los enlaces de descarga.
 */
async function radiografia(page: Page) {
  for (const f of page.frames()) {
    let inputs = 0, selects = 0, descargas = 0, tipo = false;
    try {
      inputs = await f.locator("input").count();
      selects = await f.locator("select").count();
      descargas = await f.locator("text=Descargar").count();
      tipo = (await f.locator("text=Tipo de Consulta").count()) > 0;
    } catch { continue; }
    if (inputs === 0 && selects === 0 && descargas === 0 && !tipo) continue;

    console.log(`\n▚ FRAME ${f.url().slice(0, 90)}`);
    console.log(`   inputs=${inputs} selects=${selects} descargas=${descargas} tipoConsulta=${tipo}`);
    try {
      const campos = await f.locator("input,select,textarea").evaluateAll(els =>
        els.slice(0, 25).map(el => {
          const e = el as HTMLInputElement | HTMLSelectElement;
          const tag = e.tagName.toLowerCase();
          const tipo = (e as HTMLInputElement).type || "";
          const opts = tag === "select"
            ? " opts=[" + Array.from((e as HTMLSelectElement).options).map(o => o.text.trim()).join("|") + "]"
            : "";
          return `${tag}#${e.id || "-"}[name=${e.name || "-"} type=${tipo}]${opts}`;
        }));
      campos.forEach(c => console.log(`     · ${c}`));
    } catch { /* frame ajeno */ }

    if (descargas > 0) {
      try {
        const links = await f.locator("a").evaluateAll(els =>
          els.filter(a => /descargar/i.test(a.textContent || "")).slice(0, 4)
            .map(a => `${(a.textContent || "").trim().slice(0, 40)} → ${(a as HTMLAnchorElement).getAttribute("href")?.slice(0, 60) || "(js)"}`));
        links.forEach(l => console.log(`     ↓ ${l}`));
      } catch { /* nada */ }
    }
  }
  console.log("");
}

/** Dispara una descarga y la devuelve como buffer con su nombre. */
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
    : /\.(xml|zip)$/i.test(nombre) ? (/\.zip$/i.test(nombre) ? "application/zip" : "application/xml")
    : "application/octet-stream";
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
 * Sube un archivo a una carpeta, sin repetir el que ya está, y devuelve su
 * enlace de Drive —el mismo tanto si ya estaba como si se acaba de crear—.
 *
 * `supportsAllDrives` porque la carpeta puede vivir en una unidad compartida,
 * que la API ignora sin ese parámetro. La carpeta tiene que estar compartida
 * con el correo de la cuenta de servicio como Editor.
 */
async function subirADrive(
  drive: ReturnType<typeof clienteDrive>, carpetaId: string, f: ArchivoBajado
): Promise<{ estado: "nuevo" | "existe"; url: string | null }> {
  const q = `name = '${f.nombre.replace(/'/g, "\\'")}' and '${carpetaId}' in parents and trashed = false`;
  const ya = await drive.files.list({
    q, fields: "files(id,webViewLink)", supportsAllDrives: true, includeItemsFromAllDrives: true,
  });
  if (ya.data.files && ya.data.files.length > 0) {
    return { estado: "existe", url: ya.data.files[0].webViewLink ?? null };
  }

  const creado = await drive.files.create({
    requestBody: { name: f.nombre, parents: [carpetaId] },
    media: { mimeType: f.tipo, body: Readable.from(f.datos) },
    fields: "id,webViewLink",
    supportsAllDrives: true,
  });
  return { estado: "nuevo", url: creado.data.webViewLink ?? null };
}

/**
 * La carpeta —creándola si hace falta— para un origen y un período, cacheada
 * por ruta: con cientos de comprobantes por corrida, sin caché se repetiría
 * la misma búsqueda de "Recibidas/2026-08" cientos de veces.
 */
const carpetasPorRuta = new Map<string, Promise<string>>();
async function carpetaDelLote(
  drive: ReturnType<typeof clienteDrive>, origen: DocLote["origen"], periodo: string | null
): Promise<string> {
  const sub = origen === "RECIBIDO" ? "Recibidas" : origen === "EMITIDO" ? "Emitidas" : "Otros";
  const mes = periodo && /^\d{6}$/.test(periodo) ? `${periodo.slice(0, 4)}-${periodo.slice(4, 6)}` : "Sin fecha";
  const clave = `${sub}/${mes}`;
  let promesa = carpetasPorRuta.get(clave);
  if (!promesa) {
    promesa = (async () => {
      const idSub = await carpeta(drive, sub, CARPETA_DRIVE);
      return carpeta(drive, mes, idSub);
    })();
    carpetasPorRuta.set(clave, promesa);
  }
  return promesa;
}

// ── Guardar el detalle (opcional, si hay base) ────────────────────

async function guardarDetalle(comprobantes: Array<{ c: ComprobanteCpe; xmlUrl: string | null; pdfUrl: string | null }>) {
  const url = process.env.SUPABASE_URL || process.env.PROJECT_URL;
  if (!url || comprobantes.length === 0) return;
  const lote = prepararLote(comprobantes.map(x => x.c), RUC);
  if (lote.length === 0) return;

  // El lote dedup por identidad puede haberse quedado con un comprobante que
  // no es el mismo objeto que trajo el enlace; se reengancha por esa misma
  // identidad, no por posición.
  const urlsPorIdentidad = new Map(comprobantes.map(x => [identidad(x.c), x]));
  for (const d of lote) {
    const par = urlsPorIdentidad.get(identidad(d));
    d.xmlDriveUrl = par?.xmlUrl ?? null;
    d.pdfDriveUrl = par?.pdfUrl ?? null;
  }

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

const navegador = await chromium.launch({
  headless: true,
  args: ["--disable-blink-features=AutomationControlled"],
});
const contexto = await navegador.newContext({
  acceptDownloads: true,
  locale: "es-PE",
  // Un User-Agent de navegador real: el WAF de SUNAT resetea la conexión ante
  // un headless sin UA. Con esto se presenta como un Chrome normal.
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
});
const page = await contexto.newPage();

/** El o los XML que trae una descarga: sueltos o dentro de un ZIP con css/xsl. */
function xmlsDe(f: ArchivoBajado): string[] {
  if (/\.zip$/i.test(f.nombre)) {
    return leerZip(f.datos).filter(a => /\.xml$/i.test(a.nombre)).map(a => decodificar(a.contenido));
  }
  if (/\.xml$/i.test(f.nombre)) return [decodificar(f.datos)];
  return [];
}

try {
  await entrar(page);
  const filas = await consultarYBajar(page);

  if (DEBUG) {
    console.log("\nModo depuración: no se bajó nada. Revisa el artefacto 'capturas/'.");
  } else if (filas.length === 0) {
    console.log("No se bajó ningún archivo en el rango.");
  } else {
    const drive = clienteDrive();
    let nuevos = 0, existentes = 0;
    const comprobantes: Array<{ c: ComprobanteCpe; xmlUrl: string | null; pdfUrl: string | null }> = [];

    // Se lee el XML antes de subir para saber, por comprobante, si es
    // Emitida o Recibida y de qué mes es —así cada archivo va directo a su
    // carpeta ordenada, en vez de a una carpeta plana que hay que reordenar
    // después—.
    for (const fila of filas) {
      const xmls = fila.xml ? xmlsDe(fila.xml) : [];
      const c = xmls[0] ? leerComprobanteXml(xmls[0]) : null;
      const origen = c ? origenDe(c, RUC) : "OTRO";
      const periodo = c ? periodoDe(c.fechaEmision) : null;
      const carpetaId = await carpetaDelLote(drive, origen, periodo);

      let xmlUrl: string | null = null;
      let pdfUrl: string | null = null;
      if (fila.xml) {
        const r = await subirADrive(drive, carpetaId, fila.xml);
        if (r.estado === "nuevo") nuevos++; else existentes++;
        xmlUrl = r.url;
      }
      if (fila.pdf) {
        const r = await subirADrive(drive, carpetaId, fila.pdf);
        if (r.estado === "nuevo") nuevos++; else existentes++;
        pdfUrl = r.url;
      }
      if (c) comprobantes.push({ c, xmlUrl, pdfUrl });
    }
    console.log(`Archivados en Drive: ${nuevos} nuevos, ${existentes} ya estaban.`);

    await guardarDetalle(comprobantes);
  }
} catch (e) {
  await evidencia(page, "error");
  console.error("✗", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await navegador.close();
}
