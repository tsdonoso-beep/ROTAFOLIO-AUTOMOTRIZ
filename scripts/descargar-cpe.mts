// Bajar los comprobantes (XML y PDF) del portal de SUNAT y archivarlos en Drive
//
// El detalle de ítems no lo da ninguna API: sale del XML, y al XML solo se
// llega por las pantallas de consulta de CPE de SOL, que tienen login.
// Por eso esto maneja un navegador de verdad (Playwright), no peticiones
// sueltas. Corre en GitHub Actions —Apps Script no puede manejar un navegador
// y Vercel corta al minuto— y reusa los secretos que ya están: el usuario y la
// clave de SOL pueden ser los mismos del SIRE.
//
// QUÉ SE PUEDE PEDIR: el catálogo de tipos de consulta —cómo se llama cada uno
// en el portal y por qué entrada del menú se llega— vive en
// `lib/sunat/cpe-consulta.ts`, junto con el corte del rango en tandas. Acá
// queda solo el manejo del navegador.
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
import { normalizarClavePrivada, correoDeServicio, carpeta, publicarHoja } from "../lib/drive/servidor.ts";
import { leerZip } from "../lib/sunat/zip.ts";
import { leerComprobanteXml, type ComprobanteCpe } from "../lib/sunat/cpe-xml.ts";
import { prepararLote, origenDe, periodoDe, identidad, type DocLote } from "../lib/sunat/cpe-importacion.ts";
import {
  conMenuDeBoletas, consultaDe, tandasPorMes, periodosDelRango, nombreDeHojaDelRango,
  type Consulta, type Tanda,
} from "../lib/sunat/cpe-consulta.ts";
import { filasItemsSunat, filaDetalleDesdeRpc, detalleCpeCompleto, TIPOS_ITEMS } from "../lib/export/items-sunat.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

// ── Configuración desde el entorno ────────────────────────────────

function pedir(...nombres: string[]): string {
  for (const n of nombres) { const v = (process.env[n] ?? "").trim(); if (v) return v; }
  console.error(`✗ Falta ${nombres.join(" o ")} en el entorno.`);
  process.exit(1);
}

const RUC       = process.env.SUNAT_RUC?.trim() || "20512201611";
// El acceso de SOL con el que se entra al portal.
//
// Se buscan primero SUNAT_SOL_USUARIO / SUNAT_SOL_CLAVE y se cae a los del
// SIRE. Nacieron siendo el mismo usuario secundario, pero el acceso que puede
// ver boletas se dio aparte: con un solo secreto para las dos cosas, cambiarlo
// acá cambiaría también el del SIRE —que no necesita ese permiso— y un error
// en uno rompería los dos. Mientras los secretos nuevos no estén puestos, esto
// se comporta exactamente como antes.
const USUARIO = pedir("SUNAT_SOL_USUARIO", "SUNAT_INROPRIN_USUARIO");  // el secundario de SOL, ej. APISIREE
const CLAVE   = pedir("SUNAT_SOL_CLAVE", "SUNAT_INROPRIN_CLAVE");

// El usuario del portal es el secundario solo, sin el RUC pegado adelante.
const USUARIO_SOL = USUARIO.startsWith(RUC) ? USUARIO.slice(RUC.length) : USUARIO;

const DEBUG = process.env.DEBUG !== "0";

// Por dónde se entra a las boletas, si la corrida de depuración mostró que no
// es lo que dice el catálogo. Los textos del menú van separados por «>»:
// "Empresas > Comprobantes de pago > Consultar Boleta". Vacío = el del
// catálogo. Es un tornillo de ajuste: cuando se sepa el camino de verdad, se
// escribe en `lib/sunat/cpe-consulta.ts` y este input deja de hacer falta.
const MENU_BOLETAS = (process.env.MENU_BOLETAS?.trim() || "")
  .split(">").map(t => t.trim()).filter(Boolean);

const CATALOGO = conMenuDeBoletas(MENU_BOLETAS);

// Uno o varios, separados por coma: "FE Emitidas,FE Recibidas,BE Recibidas".
// El portal los tiene como consultas separadas —no hay un «todo junto»—, así
// que en vez de disparar el workflow una vez por tipo (con su propio login
// cada vez) esto entra una sola vez y los recorre todos en la misma sesión.
//
// Se resuelven contra el catálogo ANTES de entrar a SUNAT: un nombre mal
// escrito en el workflow tiene que cortar acá, con la lista de los que hay, y
// no después de un login y veinte minutos de corrida.
const TIPOS_CONSULTA: Consulta[] = (process.env.TIPOS_CONSULTA?.trim() || process.env.TIPO_CONSULTA?.trim() || "FE Recibidas")
  .split(",").map(t => t.trim()).filter(Boolean)
  .map(n => {
    const c = consultaDe(n, CATALOGO);
    if (!c) {
      console.error(`✗ "${n}" no es un tipo de consulta conocido.`);
      console.error(`  Los que hay: ${CATALOGO.map(x => x.nombre).join(", ")}.`);
      process.exit(1);
    }
    return c;
  });

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

/**
 * Partir el rango en una consulta por mes calendario.
 *
 * Apagado por omisión: la corrida diaria pide dos días y partirlos no tiene
 * sentido. Se prende para los rellenos largos —agosto y setiembre completos,
 * por ejemplo—, donde pedir varios meses en UNA sola consulta es justo lo que
 * disparó el «User rate limit exceeded» de SUNAT.
 */
const PARTIR_POR_MES = process.env.PARTIR_POR_MES === "1";

/**
 * El rango, ya partido en las consultas que se van a hacer.
 *
 * En depuración NO se parte, aunque se haya pedido: ahí el objetivo es ver qué
 * ofrece el portal —el menú, las opciones del «Tipo de Consulta»—, y eso se ve
 * igual de bien en una consulta que en seis. Partir multiplicaría la corrida
 * (ocho tipos por dos meses son dieciséis entradas al menú) para repetir el
 * mismo hallazgo. El corte está probado aparte, en los tests del módulo.
 */
const TANDAS: Tanda[] = PARTIR_POR_MES && !DEBUG
  ? tandasPorMes(FECHA_INICIO, FECHA_FIN)
  : [{ desde: FECHA_INICIO, hasta: FECHA_FIN }];

/**
 * Además de la hoja histórica, dejar una hoja APARTE solo con los períodos que
 * abarca el rango pedido. Apagado por omisión: la corrida diaria no necesita
 * una hoja nueva cada día.
 */
const HOJA_DEL_RANGO = process.env.HOJA_DEL_RANGO === "1";

const CAPTURAS = join(process.cwd(), "capturas");
mkdirSync(CAPTURAS, { recursive: true });

/**
 * Prueba puntual, apagada por omisión: ¿el "imprimirListado" de SUNAT
 * re-consulta según el rango que lleva en la URL, o solo reimprime lo último
 * que se corrió con Aceptar? Si pide un rango distinto al que se consultó de
 * verdad y el HTML que devuelve trae el rango NUEVO, es una consulta aparte
 * —y esa vista, al ser una tabla plana (no la grilla dojox), no tiene el
 * problema de las tandas de 25 ni la carrera al cruzar de una a otra—.
 */
const PROBAR_IMPRIMIR = process.env.PROBAR_IMPRIMIR === "1";
const RANGO_PRUEBA_IMPRIMIR = process.env.RANGO_PRUEBA_IMPRIMIR?.trim() || null;

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
 * Elige el Tipo de Consulta —un combobox (input visible + hidden), no un
 * <select>— y CONFIRMA que quedó elegido ese y no otro. Devuelve false si no
 * se pudo.
 *
 * Se hace como un humano: clic en el visible y clic en la opción. Lo nuevo es
 * el «y confirma». Antes, cuando no encontraba la opción, teclaba el texto y
 * mandaba Enter y seguía adelante; con los seis tipos de siempre eso nunca
 * hizo daño porque todos existían. Con las boletas sí puede hacerlo: su
 * etiqueta es una suposición, y si no existe el combobox se queda con lo que
 * tenía —el log diría «BE Recibidas: 112 comprobantes» y serían facturas, que
 * es peor que no bajar nada, porque nadie lo notaría—.
 *
 * Por eso: si el tipo tiene código confirmado, se compara contra el campo
 * oculto; si no lo tiene (las boletas), al menos se exige que la opción exista
 * de verdad en la lista.
 */
async function elegirTipo(marco: Frame, consulta: Consulta): Promise<boolean> {
  const visible = marco.locator('[id="criterio.tipoConsulta"]').first();
  if (!(await visible.count())) { console.log("  ⚠ no encontré el campo de tipo"); return false; }
  await visible.click().catch(() => {});
  await marco.page().waitForTimeout(800);

  // Las opciones que este acceso ofrece DE VERDAD. Es la evidencia que dice
  // cómo se llaman las boletas en el portal, en vez de adivinar la etiqueta.
  const opciones = await marco.locator("li, .ui-menu-item, option").evaluateAll(
    els => [...new Set(els.map(e => (e.textContent || "").replace(/\s+/g, " ").trim())
      .filter(t => t.length > 0 && t.length < 60))].slice(0, 40)
  ).catch(() => [] as string[]);
  if (opciones.length) console.log(`  · opciones del «Tipo de Consulta»: ${opciones.join(" | ")}`);

  const etiqueta = consulta.etiqueta;
  const opcion = marco.locator(
    `li:has-text("${etiqueta}"), .ui-menu-item:has-text("${etiqueta}"), option:has-text("${etiqueta}"), a:has-text("${etiqueta}")`
  ).first();

  if (await opcion.count()) {
    await opcion.click().catch(() => {});
  } else if (consulta.confirmado) {
    // Respaldo de siempre, solo para los tipos que sabemos que existen:
    // teclear el texto y Enter. El código se verifica abajo igual.
    console.log(`  ⚠ no vi la opción «${etiqueta}» en la lista; se teclea y se verifica.`);
    await visible.fill(etiqueta).catch(() => {});
    await visible.press("Enter").catch(() => {});
  } else {
    console.log(`  ✗ este acceso no ofrece «${etiqueta}» (etiqueta sin confirmar). No se consulta este tipo:`);
    console.log("    corregí la etiqueta en lib/sunat/cpe-consulta.ts con una de las opciones de arriba.");
    return false;
  }

  if (consulta.codigo) {
    const puesto = await marco.locator('input[name="tipoConsulta"]').first().inputValue().catch(() => "");
    if (puesto && puesto !== consulta.codigo) {
      console.log(`  ✗ el formulario quedó con tipoConsulta=${puesto} y ${consulta.nombre} es ${consulta.codigo}. No se consulta, para no bajar otro tipo creyendo que es este.`);
      return false;
    }
  }
  return true;
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
 * Imprime las entradas del menú de SOL que se ven ahora mismo.
 *
 * Es cómo se averigua por dónde entra un módulo que nunca usamos, sin tener la
 * clave delante: el log del run dice qué ofrece ESTE acceso y con eso se
 * corrige el catálogo. Hace falta justo ahora que el acceso creció —las
 * boletas están detrás de una entrada que todavía no vimos— y seguirá sirviendo
 * la próxima vez que SUNAT renombre algo.
 */
async function opcionesDelMenu(page: Page) {
  for (const f of page.frames()) {
    let textos: string[] = [];
    try {
      textos = await f.locator("a, li").evaluateAll(els => [...new Set(
        els.map(e => (e.textContent || "").replace(/\s+/g, " ").trim())
          .filter(t => t.length > 3 && t.length < 70)
      )].slice(0, 50));
    } catch { continue; }
    if (textos.length === 0) continue;
    console.log(`  · menú visible en ${f.url().slice(0, 60) || "(principal)"}:`);
    textos.forEach(t => console.log(`     – ${t}`));
  }
}

/**
 * Llega a la pantalla de consulta desde el menú «¿Qué necesitas hacer?».
 *
 * Qué textos hay que clicar lo dice el catálogo (`consulta.menu`), no este
 * código: facturas y notas viven en una pantalla y las boletas pueden vivir en
 * otra, y esa diferencia es un dato, no un `if`.
 *
 * Se repite antes de CADA tipo de consulta —aunque sea un poco más lento que
 * reusar el formulario ya abierto— porque es el único camino que se probó de
 * verdad, veinte corridas seguidas sin fallar: apostar a que el formulario
 * queda listo para una segunda consulta sin volver a entrar es un supuesto
 * que nadie confirmó contra el portal real.
 *
 * A partir del tercer tipo en la misma sesión, hacer clic en los enlaces del
 * menú deja de abrir una pestaña nueva del módulo: se queda pegado en la que
 * ya estaba abierta, todavía con los resultados de la consulta anterior (se
 * vio en un run real: NC/ND «heredaron» los resultados de FE Recibidas y
 * nunca encontraron el formulario). Por eso primero se recarga el menú desde
 * cero —la sesión sigue viva, no vuelve a pedir clave— para cerrar cualquier
 * pestaña del módulo que haya quedado abierta.
 */
async function abrirModuloConsulta(page: Page, menu: string[]) {
  console.log(`Menú → ${menu.join(" → ")}…`);
  await irConReintento(page, LOGIN_URL);
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await evidencia(page, "menu-inicio");
  console.log(`  · frames: ${page.frames().map(f => f.url() || "(vacío)").join(" | ")}`);

  for (const [i, texto] of menu.entries()) {
    const ultimo = i === menu.length - 1;
    if (await clicEnAlgunMarco(page, texto)) {
      await page.waitForTimeout(ultimo ? 3000 : 1500);
      if (!ultimo) await evidencia(page, `menu-${slug(texto)}`);
      continue;
    }

    // Un texto del menú que no está es lo que hay que saber con nombre y
    // apellido: se dice cuál, y se lista lo que el menú sí ofrece.
    console.log(`  ⚠ no encontré «${texto}» en el menú de este acceso.`);
    await opcionesDelMenu(page);

    // El respaldo de siempre para facturas y notas: la ruta larga por
    // «Comprobantes de pago», por si el acceso directo no está.
    if (texto === "Consulta de Facturas y Notas Electrónicas") {
      await clicEnAlgunMarco(page, "Comprobantes de pago");
      await page.waitForTimeout(1000);
      await clicEnAlgunMarco(page, "Consultar Factura y Nota");
      await page.waitForTimeout(3000);
    }
  }
  await evidencia(page, "consulta-abierta");
}

/** Un nombre de archivo seguro para las capturas, a partir del tipo de consulta. */
function slug(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-");
}

interface ArchivoBajado { nombre: string; datos: Buffer; tipo: string }
interface FilaBajada { xml: ArchivoBajado | null; pdf: ArchivoBajado | null }

/**
 * El total real de una tabla de resultados, leído del propio widget en vez
 * de contar enlaces en el DOM.
 *
 * La tabla es un dojox.grid.DataGrid: virtualiza el DOM —solo pinta las
 * filas visibles y las recicla al scrollear—, así que contar `<a>` nunca ve
 * más que un puñado (~25) aunque haya cientos. El widget en sí sí sabe el
 * total (`rowCount`), sin importar cuánto se haya scrolleado.
 */
async function rowCountDeGrid(f: Frame): Promise<number | null> {
  try {
    return await f.evaluate(() => {
      const w = window as unknown as { dijit?: { registry?: { toArray?: () => Array<Record<string, unknown>> } } };
      const widgets = w.dijit?.registry?.toArray?.() ?? [];
      const grid = widgets.find((x) => typeof x.rowCount === "number");
      return grid ? (grid.rowCount as number) : null;
    });
  } catch {
    return null;
  }
}

/**
 * Descarga la fila `indice` llamando directo a la función de SUNAT, sin
 * pasar por el enlace.
 *
 * Se confirmó contra el HTML real (FE y NC por igual) que el enlace no hace
 * más que esto: `onclick="consultaFactura.descargar('0')"` para el XML,
 * `consultaFactura.descargarComprobantePdf('0')` para el PDF, con el índice
 * de la fila —no un dato propio de esa fila—. Como es un índice, no hace
 * falta que la fila esté pintada ni visible: se llama igual para las 400
 * que para las 4.
 */
function descargarPorIndice(f: Frame, indice: number, metodo: "descargar" | "descargarComprobantePdf") {
  return f.evaluate(({ i, m }) => {
    const w = window as unknown as Record<string, Record<string, (i: string) => void> | undefined>;
    const cf = w.consultaFactura;
    if (cf && typeof cf[m] === "function") cf[m](String(i));
  }, { i: indice, m: metodo });
}

/**
 * Pide un tipo de consulta puntual —«FE Recibidas», «NC Emitidas»...— para el
 * rango de fechas ya fijado, y devuelve las descargas.
 *
 * Las fechas se escriben directo (dd/mm/yyyy) en vez de pelear con el
 * calendario emergente. Aceptar trae la tabla, y de cada fila cuelgan los
 * enlaces «Descargar Factura (XML)» y «Descargar PDF» —el texto cambia según
 * el tipo («Descargar NC (XML)» en notas de crédito—, así que no se busca
 * por texto para decidir cuántas filas hay: se lee `rowCount` del grid.
 */
async function consultarUnTipo(page: Page, consulta: Consulta, desde: string, hasta: string): Promise<FilaBajada[]> {
  const tipo = consulta.nombre;
  const marco = await marcoConsulta(page);
  console.log(`  · marco de la consulta: ${marco.url() || "(principal)"}`);

  // Radiografía: qué hay de verdad en cada frame, para fijar los selectores
  // sin adivinar. Se imprime al log; en depuración es la evidencia clave.
  if (DEBUG) await radiografia(page);

  // Fechas: por su nombre real (fec_desde / fec_hasta), no por posición —la
  // radiografía mostró que hay varios inputs de texto y contar posiciones caía
  // en los equivocados—.
  await ponerFechaPorNombre(marco, "fec_desde", desde);
  await ponerFechaPorNombre(marco, "fec_hasta", hasta);

  // Tipo de Consulta: no es un <select> sino un combobox (input visible
  // #criterio.tipoConsulta + hidden name=tipoConsulta). Se maneja como un
  // humano: clic en el visible y clic en la opción. Si no se pudo dejar ESTE
  // tipo puesto, se abandona la consulta: bajar lo que haya quedado en el
  // formulario sería archivarlo bajo un nombre que no le corresponde.
  if (!await elegirTipo(marco, consulta)) {
    await evidencia(page, `sin-tipo-${slug(tipo)}`);
    return [];
  }

  // Confirmar qué quedó puesto de verdad en el formulario.
  const leer = async (n: string) => (await marco.locator(`input[name="${n}"]`).first().inputValue().catch(() => "?"));
  console.log(`  · form [${tipo}]: fec_desde=${await leer("fec_desde")} fec_hasta=${await leer("fec_hasta")} tipo(hidden)=${await leer("tipoConsulta")}`);
  await evidencia(page, `consulta-lista-${slug(tipo)}`);

  // Aceptar: es un <input type="button"> con su texto en value.
  await clicAceptar(marco);

  // Tras Aceptar, la tabla de resultados carga en OTRO frame (anidado), no en
  // el del formulario. Se sondean todos los frames buscando la grilla dojox
  // —ahí vive el total real (`rowCount`), sin depender de cuántas filas
  // estén pintadas—. Si no aparece ninguna en ~20s, se cae al respaldo de
  // contar enlaces «Descargar Factura» (el camino viejo, por si el portal
  // cambia y deja de usar esa grilla, o da un resultado vacío sin ella).
  let res: Frame = marco;
  let descargas = 0;
  let usandoRowCount = false;
  // 30 intentos × 2s = 60s. Un mes chico arma la grilla casi al toque, pero
  // uno cargado (julio: FE Recibidas tardó 51s en aparecer) puede tardar más
  // que los 20s de antes —y con eso caía al respaldo viejo (tope ~25) aunque
  // la grilla sí existiera, solo que tarde—.
  for (let i = 0; i < 30; i++) {
    for (const f of page.frames()) {
      const rc = await rowCountDeGrid(f);
      if (rc != null) { descargas = rc; res = f; usandoRowCount = true; break; }
    }
    if (usandoRowCount) break;
    await page.waitForTimeout(2000);
  }

  if (!usandoRowCount) {
    // Respaldo: el conteo por enlaces de antes. Sirve tal cual para un
    // resultado vacío (0 enlaces = 0 comprobantes) y como red de seguridad
    // si la grilla no se pudo leer.
    for (let i = 0; i < 15; i++) {
      let maxAhora = 0;
      let marcoAhora: Frame = res;
      for (const f of page.frames()) {
        try {
          const c = await f.locator('a:has-text("Descargar Factura")').count();
          if (c > maxAhora) { maxAhora = c; marcoAhora = f; }
        } catch { /* frame navegando */ }
      }
      if (maxAhora > descargas) { descargas = maxAhora; res = marcoAhora; }
      if (descargas > 0) break;
      await page.waitForTimeout(2000);
    }
  }

  await evidencia(page, `resultados-${slug(tipo)}`);
  console.log(`  · resultados [${tipo}]: ${descargas} comprobantes (${usandoRowCount ? "rowCount de la grilla" : "conteo de enlaces, respaldo"}) en ${res.url().slice(0, 70)}`);
  if (descargas === 0) {
    // Si no hay nada, radiografiar para ver dónde quedó la tabla.
    await radiografia(page);
  }

  if (PROBAR_IMPRIMIR && RANGO_PRUEBA_IMPRIMIR) {
    try {
      const codigoTipo = await leer("tipoConsulta");
      const url = "https://ww1.sunat.gob.pe/ol-ti-itconscpemype/consultar.do?action=imprimirListado"
        + `&periodoDesc=${encodeURIComponent(RANGO_PRUEBA_IMPRIMIR)}&tipoConsulta=${encodeURIComponent(codigoTipo)}`;
      const html = await res.evaluate((u) => fetch(u, { credentials: "include" }).then((r) => r.text()), url);
      writeFileSync(join(CAPTURAS, `zz-imprimir-${slug(tipo)}.html`), html);
      const periodoEnHtml = html.match(/del\s*Periodo\s*<\/?[^>]*>?\s*([\d/ -]+)/i)?.[1]?.trim()
        ?? html.match(/(\d{2}\/\d{2}\/\d{4}\s*-\s*\d{2}\/\d{2}\/\d{4})/)?.[1];
      const filas = (html.match(/<tr[ >]/gi) ?? []).length;
      console.log(`  · PRUEBA imprimirListado [${tipo}]: se consultó "${desde} - ${hasta}", se pidió el listado con "${RANGO_PRUEBA_IMPRIMIR}" → el HTML dice periodo "${periodoEnHtml}", ${filas} filas <tr>.`);
    } catch (e) {
      console.log(`  · PRUEBA imprimirListado [${tipo}] falló: ${e instanceof Error ? e.message : e}`);
    }
  }

  if (DEBUG) {
    console.log(`Modo depuración [${tipo}]: se ven ${descargas} comprobantes. No se baja nada.`);
    return [];
  }

  console.log(`Bajando ${descargas} comprobantes de ${tipo} (XML + PDF)…`);
  const salida: FilaBajada[] = [];

  if (usandoRowCount) {
    // Se llama directo a la función de SUNAT por índice de fila: no depende
    // de que esa fila esté pintada ni de cómo se llame su enlace (distinto
    // entre FE y NC/ND).
    //
    // La grilla trae los datos del servidor en tandas de 25: al cruzar a una
    // tanda nueva (fila 26, 51, 76…), la PRIMERA lectura de esa tanda puede
    // llegar antes de que SUNAT termine de traerla —se vio en un run real,
    // "Cannot read properties of null (reading 'nroRucEmisor')" justo en
    // esos índices, y nunca en los de en medio—. Un reintento corto alcanza:
    // para cuando se reintenta, la tanda ya cargó.
    for (let i = 0; i < descargas; i++) {
      let xmlArchivo: ArchivoBajado | null = null;
      let pdfArchivo: ArchivoBajado | null = null;
      try {
        xmlArchivo = await bajar(page, () => descargarPorIndice(res, i, "descargar"));
      } catch (e) {
        console.log(`  · XML fila ${i + 1} [${tipo}]: ${e instanceof Error ? e.message : e} — reintentando…`);
        await page.waitForTimeout(1500);
        try { xmlArchivo = await bajar(page, () => descargarPorIndice(res, i, "descargar")); } catch (e2) { console.log(`  · XML fila ${i + 1} [${tipo}]: ${e2 instanceof Error ? e2.message : e2}`); }
      }
      try {
        pdfArchivo = await bajar(page, () => descargarPorIndice(res, i, "descargarComprobantePdf"));
      } catch (e) {
        console.log(`  · PDF fila ${i + 1} [${tipo}]: ${e instanceof Error ? e.message : e} — reintentando…`);
        await page.waitForTimeout(1500);
        try { pdfArchivo = await bajar(page, () => descargarPorIndice(res, i, "descargarComprobantePdf")); } catch (e2) { console.log(`  · PDF fila ${i + 1} [${tipo}]: ${e2 instanceof Error ? e2.message : e2}`); }
      }
      salida.push({ xml: xmlArchivo, pdf: pdfArchivo });

      // Espaciar las solicitudes: un mes cargado (400+ comprobantes) pidiendo
      // XML+PDF fila tras fila sin pausa parece ser lo que dispara el
      // "User rate limit exceeded" de SUNAT a mitad de descarga (visto real
      // en julio, cortado en la fila 401 de 410). Una pausa corta baja el
      // ritmo sin alargar demasiado la corrida.
      await page.waitForTimeout(400);
    }
  } else {
    // Respaldo: el clic por enlace de antes, para cuando no hubo grilla que leer.
    const xml = res.locator('a:has-text("Descargar Factura")');
    const pdf = res.locator('a:has-text("Descargar PDF")');
    for (let i = 0; i < descargas; i++) {
      let xmlArchivo: ArchivoBajado | null = null;
      let pdfArchivo: ArchivoBajado | null = null;
      try { xmlArchivo = await bajar(page, () => xml.nth(i).click()); } catch (e) { console.log(`  · XML fila ${i + 1} [${tipo}]: ${e instanceof Error ? e.message : e}`); }
      try { pdfArchivo = await bajar(page, () => pdf.nth(i).click()); } catch (e) { console.log(`  · PDF fila ${i + 1} [${tipo}]: ${e instanceof Error ? e.message : e}`); }
      salida.push({ xml: xmlArchivo, pdf: pdfArchivo });
    }
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

/**
 * Entra a la base como el robot. `null` si no hay credenciales o si el login
 * falla, que es un aviso, no un motivo para tumbar la corrida: lo bajado ya
 * quedó archivado en Drive.
 *
 * Aparte de `guardarDetalle` porque publicar una hoja también necesita entrar,
 * y hay un caso en que hay que publicar sin haber guardado nada: cuando la
 * corrida no bajó nada nuevo pero la hoja del rango se pidió igual.
 */
async function clienteBase(): Promise<SupabaseClient | null> {
  const url = process.env.SUPABASE_URL || process.env.PROJECT_URL;
  if (!url) return null;
  const sb = createClient(url, pedir("SUPABASE_ANON_KEY", "ANON_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await sb.auth.signInWithPassword({
    email: pedir("ROBOT_CORREO"), password: pedir("ROBOT_CLAVE"),
  });
  if (error) { console.error("⚠ No se pudo entrar a la base:", error.message); return null; }
  return sb;
}

/**
 * Guarda el detalle y devuelve el cliente ya logueado como el robot, para
 * que el llamador pueda reusarlo y dejar la hoja publicada sin loguearse de
 * nuevo. `null` si no había credenciales de la base o nada que guardar.
 */
async function guardarDetalle(
  comprobantes: Array<{ c: ComprobanteCpe; xmlUrl: string | null; pdfUrl: string | null }>
): Promise<SupabaseClient | null> {
  const url = process.env.SUPABASE_URL || process.env.PROJECT_URL;
  if (!url || comprobantes.length === 0) return null;
  const lote = prepararLote(comprobantes.map(x => x.c), RUC);
  if (lote.length === 0) return null;

  // El lote dedup por identidad puede haberse quedado con un comprobante que
  // no es el mismo objeto que trajo el enlace; se reengancha por esa misma
  // identidad, no por posición.
  const urlsPorIdentidad = new Map(comprobantes.map(x => [identidad(x.c), x]));
  for (const d of lote) {
    const par = urlsPorIdentidad.get(identidad(d));
    d.xmlDriveUrl = par?.xmlUrl ?? null;
    d.pdfDriveUrl = par?.pdfUrl ?? null;
  }

  const sb = await clienteBase();
  if (!sb) return null;
  const { data, error } = await sb.rpc("guardar_cpe", { p_empresa_ruc: RUC, p_docs: lote });
  if (error) { console.error("⚠ No se guardó el detalle:", error.message); return null; }
  const r = (Array.isArray(data) ? data[0] : data) as { nuevos: number; actualizados: number; items: number };
  console.log(`Detalle guardado: ${r?.nuevos} nuevos, ${r?.actualizados} actualizados, ${r?.items} ítems.`);
  return sb;
}

/**
 * Deja la hoja de Contabilidad al día, igual que hace `sunat-diario.mts` con
 * la de cabeceras.
 *
 * Sin esto, la hoja se queda como quedó la última vez que alguien entró a la
 * app y le dio al botón — justo lo que se quería evitar al automatizar la
 * descarga: verla "al día" sin ninguna señal de que no lo está.
 *
 * Es opcional: si faltan las credenciales de Drive, el detalle igual quedó
 * guardado en la base y solo se salta la publicación.
 */
async function publicarLaHojaDetalle(sb: SupabaseClient): Promise<void> {
  if (!process.env.GOOGLE_SA_EMAIL || !process.env.GOOGLE_DRIVE_FOLDER_ID) {
    console.log("Sin credenciales de Drive: no se actualiza la hoja de detalle.");
    return;
  }

  let datos: Record<string, unknown>[];
  try {
    datos = await detalleCpeCompleto(sb, null);
  } catch (e) {
    console.error("⚠ No se pudo leer el detalle para la hoja:", e instanceof Error ? e.message : e);
    return;
  }

  const filas = datos.map(filaDetalleDesdeRpc);
  const r = await publicarHoja({
    filas: filasItemsSunat(filas),
    nombre: "COMPROBANTES SUNAT - DETALLE",
    carpetas: ["SUNAT"],
    tipos: TIPOS_ITEMS,
  });
  console.log(`Hoja de detalle al día: ${filas.length} ítems · ${r.url}`);
}

/**
 * Deja una hoja APARTE con solo los períodos que abarca el rango pedido.
 *
 * La histórica —«COMPROBANTES SUNAT - DETALLE»— trae todo y por eso crece sin
 * parar; para revisar dos meses concretos, o para pasárselos a alguien sin
 * mandarle el archivo entero, sirve una hoja con esos meses y nada más.
 *
 * Se llena desde la BASE, no desde lo que se acaba de bajar: así sale completa
 * aunque esta corrida solo haya agregado lo que faltaba, y así también sale
 * bien si se vuelve a correr el mismo rango (que es seguro repetir: Drive
 * detecta «ya estaba» y la base actualiza en vez de duplicar).
 *
 * El nombre lleva el rango y es estable, así que la corrida siguiente del
 * mismo rango REEMPLAZA esta hoja en vez de dejar otra al lado.
 */
async function publicarLaHojaDelRango(sb: SupabaseClient): Promise<void> {
  if (!process.env.GOOGLE_SA_EMAIL || !process.env.GOOGLE_DRIVE_FOLDER_ID) {
    console.log("Sin credenciales de Drive: no se crea la hoja del rango.");
    return;
  }

  const periodos = periodosDelRango(FECHA_INICIO, FECHA_FIN);
  const nombre = nombreDeHojaDelRango(periodos);
  if (!nombre) {
    console.log(`No se entendió el rango ${FECHA_INICIO} – ${FECHA_FIN}: no se crea la hoja aparte.`);
    return;
  }

  // Un período por llamada: `detalle_cpe` filtra por período exacto, no por
  // rango, y paginar cada uno es el camino que ya está probado.
  const datos: Record<string, unknown>[] = [];
  try {
    for (const periodo of periodos) datos.push(...await detalleCpeCompleto(sb, periodo));
  } catch (e) {
    console.error("⚠ No se pudo leer el detalle del rango:", e instanceof Error ? e.message : e);
    return;
  }

  const filas = datos.map(filaDetalleDesdeRpc);
  const r = await publicarHoja({
    filas: filasItemsSunat(filas),
    nombre,
    carpetas: ["SUNAT"],
    tipos: TIPOS_ITEMS,
  });
  console.log(`Hoja «${nombre}»: ${filas.length} ítems · ${r.url}`);

  // El desglose por tipo de comprobante, que es cómo se comprueba de un
  // vistazo si las boletas (03) de verdad entraron o si la hoja trae solo
  // facturas otra vez.
  const porTipo = new Map<string, number>();
  for (const f of filas) {
    const t = f.tipoComprobante || "?";
    porTipo.set(t, (porTipo.get(t) ?? 0) + 1);
  }
  console.log(`  · ítems por tipo de comprobante: ${[...porTipo].sort().map(([t, n]) => `${t}=${n}`).join(" ") || "(ninguno)"}`);
}

/**
 * Decodifica el XML por lo que los bytes SON, no por lo que el propio XML
 * dice que son.
 *
 * Algunos emisores (se vio con facturas propias, de donaciones) declaran
 * `encoding="ISO-8859-1"` en el prólogo mintiendo: el contenido real es
 * UTF-8, y confiar en la etiqueta da textos como «DONACIÃN» en vez de
 * «DONACIÓN». UTF-8 es autoverificable —una secuencia de bytes o es UTF-8
 * válido o no lo es—, así que se prueba estricto primero y solo se cae a
 * Latin-1 cuando de verdad no lo es.
 */
function decodificar(buf: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return buf.toString("latin1");
  }
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

  const drive = DEBUG ? null : clienteDrive();
  let nuevos = 0, existentes = 0;
  const comprobantes: Array<{ c: ComprobanteCpe; xmlUrl: string | null; pdfUrl: string | null }> = [];

  console.log(`\nTipos a consultar: ${TIPOS_CONSULTA.map(t => t.nombre).join(" · ")}`);
  console.log(`Rango: ${FECHA_INICIO} a ${FECHA_FIN}`
    + (TANDAS.length > 1 ? ` — partido en ${TANDAS.length} consultas, una por mes` : ""));

  // Tipo por tipo y, dentro de cada uno, tanda por tanda. Son
  // TIPOS × TANDAS consultas dentro del MISMO login.
  let consultas = 0;
  for (const consulta of TIPOS_CONSULTA) {
    for (const tanda of TANDAS) {
      // Un respiro entre consultas: encadenarlas sin pausa dentro de la misma
      // sesión es justo el patrón que un WAF marca como robot. Va antes de cada
      // una menos la primera, así no se espera de gusto al final.
      if (consultas++ > 0) await page.waitForTimeout(3000);

      const tipo = consulta.nombre;
      console.log(`\n── ${tipo} (${tanda.desde} a ${tanda.hasta}) ──`);
      let filas: FilaBajada[];
      try {
        await abrirModuloConsulta(page, consulta.menu);
        filas = await consultarUnTipo(page, consulta, tanda.desde, tanda.hasta);
      } catch (e) {
        // Una consulta que falla —el portal cambió, se cortó la conexión— no
        // debe tumbar las demás: las otras igual merecen bajarse.
        console.error(`  ✗ ${tipo} (${tanda.desde} a ${tanda.hasta}): ${e instanceof Error ? e.message : e}`);
        continue;
      }

      if (DEBUG || filas.length === 0) continue;

      // Se lee el XML antes de subir para saber, por comprobante, si es
      // Emitida o Recibida y de qué mes es —así cada archivo va directo a su
      // carpeta ordenada, en vez de a una carpeta plana que hay que reordenar
      // después—.
      for (const fila of filas) {
        const xmls = fila.xml ? xmlsDe(fila.xml) : [];
        const c = xmls[0] ? leerComprobanteXml(xmls[0]) : null;
        const origen = c ? origenDe(c, RUC) : "OTRO";
        const periodo = c ? periodoDe(c.fechaEmision) : null;
        const carpetaId = await carpetaDelLote(drive!, origen, periodo);

        let xmlUrl: string | null = null;
        let pdfUrl: string | null = null;
        if (fila.xml) {
          const r = await subirADrive(drive!, carpetaId, fila.xml);
          if (r.estado === "nuevo") nuevos++; else existentes++;
          xmlUrl = r.url;
        }
        if (fila.pdf) {
          const r = await subirADrive(drive!, carpetaId, fila.pdf);
          if (r.estado === "nuevo") nuevos++; else existentes++;
          pdfUrl = r.url;
        }
        if (c) comprobantes.push({ c, xmlUrl, pdfUrl });
      }
    }
  }

  if (DEBUG) {
    console.log("\nModo depuración: no se bajó nada. Revisa el artefacto 'capturas/'.");
  } else {
    if (comprobantes.length === 0) {
      console.log("\nNo se bajó ningún archivo en el rango, en ninguno de los tipos consultados.");
    } else {
      console.log(`\nArchivados en Drive: ${nuevos} nuevos, ${existentes} ya estaban.`);
    }

    // Si no se bajó nada pero la hoja del rango se pidió igual, se entra a la
    // base solo para publicarla: la hoja se arma con lo que hay GUARDADO, así
    // que sale bien aunque esta corrida no haya agregado nada. Sin esto, pedir
    // la hoja de un rango ya descargado terminaba sin hoja y sin explicación.
    //
    // Cuando sí hubo algo que bajar, en cambio, un guardado que falla deja el
    // `null` de siempre y NO se publica nada: una hoja a la que le falta lo de
    // esta corrida es peor que ninguna, porque se lee como completa.
    const sb = comprobantes.length > 0
      ? await guardarDetalle(comprobantes)
      : (HOJA_DEL_RANGO ? await clienteBase() : null);

    if (sb) {
      await publicarLaHojaDetalle(sb);
      if (HOJA_DEL_RANGO) await publicarLaHojaDelRango(sb);
    }
  }
} catch (e) {
  await evidencia(page, "error");
  console.error("✗", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await navegador.close();
}
