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
  for (const f of page.frames()) {
    let esResultado = false;
    try {
      esResultado = (await f.locator("text=Visualizar").count()) > 0
        || (await f.locator("text=Factura electrónica").count()) > 0
        || (await f.locator("text=Boleta electrónica").count()) > 0
        // El modal de «Nueva Consulta de comprobantes de pago» (la captura
        // del usuario, run #8): se abre con el título «Resultado» y los
        // íconos de PDF/XML/imprimir/correo.
        || (await f.locator("text=Resultado").count()) > 0;
    } catch { continue; }
    if (!esResultado) continue;

    try {
      writeFileSync(join(CAPTURAS, `${nombreArchivo}.html`), await f.content());
      console.log(`  · HTML del frame de resultado guardado: ${nombreArchivo}.html`);
    } catch (e) {
      console.log(`  · no pude guardar el HTML del resultado: ${e instanceof Error ? e.message : e}`);
    }

    try {
      const acciones = await f.locator("a, img, button, [onclick]").evaluateAll(els =>
        els.slice(0, 30).map(e => {
          const el = e as HTMLElement;
          const texto = (el.textContent || el.getAttribute("alt") || el.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 40);
          const onclick = el.getAttribute("onclick") || "";
          const href = el.getAttribute("href") || "";
          return `${el.tagName.toLowerCase()} "${texto}" onclick="${onclick}" href="${href}"`;
        }).filter(s => !/onclick=""\s+href=""$/.test(s)));
      console.log("  · elementos con acción en el resultado:");
      acciones.forEach(a => console.log(`     ↓ ${a}`));
    } catch (e) {
      console.log(`  · no pude listar los enlaces del resultado: ${e instanceof Error ? e.message : e}`);
    }
    return;
  }
  console.log("  · no encontré un frame con el resultado (¿no encontró el comprobante?).");
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
 * La radiografía del run #8 mostró un input de texto sin `name` propio
 * (`name=""`, entre `rucEmisor` y `serieComprobante`) para este campo: no es
 * un `<select>`, así que se maneja como un combobox —clic para abrir y clic
 * en la opción—, igual que los de las pantallas JSP, pero buscando la
 * opción entre los contenedores típicos de un combobox moderno
 * (`[role="option"]`, `li`) además de los de siempre, porque esta es una app
 * distinta (Angular o similar) y no se sabe todavía cuál usa.
 */
async function elegirTipoComprobante(marco: Frame, etiqueta: string): Promise<void> {
  const campo = marco.locator('input[type="text"][name=""]').first();
  if (!(await campo.count())) { console.log("  ⚠ no encontré el campo de «Tipo de comprobante»."); return; }
  await campo.click().catch(() => {});
  await marco.page().waitForTimeout(600);

  const opcion = marco.locator(
    `[role="option"]:has-text("${etiqueta}"), li:has-text("${etiqueta}"), .ui-menu-item:has-text("${etiqueta}"), option:has-text("${etiqueta}")`
  ).first();
  if (await opcion.count()) {
    await opcion.click().catch(() => {});
  } else {
    await campo.fill(etiqueta).catch(() => {});
    await campo.press("Enter").catch(() => {});
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
      if (DEBUG) await radiografiaResultado(page, `resultado-html-${p.serie}-${p.numero}`);
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
