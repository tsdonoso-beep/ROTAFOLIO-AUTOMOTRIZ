// Confirmar, comprobante por comprobante, las facturas que la consulta por
// rango de fechas nunca va a traer
//
// `descargar-cpe.mts` usa "Consulta de Facturas y Notas Electrónicas", que
// pide un rango de fechas y trae TODO lo de ese rango... pero solo si es
// serie E001. Confirmado contra el SIRE (`comprobantes_sunat`) el
// 28/09/2026: en agosto, esa pantalla trajo 559 comprobantes y los 559 eran
// serie E, mientras el SIRE tenía 857 más de serie F en el mismo rango. No
// es un bug del scraper ni de la cuenta de SOL que se usa: es la pantalla
// misma la que no ve esa serie, con cualquier usuario.
//
// SÍ hay pantallas que ven otras series, pero al revés: no hay forma de
// pedirles "todo el mes", piden UN comprobante a la vez —RUC del emisor,
// tipo, serie y número—. Por eso este script no le pregunta a SUNAT qué
// existe: eso ya lo sabe el SIRE, que trae RUC+serie+número de cada
// comprobante de compra. Lo que hace este script es RECORRER esa lista y
// confirmar cada uno, uno por uno, contra la pantalla que corresponda.
//
// CUÁL pantalla cambió una vez ya (28/09/2026): «Consultar Factura, Boletas
// y Notas» (Empresas → Comprobantes de pago → Factura Electrónica) sí trae
// el comprobante, pero solo como un reporte HTML de cabecera+ítems, sin XML
// para bajar —«no tiene la validez de una REPRESENTACIÓN IMPRESA»—. La que
// de verdad sirve es «Nueva Consulta de comprobantes de pago» (Empresas →
// Comprobantes de pago → Comprobantes de Pago → Consulta de Comprobantes de
// Pago → …), que abre un modal con export a PDF y XML de verdad. El menú que
// usa este script apunta a esta segunda desde ese cambio de rumbo.
//
// FASE 1 (esta versión): depuración. Todavía no se conoce la estructura real
// de esa pantalla nueva —parece una app aparte (Angular o similar), no las
// de siempre—, así que en DEBUG (por omisión) el script entra, radiografía
// el formulario y sube capturas + HTML de cada paso, sin guardar nada
// todavía. Con esa evidencia se escribe la FASE 2 —llenarlo de verdad, leer
// el resultado y guardarlo en `cpe_comprobante`—, igual que se hizo con
// boletas en `descargar-cpe.mts`.

import { chromium, type Page, type Frame, type Download } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { google } from "googleapis";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { normalizarClavePrivada, correoDeServicio, carpeta, publicarHoja } from "../lib/drive/servidor.ts";
import { leerZip } from "../lib/sunat/zip.ts";
import { leerComprobanteXml, type ComprobanteCpe } from "../lib/sunat/cpe-xml.ts";
import { prepararLote, origenDe, periodoDe, identidad } from "../lib/sunat/cpe-importacion.ts";
import { filasItemsSunat, filaDetalleDesdeRpc, detalleCpeCompleto, TIPOS_ITEMS } from "../lib/export/items-sunat.ts";

function pedir(...nombres: string[]): string {
  for (const n of nombres) { const v = (process.env[n] ?? "").trim(); if (v) return v; }
  console.error(`✗ Falta ${nombres.join(" o ")} en el entorno.`);
  process.exit(1);
}

const RUC = process.env.SUNAT_RUC?.trim() || "20512201611";
// El mismo usuario secundario que ya usa descargar-cpe.mts para boletas: no
// hace falta uno nuevo, y así un solo secreto sirve para las dos cosas.
const USUARIO = pedir("SUNAT_SOL_USUARIO", "SUNAT_INROPRIN_USUARIO");
const CLAVE = pedir("SUNAT_SOL_CLAVE", "SUNAT_INROPRIN_CLAVE");
const USUARIO_SOL = USUARIO.startsWith(RUC) ? USUARIO.slice(RUC.length) : USUARIO;

const DEBUG = process.env.DEBUG !== "0";
const PERIODO = process.env.PERIODO?.trim() || "202609";
// 0 = sin tope. En depuración, unos pocos alcanzan para ver la pantalla de
// resultado; en descarga real, se deja crecer una vez que la fase 2 exista.
const LIMITE = Number(process.env.LIMITE?.trim() || (DEBUG ? "3" : "0"));

const LOGIN_URL = "https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm";

// La misma carpeta de Drive donde descargar-cpe.mts archiva los
// comprobantes: son el mismo tipo de documento (XML+PDF de una factura),
// solo que llegan por una pantalla distinta.
const CARPETA_DRIVE = process.env.SUNAT_DRIVE_FOLDER?.trim() || "1RnyGimYdnhbQ3nKxGOoBc_iRz38fxCnX";

/** Un paso del menú: qué texto clicar y, si hace falta, en qué posición. */
interface PasoMenu { texto: string; posicion?: "primera" | "ultima" }

// CAMBIO DE RUMBO (28/09/2026, tras el run #6): «Consultar Factura, Boletas
// y Notas» (`ol-ti-itconscpegem`, el camino de abajo hasta ahora) SÍ trae el
// comprobante, pero solo como un reporte HTML de cabecera+ítems —«no tiene
// la validez de una REPRESENTACIÓN IMPRESA», sin XML para bajar—. El usuario
// encontró a mano una SEGUNDA pantalla, «Nueva Consulta de comprobantes de
// pago» (otra app: `/app/contribuyentems/servicio/consultacpe/consulta/
// loader/nuevaconsulta.html`, confirmada en el catálogo del menú), cuyo
// resultado abre un modal con cinco íconos —PDF, XML, texto, imprimir,
// correo— y cada uno baja de verdad. Esa es la que hace falta: sin el XML no
// hay detalle de ítems, que es el punto de todo este script.
//
// El camino, sacado del mismo catálogo (`var opciones`) que reveló
// `ol-ti-itconscpegem`: Empresas → Comprobantes de pago (11, tal cual) →
// Comprobantes de Pago (11.38, agrup) → Consulta de Comprobantes de Pago
// (11.38.1, sis) → Nueva Consulta de comprobantes de pago (11.38.1.1.1, el
// programa de verdad).
//
// Dos cosas que ya rompieron el camino anterior y seguramente rompen este
// también si no se las nombra:
//   • «Comprobantes de Pago» (con P mayúscula, el paso 3) es una entrada
//     DISTINTA de «Comprobantes de pago» (el paso 2, p minúscula) —el menú
//     tiene las dos—, pero el buscador de texto no distingue mayúsculas: la
//     búsqueda encuentra las dos a la vez, y la de recién (ya clickeada,
//     todavía visible) aparece antes en el documento. Se pide la ÚLTIMA a
//     propósito, no la que el detector automático de repetidos elegiría —ese
//     detector compara los textos tal cual, y "Comprobantes de pago" ≠
//     "Comprobantes de Pago" como texto, así que no lo vería como repetido—.
//   • «Nueva Consulta de comprobantes de pago» se repite iguaLITO dos veces
//     seguidas (la captura del sidebar del usuario lo muestra así), el mismo
//     patrón categoría-y-enlace-con-el-mismo-nombre que ya se vio con
//     «Consultar Factura, Boletas y Notas»: acá sí lo agarra el detector
//     automático.
//
// AFINAR: no confirmado todavía contra el portal real —hace falta una
// corrida de depuración para saberlo—.
const MENU_INDIVIDUAL: PasoMenu[] = [
  { texto: "Empresas" },
  { texto: "Comprobantes de pago" },
  { texto: "Comprobantes de Pago", posicion: "ultima" },
  // Faltaba este: el run #7 (28/09/2026) saltó directo de «Comprobantes de
  // Pago» a «Nueva Consulta de comprobantes de pago» y no lo encontró —el
  // catálogo del menú (comentario de arriba) dice clarito que entre los dos
  // va esta categoría, 11.38.1—.
  { texto: "Consulta de Comprobantes de Pago" },
  { texto: "Nueva Consulta de comprobantes de pago" },
  { texto: "Nueva Consulta de comprobantes de pago" },
];

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

/** Igual que en descargar-cpe.mts: e-menu a veces corta la conexión. */
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

async function entrar(page: Page) {
  console.log(`Entrando a SOL como ${RUC} / ${USUARIO_SOL}…`);
  await irConReintento(page, LOGIN_URL);
  await page.waitForSelector("#txtRuc", { timeout: 60000 });
  await evidencia(page, "login");

  await page.fill("#txtRuc", RUC);
  await page.fill("#txtUsuario", USUARIO_SOL);
  await page.fill("#txtContrasena", CLAVE);
  await evidencia(page, "login-lleno");

  const boton = (await page.$("#btnAceptar")) ? "#btnAceptar" : "text=Iniciar sesión";
  await page.click(boton);
  await page.waitForURL(/MenuInternet\.htm/i, { timeout: 60000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await evidencia(page, "post-login");

  const cuerpo = (await page.content()).toLowerCase();
  if (/captcha|recaptcha|código de verificación/.test(cuerpo)) {
    throw new Error("El login mostró un captcha/verificación. Revisa 'post-login'.");
  }
  if (/usuario o clave|clave incorrecta|no coinciden/.test(cuerpo)) {
    throw new Error("SOL rechazó las credenciales. Revisa 'post-login'.");
  }
}

/**
 * Hace clic en un texto del menú, pero en el que esté VISIBLE de verdad —no
 * en «el primero que aparece en el HTML»—, y en la posición que corresponda
 * cuando hay más de un visible a la vez.
 *
 * El árbol de SOL repite textos de dos formas distintas:
 *   1. «Factura Electrónica» existe dos veces (una dentro de «SEE - SOL»,
 *      una rama que nunca se despliega, y otra como categoría propia, la
 *      que de verdad lleva a algo). De estas, la copia muerta no está
 *      visible nunca: filtrar por `isVisible()` alcanza.
 *   2. «Consultar Factura, Boletas y Notas» se repite EN EL MISMO camino:
 *      hay una categoría con ese nombre y, adentro, el enlace de verdad
 *      con el mismo nombre otra vez (confirmado por el run del 28/09/2026,
 *      #3: el clic sobre la categoría la deja seleccionada —así se vio en
 *      la captura «formulario-abierto»— pero las DOS veces el código buscó
 *      «la primera visible» y las dos veces cayó en la categoría, que
 *      simplemente se abre y se cierra de nuevo sin avanzar). Para este
 *      caso hace falta pedir la ÚLTIMA visible en la segunda vuelta —la
 *      categoría ya estaba visible antes del clic; el enlace de adentro
 *      recién se vuelve visible después, así que queda más abajo en el
 *      documento—.
 */
async function clicEnAlgunMarco(
  page: Page, texto: string, posicion: "primera" | "ultima" = "primera", timeoutMs = 20000,
): Promise<boolean> {
  const fin = Date.now() + timeoutMs;
  while (Date.now() < fin) {
    for (const f of page.frames()) {
      try {
        const candidatos = f.locator(`text=${texto}`);
        const n = await candidatos.count();
        const visibles: number[] = [];
        for (let i = 0; i < n; i++) {
          if (await candidatos.nth(i).isVisible().catch(() => false)) visibles.push(i);
        }
        if (visibles.length > 0) {
          const idx = posicion === "ultima" ? visibles[visibles.length - 1] : visibles[0];
          await candidatos.nth(idx).click({ timeout: 5000 });
          return true;
        }
      } catch { /* el marco puede estar navegando */ }
    }
    await page.waitForTimeout(500);
  }
  return false;
}

/** Qué entradas de menú ofrece este acceso, para diagnosticar sin adivinar. */
async function radiografiaMenu(page: Page) {
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
 * Qué inputs/selects trae cada frame ahora mismo, con sus opciones.
 *
 * Es la evidencia clave de esta primera fase: de acá salen los `name`/`id`
 * reales para reemplazar los selectores «AFINAR» de `llenarFormulario` por
 * los definitivos.
 */
async function radiografiaFormulario(page: Page) {
  for (const f of page.frames()) {
    let campos: string[] = [];
    try {
      campos = await f.locator("input,select,textarea").evaluateAll(els =>
        els.slice(0, 30).map(el => {
          const e = el as HTMLInputElement | HTMLSelectElement;
          const tag = e.tagName.toLowerCase();
          const tipo = (e as HTMLInputElement).type || "";
          const opts = tag === "select"
            ? " opts=[" + Array.from((e as HTMLSelectElement).options).map(o => `${o.value}:${o.text.trim()}`).join("|") + "]"
            : "";
          return `${tag}#${e.id || "-"}[name=${e.name || "-"} type=${tipo}]${opts}`;
        }));
    } catch { continue; }
    if (campos.length === 0) continue;
    console.log(`\n▚ FRAME ${f.url().slice(0, 90) || "(principal)"}`);
    campos.forEach(c => console.log(`   · ${c}`));
  }
  console.log("");
}

/**
 * Guarda el HTML del frame de RESULTADO (no el de la página principal) y
 * lista sus enlaces/botones con la acción real (`onclick`/`href`).
 *
 * `evidencia()` guarda `page.content()`, que es solo el documento de arriba
 * —el menú—: el resultado vive en un iframe de otro dominio
 * (`ol-ti-itconscpegem`), y `page.content()` no lo trae. El run #6
 * (28/09/2026) mostró la tabla «Factura electrónica recibida» con un ícono
 * «Visualizar» por fila —la pista de cómo se llega al detalle del
 * comprobante—, pero sin el HTML de ESE frame no se puede saber qué hace
 * ese ícono al hacer clic.
 */
async function radiografiaResultado(page: Page, nombreArchivo: string): Promise<void> {
  // Solo por URL, sin respaldo por texto: los runs #6 y #10 (28-29/09/2026)
  // mostraron DOS respaldos por texto distintos («Resultado», luego
  // «Visualizar»/«Factura electrónica»/«Boleta electrónica») haciendo el
  // mismo falso positivo sobre el menú de SOL —tiene que traer alguno de
  // esos textos escondido en algún componente genérico (el buscador del
  // menú, quizás), y ese frame SIEMPRE tiene contenido, así que ganaba la
  // carrera sin que el modal de verdad se hubiera abierto nunca—. Ya se sabe
  // con certeza cuál es la app (e-factura.sunat.gob.pe), así que no hace
  // falta adivinar por texto.
  for (const f of page.frames()) {
    if (!/e-factura\.sunat\.gob\.pe|ol-ti-itconscpegem/i.test(f.url())) continue;

    try {
      writeFileSync(join(CAPTURAS, `${nombreArchivo}.html`), await f.content());
      console.log(`  · HTML del frame de resultado guardado: ${nombreArchivo}.html`);
    } catch (e) {
      console.log(`  · no pude guardar el HTML del resultado: ${e instanceof Error ? e.message : e}`);
    }

    // Angular no deja rastro en `onclick`/`href` —esos atributos casi nunca
    // existen ahí, aunque el elemento sí reaccione a un clic real, porque el
    // manejo del evento vive en el componente, no en el HTML—. El primer
    // intento de esta función filtraba por «sin onclick y sin href», que es
    // justo lo que un botón moderno siempre tiene: se quedó sin nada que
    // mostrar, aunque el frame fuera el correcto (run #12, 29/09/2026). Acá
    // se listan TODOS sin filtrar, con lo que sí suele identificar un botón
    // de ícono en una app moderna: sus clases (los framework de íconos, tipo
    // "pi pi-file-pdf", van ahí) y el `aria-label`/`title`, además del texto.
    try {
      const elementos = await f.locator("a, img, button, [role='button'], i[class*='pi-'], i[class*='icon'], [onclick]").evaluateAll(els =>
        els.slice(0, 40).map(e => {
          const el = e as HTMLElement;
          const texto = (el.textContent || el.getAttribute("alt") || "").replace(/\s+/g, " ").trim().slice(0, 40);
          const titulo = el.getAttribute("title") || el.getAttribute("aria-label") || "";
          const clase = el.getAttribute("class") || "";
          return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""} clase="${clase}" texto="${texto}" title="${titulo}"`;
        }));
      console.log(`  · elementos del resultado (${elementos.length}):`);
      elementos.forEach(a => console.log(`     ↓ ${a}`));
      if (elementos.length === 0) {
        console.log("  · (nada: probablemente el modal no llegó a abrirse — revisa la captura de pantalla)");
      }
    } catch (e) {
      console.log(`  · no pude listar los elementos del resultado: ${e instanceof Error ? e.message : e}`);
    }
    return;
  }
  console.log(`  · no encontré el frame de e-factura entre los actuales: ${page.frames().map(f => f.url() || "(vacío)").join(" | ")}`);
}

async function abrirFormularioIndividual(page: Page) {
  console.log(`Menú → ${MENU_INDIVIDUAL.map(p => p.texto).join(" → ")}…`);
  await irConReintento(page, LOGIN_URL);
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await evidencia(page, "menu-inicio");

  for (const [i, paso] of MENU_INDIVIDUAL.entries()) {
    const { texto } = paso;
    const ultimo = i === MENU_INDIVIDUAL.length - 1;
    // La posición la puede fijar el paso mismo (dos textos distintos que se
    // confunden por mayúsculas, como «Comprobantes de Pago»); si no, el
    // detector automático: si este paso repite EL MISMO texto del anterior
    // —el enlace de adentro con el nombre de su propia categoría—, se pide
    // la última coincidencia visible, no la primera.
    const posicion = paso.posicion ?? (i > 0 && MENU_INDIVIDUAL[i - 1].texto === texto ? "ultima" : "primera");
    // El siguiente paso repite este mismo texto: hay que dejar tiempo de
    // sobra para que el enlace de adentro termine de aparecer antes de
    // buscarlo, no los 1200ms de siempre.
    const siguienteRepite = MENU_INDIVIDUAL[i + 1]?.texto === texto;
    if (await clicEnAlgunMarco(page, texto, posicion)) {
      if (ultimo) {
        // «Nueva Consulta de comprobantes de pago» es una app aparte
        // (`e-factura.sunat.gob.pe`, no `ww1.sunat.gob.pe`) que el run #8
        // (28/09/2026) tardó más de los 3s de siempre en cargar la PRIMERA
        // vez de la corrida —el segundo y el tercer pendiente ya la
        // encontraron con esos 3s, con el navegador "tibio"—. Se espera
        // activamente a que aparezca el campo de RUC en vez de una espera
        // fija, para no repetir ese fallo con una app pesada y sin alargar
        // la corrida cuando carga rápido.
        const fin = Date.now() + 20000;
        while (Date.now() < fin) {
          let listo = false;
          for (const f of page.frames()) {
            if (await f.locator('input[name="rucEmisor"]').count().catch(() => 0)) { listo = true; break; }
          }
          if (listo) break;
          await page.waitForTimeout(500);
        }
      } else {
        await page.waitForTimeout(siguienteRepite ? 2500 : 1200);
        await evidencia(page, `menu-${i}`);
      }
      continue;
    }
    console.log(`  ⚠ no encontré «${texto}» en el menú de este acceso.`);
    await radiografiaMenu(page);
    throw new Error(`No se llegó al formulario: falta «${texto}» en el menú.`);
  }
  // Confirma en el log a qué aplicación se llegó —para el camino nuevo
  // debería ser e-factura.sunat.gob.pe/.../nuevaconsulta/..., no
  // ol-ti-itconscpegem— y no otra por error de camino.
  console.log(`  · frames: ${page.frames().map(f => f.url() || "(vacío)").join(" | ")}`);
  await evidencia(page, "formulario-abierto");
}

interface Pendiente {
  proveedorRuc: string;
  proveedorNombre: string | null;
  tipoComprobante: string;
  serie: string;
  numero: string;
  fechaEmision: string | null;
  total: number | null;
  moneda: string | null;
}

/**
 * Qué etiqueta de «Tipo de comprobante» pedir, para el código de comprobante
 * del SIRE, en el desplegable de «Nueva Consulta de comprobantes de pago»
 * (la pantalla nueva, confirmada por el run #8, 28/09/2026).
 *
 * La captura que trajo el usuario mostró «Factura» ya elegida por omisión en
 * ese desplegable —a diferencia de la pantalla vieja, acá no hace falta
 * distinguir Emitida/Recibida en la ETIQUETA: eso lo dice el radio
 * «Recibido» aparte (`elegirFiltroRecibido`)—.
 */
function etiquetaTipoComprobante(tipoComprobante: string): string {
  const etiquetas: Record<string, string> = {
    "01": "Factura",
    "07": "Nota de Crédito",
    "08": "Nota de Débito",
  };
  return etiquetas[tipoComprobante] ?? "Factura";
}

/**
 * Lo que el SIRE ya sabe que existe, para este período, con serie distinta
 * a E001 —la que la consulta por rango sí cubre—, y que todavía no está en
 * `cpe_comprobante`.
 *
 * Es al revés de como arma la lista `descargar-cpe.mts`: ahí la lista sale
 * de SUNAT y se guarda en la base; acá la lista sale de la base (el SIRE ya
 * la tiene completa) y se usa para preguntarle a SUNAT, comprobante por
 * comprobante, si esta otra pantalla lo puede confirmar.
 *
 * Solo factura, NC y ND (01/07/08): son los únicos tipos que se saben pedir
 * en «Tipo de comprobante» (`etiquetaTipoComprobante`). El run #5
 * (28/09/2026) mostró por qué hace falta filtrar, no solo mapear: los tres
 * primeros pendientes de setiembre por fecha resultaron ser tipo «53» —diez
 * en total ese mes—, con `proveedor_ruc = "0"` y `proveedor_nombre` igual al
 * nombre de la propia empresa: basura del SIRE, no facturas de un proveedor
 * de verdad. Sin este filtro, esas filas se cuelan primero (van ordenadas
 * por fecha) y la consulta las manda con un RUC que nunca va a encontrar
 * nada.
 */
async function pendientes(periodo: string): Promise<Pendiente[]> {
  const url = process.env.SUPABASE_URL || process.env.PROJECT_URL;
  if (!url) { console.error("✗ Falta SUPABASE_URL o PROJECT_URL."); process.exit(1); }
  const key = pedir("SUPABASE_ANON_KEY", "ANON_KEY");
  const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const { error: eLogin } = await sb.auth.signInWithPassword({
    email: pedir("ROBOT_CORREO"), password: pedir("ROBOT_CLAVE"),
  });
  if (eLogin) { console.error("✗ No se pudo entrar a la base:", eLogin.message); process.exit(1); }

  const { data: sire, error: e1 } = await sb
    .from("comprobantes_sunat")
    .select("proveedor_ruc, proveedor_nombre, tipo_comprobante, serie, numero, fecha_emision, total, moneda")
    .eq("empresa_ruc", RUC)
    .eq("periodo", periodo)
    .not("serie", "ilike", "E%")
    .in("tipo_comprobante", ["01", "07", "08"])
    .neq("proveedor_ruc", "0")
    .order("fecha_emision");
  if (e1) { console.error("✗ No se pudo leer comprobantes_sunat:", e1.message); process.exit(1); }

  const { data: yaEstan, error: e2 } = await sb
    .from("cpe_comprobante")
    .select("proveedor_ruc, tipo_comprobante, serie, numero")
    .eq("empresa_ruc", RUC)
    .eq("periodo", periodo);
  if (e2) { console.error("✗ No se pudo leer cpe_comprobante:", e2.message); process.exit(1); }

  const identidad = (c: { proveedor_ruc: string | null; tipo_comprobante: string | null; serie: string | null; numero: string | null }) =>
    `${c.proveedor_ruc}|${c.tipo_comprobante}|${c.serie}|${c.numero}`;
  const vistos = new Set((yaEstan ?? []).map(identidad));

  return (sire ?? [])
    .filter(c => c.proveedor_ruc && c.tipo_comprobante && c.serie && c.numero)
    .filter(c => !vistos.has(identidad(c)))
    .map(c => ({
      proveedorRuc: c.proveedor_ruc as string,
      proveedorNombre: c.proveedor_nombre,
      tipoComprobante: c.tipo_comprobante as string,
      serie: c.serie as string,
      numero: c.numero as string,
      fechaEmision: c.fecha_emision,
      total: c.total,
      moneda: c.moneda,
    }));
}

/**
 * Marca el radio «Recibido».
 *
 * La radiografía del run #8 (28/09/2026) mostró dos radios sin más:
 * `input#emitido[name=radioBoton]` e `input#recibido[name=radioBoton]`. Todo
 * lo que trae `pendientes()` es del registro de COMPRAS, así que siempre es
 * «Recibido» —nunca hace falta elegir «Emitido»—. Se prueba `.check()`
 * primero (lo normal para un radio real) y, si el control está pintado
 * encima por CSS de la app y Playwright lo considera no interactuable, se
 * cae a un clic forzado.
 */
async function elegirFiltroRecibido(marco: Frame): Promise<void> {
  const radio = marco.locator("#recibido").first();
  if (!(await radio.count())) { console.log("  ⚠ no encontré el radio «Recibido»."); return; }
  await radio.check({ timeout: 3000 }).catch(() => radio.click({ force: true, timeout: 3000 }).catch(() => {}));
}

/**
 * Elige la etiqueta en el campo «Tipo de comprobante».
 *
 * El run #12 (29/09/2026) mostró, con captura de pantalla, por qué el
 * intento anterior nunca funcionó: el campo NO es un `<select>` ni un
 * `<input>` de texto de verdad —es un combobox estilizado (con pinta de
 * PrimeNG «p-dropdown»: caja con borde, texto «Seleccionar» y una flechita—.
 * El input de texto sin `name` que se apuntaba antes debe ser un proxy
 * oculto para el envío del formulario, no lo que el usuario ve ni con lo que
 * interactúa: clicarlo no abre nada. El resultado quedó tal cual —«El tipo
 * de comprobante es obligatorio»—, con RUC, serie y número ya bien puestos.
 *
 * Se clica el texto visible «Seleccionar» —el placeholder del combobox
 * vacío— y se busca la opción entre los contenedores típicos de un
 * desplegable moderno (`li`, `[role="option"]`, `.p-dropdown-item`).
 */
async function elegirTipoComprobante(marco: Frame, etiqueta: string): Promise<void> {
  const campo = marco.getByText("Seleccionar", { exact: true }).first();
  if (!(await campo.count())) {
    console.log("  ⚠ no encontré el combobox de «Tipo de comprobante» (¿ya no dice «Seleccionar»?).");
    return;
  }
  await campo.click().catch(() => {});
  await marco.page().waitForTimeout(600);

  const opcion = marco.locator(
    `li:has-text("${etiqueta}"), [role="option"]:has-text("${etiqueta}"), .p-dropdown-item:has-text("${etiqueta}"), .ui-menu-item:has-text("${etiqueta}"), option:has-text("${etiqueta}")`
  ).first();
  if (await opcion.count()) {
    await opcion.click().catch(() => {});
  } else {
    console.log(`  ⚠ el combobox se abrió (o no) pero no encontré la opción "${etiqueta}" adentro.`);
  }
  await marco.page().waitForTimeout(300);
}

/**
 * Llena «Nueva Consulta de comprobantes de pago» con un pendiente.
 *
 * Los `name` son los que confirmó la radiografía del run #8 (28/09/2026)
 * contra `e-factura.sunat.gob.pe`: `rucEmisor`, `serieComprobante`,
 * `numeroComprobante`, más el radio y el campo de tipo sin `name` que
 * manejan las dos funciones de arriba.
 */
async function llenarFormulario(page: Page, p: Pendiente): Promise<Frame | null> {
  for (const f of page.frames()) {
    const rucInput = f.locator('input[name="rucEmisor"]').first();
    if (!(await rucInput.count())) continue;

    try {
      await elegirFiltroRecibido(f);
      await elegirTipoComprobante(f, etiquetaTipoComprobante(p.tipoComprobante));
      await rucInput.fill(p.proveedorRuc);
      await f.locator('input[name="serieComprobante"]').first().fill(p.serie);
      await f.locator('input[name="numeroComprobante"]').first().fill(p.numero);
      return f;
    } catch (e) {
      console.log(`  ⚠ no pude llenar el formulario: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }
  console.log("  ⚠ no encontré el campo de RUC en ningún frame.");
  return null;
}

/** Botón que muestra el resultado: «Consultar» o «Buscar», según la versión. */
async function clicConsultar(marco: Frame) {
  const intentos = [
    () => marco.locator('input[value="Consultar"], input[value="Buscar"]'),
    () => marco.getByRole("button", { name: /consultar|buscar/i }),
    () => marco.locator('button:has-text("Consultar"), button:has-text("Buscar")'),
  ];
  for (const get of intentos) {
    const loc = get().first();
    if (await loc.count()) { await loc.click({ timeout: 10000 }).catch(() => {}); return; }
  }
  console.log("  ⚠ no encontré el botón Consultar/Buscar.");
}

// ── FASE 2: bajar de verdad, archivar y guardar ─────────────────────

interface ArchivoBajado { nombre: string; datos: Buffer; tipo: string }

/** Dispara una descarga y la devuelve como buffer con su nombre. Igual que en descargar-cpe.mts. */
async function bajar(page: Page, accion: () => Promise<void>): Promise<ArchivoBajado> {
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

/**
 * Descarga el XML y el PDF del modal «Resultado».
 *
 * Los botones no tienen texto ni `onclick` —son íconos de Angular—, pero sí
 * un `ngbtooltip` con el nombre de la acción, confirmado por el HTML real
 * del run #13 (29/09/2026): «Descargar PDF», «Descargar XML», «Descargar
 * CDR» (el acuse de SUNAT, que no hace falta acá), «Imprimir», «Enviar
 * Correo». Ese atributo es un selector mucho más firme que cualquier clase
 * de Angular, que cambia de una versión a otra del build.
 */
async function descargarXmlYPdf(page: Page, marco: Frame): Promise<{ xml: ArchivoBajado | null; pdf: ArchivoBajado | null }> {
  let xml: ArchivoBajado | null = null;
  let pdf: ArchivoBajado | null = null;

  const botonXml = marco.locator('button[ngbtooltip="Descargar XML"]').first();
  if (await botonXml.count()) {
    try { xml = await bajar(page, () => botonXml.click()); }
    catch (e) { console.log(`  · no se pudo bajar el XML: ${e instanceof Error ? e.message : e}`); }
  } else {
    console.log("  ⚠ no encontré el botón «Descargar XML» en el modal.");
  }

  const botonPdf = marco.locator('button[ngbtooltip="Descargar PDF"]').first();
  if (await botonPdf.count()) {
    try { pdf = await bajar(page, () => botonPdf.click()); }
    catch (e) { console.log(`  · no se pudo bajar el PDF: ${e instanceof Error ? e.message : e}`); }
  } else {
    console.log("  ⚠ no encontré el botón «Descargar PDF» en el modal.");
  }

  return { xml, pdf };
}

/** El o los XML que trae una descarga: sueltos o dentro de un ZIP. Igual que en descargar-cpe.mts. */
function xmlsDe(f: ArchivoBajado): string[] {
  if (/\.zip$/i.test(f.nombre)) {
    return leerZip(f.datos).filter(a => /\.xml$/i.test(a.nombre)).map(a => decodificar(a.contenido));
  }
  if (/\.xml$/i.test(f.nombre)) return [decodificar(f.datos)];
  return [];
}

/** Decodifica por lo que los bytes SON, no por lo que el XML dice que son. Igual que en descargar-cpe.mts. */
function decodificar(buf: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return buf.toString("latin1");
  }
}

function clienteDrive() {
  const email = correoDeServicio(process.env.GOOGLE_SA_EMAIL, process.env.GOOGLE_SA_PRIVATE_KEY);
  const key = normalizarClavePrivada(process.env.GOOGLE_SA_PRIVATE_KEY);
  if (!email || !key) { console.error("✗ Faltan GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY."); process.exit(1); }
  const auth = new google.auth.JWT({ email, key, scopes: ["https://www.googleapis.com/auth/drive"] });
  return google.drive({ version: "v3", auth });
}

/** Sube un archivo sin repetir el que ya está. Igual que en descargar-cpe.mts. */
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
 * Reintenta una llamada a Drive si el cupo de la API se llenó («User rate
 * limit exceeded», 403/429) —confirmado por el run #16 (29/09/2026): tumbó
 * la corrida entera en el pendiente 47/100 justo ahí—. Ese cupo se despeja
 * solo en unos segundos; perder el comprobante entero por eso, después de ya
 * haberlo confirmado y bajado de SUNAT (lo caro), sería tirar todo por el
 * paso más barato de reintentar.
 */
async function conReintentoDeCupo<T>(fn: () => Promise<T>, intentos = 4): Promise<T> {
  let ultimo: unknown;
  for (let i = 1; i <= intentos; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/rate limit|quota|429/i.test(msg) || i === intentos) throw e;
      ultimo = e;
      console.log(`  · cupo de Drive lleno, reintento ${i}/${intentos} en ${5 * i}s: ${msg.split("\n")[0]}`);
      await new Promise(r => setTimeout(r, 5000 * i));
    }
  }
  throw ultimo;
}

const carpetasPorRuta = new Map<string, Promise<string>>();
/** La carpeta para un origen y un período, cacheada. Igual que en descargar-cpe.mts. */
async function carpetaDelLote(
  drive: ReturnType<typeof clienteDrive>, origen: "RECIBIDO" | "EMITIDO" | "OTRO", periodo: string | null
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

/** Entra a la base como el robot. `null` si falla, que es un aviso, no un motivo para tumbar la corrida. */
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
 * Guarda el lote de comprobantes confirmados en `cpe_comprobante`, y
 * devuelve el cliente ya logueado como el robot para que el llamador pueda
 * reusarlo y publicar la hoja de detalle sin loguearse de nuevo.
 *
 * Mismo `guardar_cpe` que usa `descargar-cpe.mts`: un comprobante que ya
 * estaba se actualiza en vez de duplicarse, así que repetir un rango ya
 * confirmado no hace daño.
 */
async function guardarLote(
  comprobantes: Array<{ c: ComprobanteCpe; xmlUrl: string | null; pdfUrl: string | null }>
): Promise<SupabaseClient | null> {
  if (comprobantes.length === 0) return null;
  const lote = prepararLote(comprobantes.map(x => x.c), RUC);
  if (lote.length === 0) return null;

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
  console.log(`Guardado en cpe_comprobante: ${r?.nuevos} nuevos, ${r?.actualizados} actualizados, ${r?.items} ítems.`);
  return sb;
}

/**
 * Deja la hoja «COMPROBANTES SUNAT - DETALLE» al día, igual que hace
 * `descargar-cpe.mts` tras guardar.
 *
 * Sin esto, la hoja se queda como quedó la última vez que alguien la miró
 * —justo lo que se quería evitar al automatizar—. Es opcional: si faltan las
 * credenciales de Drive, el detalle igual quedó guardado en la base y solo
 * se salta la publicación.
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

// ── Principal ─────────────────────────────────────────────────────

const navegador = await chromium.launch({
  headless: true,
  args: ["--disable-blink-features=AutomationControlled"],
});
const contexto = await navegador.newContext({
  acceptDownloads: true,
  locale: "es-PE",
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
});
const page = await contexto.newPage();

try {
  const lista = await pendientes(PERIODO);
  const aProcesar = LIMITE > 0 ? lista.slice(0, LIMITE) : lista;
  console.log(`Pendientes de serie no-E001 en ${PERIODO}: ${lista.length}. Se procesan: ${aProcesar.length}${DEBUG ? " (depuración)" : ""}.`);
  if (aProcesar.length === 0) { console.log("Nada que hacer."); process.exit(0); }

  await entrar(page);

  const drive = DEBUG ? null : clienteDrive();
  let nuevos = 0, existentes = 0, confirmados = 0;
  let comprobantes: Array<{ c: ComprobanteCpe; xmlUrl: string | null; pdfUrl: string | null }> = [];

  // El run #16 (29/09/2026) mostró por qué guardar todo junto al final es
  // frágil: un cupo de API lleno en el pendiente 47/100 tumbó la corrida
  // entera, y como `guardarLote` recién se llamaba DESPUÉS del for, los 46
  // confirmados y ya archivados en Drive antes de ese punto no llegaron a
  // `cpe_comprobante` —trabajo hecho pero no guardado—. Ahora se vuelca a la
  // base cada tantos confirmados, así una corrida grande solo arriesga el
  // último lote parcial, no todo lo caminado.
  const LOTE_GUARDADO = 20;
  async function volcar(): Promise<void> {
    if (comprobantes.length === 0) return;
    const sb = await guardarLote(comprobantes);
    if (sb) await publicarLaHojaDetalle(sb);
    comprobantes = [];
  }

  for (const [i, p] of aProcesar.entries()) {
    console.log(`\n── ${i + 1}/${aProcesar.length}: ${p.proveedorNombre ?? p.proveedorRuc} · ${p.tipoComprobante} ${p.serie}-${p.numero} ──`);
    try {
      await abrirFormularioIndividual(page);
      if (DEBUG) await radiografiaFormulario(page);

      const marco = await llenarFormulario(page, p);
      await evidencia(page, `form-lleno-${p.serie}-${p.numero}`);
      if (marco) {
        await clicConsultar(marco);
        await page.waitForTimeout(2000);
        await evidencia(page, `resultado-${p.serie}-${p.numero}`);
        if (DEBUG) {
          await radiografiaResultado(page, `resultado-html-${p.serie}-${p.numero}`);
        } else {
          // El modal «Resultado» se abre DENTRO del mismo frame que ya
          // teníamos (es una app de una sola página, sin navegar a otro
          // lado), así que el `marco` de siempre sirve para buscar los
          // botones de descarga.
          const { xml: xmlArchivo, pdf: pdfArchivo } = await descargarXmlYPdf(page, marco);
          const xmls = xmlArchivo ? xmlsDe(xmlArchivo) : [];
          const c = xmls[0] ? leerComprobanteXml(xmls[0]) : null;

          if (!c) {
            console.log("  ⚠ no se pudo leer el XML de este comprobante; no se guarda nada de este.");
          } else {
            const origen = origenDe(c, RUC);
            const periodo = periodoDe(c.fechaEmision);
            const carpetaId = await carpetaDelLote(drive!, origen, periodo);

            let xmlUrl: string | null = null;
            let pdfUrl: string | null = null;
            if (xmlArchivo) {
              const r = await conReintentoDeCupo(() => subirADrive(drive!, carpetaId, xmlArchivo));
              if (r.estado === "nuevo") nuevos++; else existentes++;
              xmlUrl = r.url;
            }
            if (pdfArchivo) {
              const r = await conReintentoDeCupo(() => subirADrive(drive!, carpetaId, pdfArchivo));
              if (r.estado === "nuevo") nuevos++; else existentes++;
              pdfUrl = r.url;
            }
            comprobantes.push({ c, xmlUrl, pdfUrl });
            confirmados++;
            console.log(`  · confirmado y archivado: ${c.serie}-${c.numero}, ${c.moneda} ${c.total}.`);
          }
        }
      }
    } catch (e) {
      // Un pendiente puntual (SUNAT lento, un selector que no aparece esta
      // vez) no debe tirar los 99 restantes: se anota, se sigue con el
      // siguiente, y lo ya confirmado hasta acá igual se guarda en el
      // próximo volcado.
      console.log(`  ✗ este pendiente falló, se sigue con el resto: ${e instanceof Error ? e.message : e}`);
      await evidencia(page, `error-${p.serie}-${p.numero}`);
    }

    if (!DEBUG && comprobantes.length >= LOTE_GUARDADO) await volcar();

    // Espaciar las solicitudes: el mismo motivo que en descargar-cpe.mts, y
    // acá con más razón —una consulta por CADA comprobante, no una por mes,
    // así que el volumen de solicitudes a SUNAT es mucho mayor—.
    await page.waitForTimeout(1500);
  }

  if (DEBUG) {
    console.log(`\nListo: se revisaron ${aProcesar.length} de ${lista.length} pendientes de ${PERIODO}.`);
    console.log("Modo depuración: revisa el artefacto 'capturas/' antes de correr con DEBUG=0.");
  } else {
    await volcar();
    console.log(`\nArchivados en Drive: ${nuevos} nuevos, ${existentes} ya estaban.`);
    console.log(`Listo: se confirmaron ${confirmados} de ${aProcesar.length} pendientes procesados (de ${lista.length} en ${PERIODO}).`);
  }
} catch (e) {
  await evidencia(page, "error");
  console.error("✗", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await navegador.close();
}
