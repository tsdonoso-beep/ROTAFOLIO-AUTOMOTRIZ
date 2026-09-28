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
// La pantalla «Consultar Factura, Boletas y Notas» (menú Empresas →
// Comprobantes de pago → Factura Electrónica) SÍ ve otras series, pero al
// revés: no hay forma de pedirle "todo el mes", pide UN comprobante a la
// vez —RUC del emisor, tipo, serie y número—. Por eso este script no le
// pregunta a SUNAT qué existe: eso ya lo sabe el SIRE, que trae RUC+serie+
// número de cada comprobante de compra. Lo que hace este script es RECORRER
// esa lista y confirmar cada uno, uno por uno, contra esta pantalla.
//
// FASE 1 (esta versión): depuración. Todavía no se sabe qué trae la
// pantalla de resultado —¿un enlace de XML? ¿solo texto en pantalla?—, así
// que en DEBUG (por omisión) el script entra, llena el formulario con los
// primeros pendientes (LIMITE de ellos) y sube capturas + HTML de cada
// resultado, sin guardar nada todavía. Con esa evidencia se escribe la
// FASE 2 —leer el resultado de verdad y guardarlo en `cpe_comprobante`—,
// igual que se hizo con boletas en `descargar-cpe.mts`.

import { chromium, type Page, type Frame } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

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

// El camino de verdad son los cinco pasos de la captura original. El HTML
// del segundo run trajo, en un <script>, el catálogo completo del menú
// (`var opciones=...`) con la URL de cada programa —ahí se ve que
// «Consultar Factura, Boletas y Notas» (11.9.5.1.1) abre
// `/ol-ti-itconscpegem/consultar.do`, una aplicación DISTINTA de las dos que
// ya usa `descargar-cpe.mts` (`...itconscpemype` para facturas,
// `...itconscpemypebve` para boletas)—.
//
// El primer run sacó el paso de «Factura Electrónica» creyendo que no era
// clicable; el segundo, sin ese paso, tampoco encontró «Consultar Factura,
// Boletas y Notas». La razón real, que el mismo HTML delató: «Factura
// Electrónica» aparece DOS VECES en el árbol —una dentro de «SEE - SOL» (una
// rama muerta, sin nada debajo) y otra como categoría propia, la que sí
// lleva a lo que buscamos—. `clicEnAlgunMarco` tomaba «la primera que
// encuentra» sin mirar si está visible, y agarraba la copia muerta. La
// arregla eso, no el camino: el camino correcto siempre fue este de cinco.
const MENU_INDIVIDUAL = [
  "Empresas",
  "Comprobantes de pago",
  "Factura Electrónica",
  "Consultar Factura, Boletas y Notas",
  "Consultar Factura, Boletas y Notas",
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

async function abrirFormularioIndividual(page: Page) {
  console.log(`Menú → ${MENU_INDIVIDUAL.join(" → ")}…`);
  await irConReintento(page, LOGIN_URL);
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await evidencia(page, "menu-inicio");

  for (const [i, texto] of MENU_INDIVIDUAL.entries()) {
    const ultimo = i === MENU_INDIVIDUAL.length - 1;
    // Si este paso repite el texto del anterior —el caso de «Consultar
    // Factura, Boletas y Notas» dos veces seguidas—, la categoría ya quedó
    // visible con el clic previo: el enlace de adentro es el que hace falta
    // ahora, y ese es el que aparece último, no el primero.
    const posicion = i > 0 && MENU_INDIVIDUAL[i - 1] === texto ? "ultima" : "primera";
    // El siguiente paso repite este mismo texto: hay que dejar tiempo de
    // sobra para que el enlace de adentro termine de aparecer antes de
    // buscarlo, no los 1200ms de siempre.
    const siguienteRepite = MENU_INDIVIDUAL[i + 1] === texto;
    if (await clicEnAlgunMarco(page, texto, posicion)) {
      await page.waitForTimeout(ultimo ? 3000 : siguienteRepite ? 2500 : 1200);
      if (!ultimo) await evidencia(page, `menu-${i}`);
      continue;
    }
    console.log(`  ⚠ no encontré «${texto}» en el menú de este acceso.`);
    await radiografiaMenu(page);
    throw new Error(`No se llegó al formulario: falta «${texto}» en el menú.`);
  }
  // Confirma en el log que se aterrizó en /ol-ti-itconscpegem —la aplicación
  // que el catálogo del menú (visto en el HTML del segundo run) dice que le
  // corresponde a esta consulta— y no en alguna otra por error de camino.
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
 * Qué etiqueta de «Tipo de Consulta» pedir, para el código de comprobante
 * del SIRE.
 *
 * Todo lo que trae `pendientes()` es del registro de COMPRAS —siempre
 * «Recibidas»—, así que no hace falta distinguir Emitida/Recibida acá: son
 * las mismas seis etiquetas que ya usa `descargar-cpe.mts` contra la otra
 * pantalla. La captura del run #4 (28/09/2026) mostró el campo «Tipo de
 * Consulta» en «FE Emitidas» por omisión —así que el catálogo de nombres es
 * el mismo— y la radiografía confirmó que es el MISMO widget de las dos
 * pantallas: `criterio.tipoConsulta` (visible) + `tipoConsulta` (oculto).
 */
function etiquetaTipoConsulta(tipoComprobante: string): string {
  const etiquetas: Record<string, string> = {
    "01": "FE Recibidas",
    "07": "NC Recibidas",
    "08": "ND Recibidas",
  };
  return etiquetas[tipoComprobante] ?? "FE Recibidas";
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
 * Solo factura, NC y ND (01/07/08): son los únicos tipos que esta pantalla
 * ofrece en «Tipo de Consulta» (`etiquetaTipoConsulta`). El run #5
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
 * Elige la etiqueta en el campo «Tipo de Consulta».
 *
 * Es el mismo widget que `elegirTipo` maneja en descargar-cpe.mts (un
 * combobox: input visible `criterio.tipoConsulta` + un campo que lleva el
 * valor real `tipoConsulta`), confirmado por la radiografía del run #4.
 * Acá no se verifica contra un código oculto —los de esta pantalla no se
 * conocen todavía— porque, a diferencia de allá, un tipo elegido de más no
 * arriesga bajar cientos de filas equivocadas: esto pide UN comprobante
 * puntual, y si el tipo quedó mal la consulta simplemente no va a
 * encontrarlo.
 */
async function elegirTipoConsulta(marco: Frame, etiqueta: string): Promise<void> {
  const visible = marco.locator('[id="criterio.tipoConsulta"]').first();
  if (!(await visible.count())) { console.log("  ⚠ no encontré el campo de «Tipo de Consulta»."); return; }
  await visible.click().catch(() => {});
  await marco.page().waitForTimeout(800);

  const opcion = marco.locator(
    `li:has-text("${etiqueta}"), .ui-menu-item:has-text("${etiqueta}"), option:has-text("${etiqueta}"), a:has-text("${etiqueta}")`
  ).first();
  if (await opcion.count()) {
    await opcion.click().catch(() => {});
  } else {
    await visible.fill(etiqueta).catch(() => {});
    await visible.press("Enter").catch(() => {});
  }
  await marco.page().waitForTimeout(300);
}

/**
 * Llena el formulario de «Consultar Factura, Boletas y Notas» con un
 * pendiente.
 *
 * Los ids son los que confirmó la radiografía del run #4 (28/09/2026) contra
 * el portal real. Antes de esto hubo un intento por `name*="ruc"` que cayó
 * en el campo OCULTO `formArchivo.ruc` —esta pantalla tiene dos campos
 * llamados «ruc»: uno oculto para el POST y el visible de verdad,
 * `criterio.ruc` (con `name=rucEmisor`)—, y el genérico lo encontraba
 * primero por aparecer antes en el documento.
 */
async function llenarFormulario(page: Page, p: Pendiente): Promise<Frame | null> {
  for (const f of page.frames()) {
    const rucInput = f.locator('[id="criterio.ruc"]').first();
    if (!(await rucInput.count())) continue;

    try {
      await elegirTipoConsulta(f, etiquetaTipoConsulta(p.tipoComprobante));
      await rucInput.fill(p.proveedorRuc);
      await f.locator('[id="criterio.serie"]').first().fill(p.serie);
      await f.locator('[id="criterio.numero"]').first().fill(p.numero);
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

  for (const [i, p] of aProcesar.entries()) {
    console.log(`\n── ${i + 1}/${aProcesar.length}: ${p.proveedorNombre ?? p.proveedorRuc} · ${p.tipoComprobante} ${p.serie}-${p.numero} ──`);
    await abrirFormularioIndividual(page);
    if (DEBUG) await radiografiaFormulario(page);

    const marco = await llenarFormulario(page, p);
    await evidencia(page, `form-lleno-${p.serie}-${p.numero}`);
    if (marco) {
      await clicConsultar(marco);
      await page.waitForTimeout(2000);
      await evidencia(page, `resultado-${p.serie}-${p.numero}`);
      if (DEBUG) await radiografiaFormulario(page);
    }

    if (!DEBUG) {
      // FASE 2 (todavía no escrita): leer el resultado de esta pantalla y
      // guardarlo en cpe_comprobante. Falta ver, con la evidencia de arriba,
      // qué trae de verdad —de ahí sale si hay XML que bajar o solo datos
      // en pantalla, y cómo se leen—.
      console.log("  · fase 2 pendiente: por ahora esto solo confirma, no guarda.");
    }

    // Espaciar las solicitudes: el mismo motivo que en descargar-cpe.mts, y
    // acá con más razón —una consulta por CADA comprobante, no una por mes,
    // así que el volumen de solicitudes a SUNAT es mucho mayor—.
    await page.waitForTimeout(1500);
  }

  console.log(`\nListo: se revisaron ${aProcesar.length} de ${lista.length} pendientes de ${PERIODO}.`);
  if (DEBUG) console.log("Modo depuración: revisa el artefacto 'capturas/' antes de correr con DEBUG=0.");
} catch (e) {
  await evidencia(page, "error");
  console.error("✗", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await navegador.close();
}
