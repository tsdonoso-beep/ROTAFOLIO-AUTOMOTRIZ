// Sesión de SOL con Playwright: navegador, login, menú hasta «Nueva Consulta» y el token de api-cpe.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page, type Frame } from "playwright";
import { credencialesSol, HEADLESS, LOGIN_URL, RUC } from "../comun/config.mts";
import { dormir, primeraLinea, type Bitacora } from "../comun/bitacora.mts";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export async function abrirNavegador(): Promise<Browser> {
  return chromium.launch({ headless: HEADLESS, args: ["--disable-blink-features=AutomationControlled"] });
}

export async function nuevoContexto(nav: Browser): Promise<BrowserContext> {
  return nav.newContext({ acceptDownloads: true, locale: "es-PE", userAgent: USER_AGENT });
}

export class ErrorSesion extends Error {
  constructor(m: string) {
    super(m);
    this.name = "ErrorSesion";
  }
}

export async function irConReintento(b: Bitacora, page: Page, url: string, quien: string, intentos = 4): Promise<void> {
  let ultimo: unknown;
  for (let i = 1; i <= intentos; i++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      return;
    } catch (e) {
      ultimo = e;
      b.log("aviso", quien, `ir a ${url} falló (${i}/${intentos}): ${primeraLinea(e)}`);
      await dormir(3000 * i);
    }
  }
  throw ultimo;
}

/**
 * Login en SOL. Si la sesión del contexto ya está viva, el menú aparece sin
 * formulario de ingreso: eso también cuenta como «entró» (el re-login de la
 * primera versión esperaba #txtRuc 60 s y fallaba justamente por eso).
 */
export async function entrar(b: Bitacora, page: Page, quien: string): Promise<void> {
  const { usuario, clave } = credencialesSol();
  b.log("info", quien, `entrando a SOL como ${RUC} / ${usuario}`);
  await irConReintento(b, page, LOGIN_URL, quien);
  const hay = await page
    .waitForSelector("#txtRuc", { timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  if (!hay) {
    if (/MenuInternet/i.test(page.url())) {
      b.log("info", quien, "la sesión ya estaba abierta");
      return;
    }
    throw new ErrorSesion(`sin formulario de ingreso ni menú en ${page.url()}`);
  }
  await page.fill("#txtRuc", RUC);
  await page.fill("#txtUsuario", usuario);
  await page.fill("#txtContrasena", clave);
  await page.click((await page.$("#btnAceptar")) ? "#btnAceptar" : "text=Iniciar sesión");
  // Se espera a VER el menú, no a que la URL cambie: esperar la URL espera
  // además el «load» completo, que en GitHub Actions tardaba 64 s.
  //
  // A veces la autenticación de SUNAT termina en su portada
  // (api-seguridad.sunat.gob.pe/?state=&code=…, «Bienvenidos a SUNAT», con el
  // «state» vacío: perdió a dónde volver) en vez de en el menú. Se pide el menú
  // de nuevo y, si vuelve el formulario de ingreso, se llena otra vez. El
  // 04/10/2026 la segunda vuelta TAMBIÉN cayó en la portada y, como solo se
  // manejaba una, la corrida murió: ahora se repite hasta VUELTAS_PORTADA veces.
  const VUELTAS_PORTADA = 3;
  const t0 = Date.now();
  let ultimaAccion = Date.now();
  let vueltas = 0;
  let llenadoEnVuelta = 0;
  while (Date.now() - t0 < 150000) {
    if (await menuVisible(page)) {
      b.log("info", quien, `sesión abierta en ${((Date.now() - t0) / 1000).toFixed(0)} s` + (vueltas ? ` (tras ${vueltas} vuelta(s) por la portada)` : ""));
      return;
    }
    if (Date.now() - ultimaAccion > 5000 && ES_PORTADA_SEGURIDAD.test(page.url())) {
      if (vueltas >= VUELTAS_PORTADA) break;
      vueltas++;
      b.log("aviso", quien, `la autenticación quedó en la portada de SUNAT; se pide el menú de nuevo (${vueltas}/${VUELTAS_PORTADA})`);
      await irConReintento(b, page, LOGIN_URL, quien).catch(() => {});
      ultimaAccion = Date.now();
      continue;
    }
    // Si al pedir el menú vuelve el formulario de ingreso, se llena una vez por vuelta.
    if (vueltas > llenadoEnVuelta && (await ingresoVisible(page))) {
      llenadoEnVuelta = vueltas;
      b.log("aviso", quien, "volvió el formulario de ingreso; se ingresa otra vez");
      await page.fill("#txtRuc", RUC);
      await page.fill("#txtUsuario", usuario);
      await page.fill("#txtContrasena", clave);
      await page.click((await page.$("#btnAceptar")) ? "#btnAceptar" : "text=Iniciar sesión");
      ultimaAccion = Date.now();
      continue;
    }
    const texto = (
      await page
        .locator("body")
        .innerText({ timeout: 2000 })
        .catch(() => "")
    ).toLowerCase();
    if (/captcha|código de verificación/.test(texto)) {
      await guardarEvidencia(b, page, "login-captcha");
      throw new ErrorSesion("el login mostró un captcha");
    }
    // Solo el mensaje de error real: el formulario trae el enlace «¿Olvidaste tu usuario o clave?».
    if (/(usuario|clave)[^.\n]{0,40}(incorrect|inv[aá]lid|no coincide)|no coinciden/.test(texto))
      throw new ErrorSesion("SOL rechazó las credenciales");
    await page.waitForTimeout(500);
  }
  await guardarEvidencia(b, page, "login-sin-menu");
  throw new ErrorSesion(`después del login no apareció el menú (${vueltas} vuelta(s) por la portada; ${page.url().slice(0, 120)})`);
}

/** La portada del servicio de autenticación de SUNAT (a veces el login termina ahí en vez de en el menú). */
const ES_PORTADA_SEGURIDAD = /^https:\/\/api-seguridad\.sunat\.gob\.pe\/?(\?|$)/i;

/** El formulario de ingreso, VISIBLE. Solo existir no basta: la página del menú puede traerlo escondido. */
async function ingresoVisible(page: Page): Promise<boolean> {
  return page
    .locator("#txtRuc")
    .first()
    .isVisible()
    .catch(() => false);
}

/** El menú de SOL a la vista: «Bienvenido, …» arriba, o «Empresas» en algún recuadro. */
export async function menuVisible(page: Page): Promise<boolean> {
  if (page.isClosed() || (await ingresoVisible(page))) return false;
  const texto = await page
    .locator("body")
    .innerText({ timeout: 2000 })
    .catch(() => "");
  if (/Bienvenido,/i.test(texto)) return true;
  for (const f of page.frames()) {
    const visible = await f
      .getByText("Empresas", { exact: true })
      .first()
      .isVisible()
      .catch(() => false);
    if (visible) return true;
  }
  return false;
}

/** Captura, HTML y URL de la pestaña en logs/<corrida>/errores/: en GitHub quedan en el artefacto de bitácoras. */
export async function guardarEvidencia(b: Bitacora, page: Page, nombre: string): Promise<void> {
  if (page.isClosed()) return;
  const base = join(b.dir, "errores", `${nombre}-${Date.now()}`);
  await page.screenshot({ path: `${base}.png`, fullPage: true, timeout: 15000 }).catch(() => {});
  try {
    writeFileSync(`${base}.html`, await page.content());
    writeFileSync(`${base}.txt`, [page.url(), ...page.frames().map(fr => `  frame: ${fr.url()}`)].join("\n"));
  } catch {
    /* la evidencia nunca tumba la corrida */
  }
  b.log("aviso", "evidencia", `captura y HTML en ${base}.png/.html (url: ${page.url().slice(0, 120)})`);
}

/** ¿La pestaña quedó fuera de SOL? (formulario de ingreso o «Usted esta saliendo del Menú SOL»). */
export async function sesionCaida(page: Page): Promise<boolean> {
  if (page.isClosed()) return false;
  if (await ingresoVisible(page)) return true;
  const t = await page
    .locator("body")
    .innerText({ timeout: 2000 })
    .catch(() => "");
  return /saliendo del Men[uú] SOL/i.test(t);
}

interface PasoMenu {
  texto: string;
  posicion?: "primera" | "ultima";
}
// Mismo camino que consultar-cpe-individual.mts (ver ahí por qué cada paso).
const MENU: PasoMenu[] = [
  { texto: "Empresas" },
  { texto: "Comprobantes de pago" },
  { texto: "Comprobantes de Pago", posicion: "ultima" },
  { texto: "Consulta de Comprobantes de Pago" },
  { texto: "Nueva Consulta de comprobantes de pago" },
  { texto: "Nueva Consulta de comprobantes de pago" },
];

async function clicVisible(page: Page, texto: string, posicion: "primera" | "ultima", timeoutMs = 20000): Promise<boolean> {
  const fin = Date.now() + timeoutMs;
  while (Date.now() < fin) {
    for (const f of page.frames()) {
      try {
        const c = f.locator(`text=${texto}`);
        const n = await c.count();
        const vis: number[] = [];
        for (let i = 0; i < n; i++)
          if (
            await c
              .nth(i)
              .isVisible()
              .catch(() => false)
          )
            vis.push(i);
        if (vis.length) {
          await c.nth(posicion === "ultima" ? vis[vis.length - 1] : vis[0]).click({ timeout: 5000 });
          return true;
        }
      } catch {
        /* el marco puede estar navegando */
      }
    }
    await page.waitForTimeout(400);
  }
  return false;
}

export async function marcoFormulario(page: Page): Promise<Frame | null> {
  for (const f of page.frames()) {
    const ruc = f.locator('input[name="rucEmisor"]').first();
    if ((await ruc.count().catch(() => 0)) && (await ruc.isVisible().catch(() => false))) return f;
  }
  return null;
}

/** Menú → «Nueva Consulta de comprobantes de pago». Las esperas fijas son a propósito: con textos repetidos, apurarse clica la categoría otra vez. */
/** Espera el formulario de consulta (el campo rucEmisor) dentro de algún recuadro. */
async function esperarFormulario(page: Page, ms: number): Promise<Frame | null> {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    const f = await marcoFormulario(page);
    if (f) return f;
    await page.waitForTimeout(400);
  }
  return null;
}

/**
 * Llega a «Nueva Consulta» SIN SALIR DEL MENÚ DE SOL.
 *
 * Salir del menú —recargar MenuInternet.htm, navegar a otra página— dispara el
 * cierre de sesión de SOL (la app pide «…?logout»). A veces el cierre alcanzaba
 * a correr y a veces no: el formulario abría con la pantalla de ingreso, el
 * segundo login pedía captcha en GitHub Actions y la corrida moría (30/09/2026).
 * Por eso:
 *   • si el formulario ya está abierto (renovar el token, reintentar tras un
 *     error), se recarga SOLO su recuadro: la app pide token nuevo al cargar;
 *   • si estamos en el menú recién entrados, se hace clic en él directamente;
 *   • solo si no estamos en el menú se navega a él.
 */
export async function abrirFormulario(b: Bitacora, page: Page, quien: string): Promise<Frame> {
  const abierto = await marcoFormulario(page);
  if (abierto) {
    await abierto.goto(abierto.url(), { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    const f = await esperarFormulario(page, 30000);
    if (f) return f;
    b.log("aviso", quien, "recargar el formulario no funcionó; se vuelve a recorrer el menú");
  }
  const enMenu = await menuVisible(page);
  if (!enMenu) {
    await irConReintento(b, page, LOGIN_URL, quien);
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  }
  if (await sesionCaida(page)) {
    await guardarEvidencia(b, page, "menu-con-ingreso");
    throw new ErrorSesion("el menú devolvió la pantalla de ingreso");
  }
  for (const [i, paso] of MENU.entries()) {
    const posicion = paso.posicion ?? (i > 0 && MENU[i - 1].texto === paso.texto ? "ultima" : "primera");
    if (!(await clicVisible(page, paso.texto, posicion)))
      throw new Error(`no se llegó al formulario: falta «${paso.texto}» (paso ${i + 1})`);
    if (i < MENU.length - 1) await page.waitForTimeout(MENU[i + 1]?.texto === paso.texto ? 2500 : 1200);
  }
  const f = await esperarFormulario(page, 30000);
  if (f) return f;
  throw new Error("el menú terminó pero el formulario (rucEmisor) no apareció en 30 s");
}

export { Token } from "./token.mts";
