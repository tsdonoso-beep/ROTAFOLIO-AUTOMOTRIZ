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

// El camino que muestran las capturas del portal real (28/09/2026):
// Empresas → Comprobantes de pago → Factura Electrónica → «Consultar
// Factura, Boletas y Notas» (aparece dos veces: la entrada del menú y,
// debajo, el enlace de verdad).
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

async function clicEnAlgunMarco(page: Page, texto: string, timeoutMs = 20000): Promise<boolean> {
  const fin = Date.now() + timeoutMs;
  while (Date.now() < fin) {
    for (const f of page.frames()) {
      try {
        const loc = f.locator(`text=${texto}`).first();
        if (await loc.count()) { await loc.click({ timeout: 5000 }); return true; }
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
    if (await clicEnAlgunMarco(page, texto)) {
      await page.waitForTimeout(ultimo ? 3000 : 1200);
      if (!ultimo) await evidencia(page, `menu-${i}`);
      continue;
    }
    console.log(`  ⚠ no encontré «${texto}» en el menú de este acceso.`);
    await radiografiaMenu(page);
    throw new Error(`No se llegó al formulario: falta «${texto}» en el menú.`);
  }
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

/** El catálogo 01 de SUNAT, solo los que de verdad aparecen en el SIRE. */
function nombreTipoComprobante(codigo: string): string {
  const nombres: Record<string, string> = {
    "01": "Factura",
    "03": "Boleta de Venta",
    "07": "Nota de Crédito",
    "08": "Nota de Débito",
  };
  return nombres[codigo] ?? codigo;
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

// Los campos de texto de SUNAT no siempre traen type="text" (ver
// descargar-cpe.mts); se usa el mismo criterio acá.
const SEL_TEXTO = 'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="image"]):not([type="checkbox"]):not([type="radio"]):not([type="password"])';

/**
 * Llena el formulario «Individual» con un pendiente.
 *
 * AFINAR: los selectores de abajo son una primera lectura de las capturas
 * que trajo el usuario (RUC Emisor, Tipo de comprobante, Serie y número —
 * un solo campo dividido en dos cajas), no confirmados todavía contra el
 * DOM real. `radiografiaFormulario`, llamada antes de esto en cada corrida
 * de depuración, es la que dice si hay que ajustarlos.
 */
async function llenarFormulario(page: Page, p: Pendiente): Promise<Frame | null> {
  for (const f of page.frames()) {
    const rucInput = f.locator('input[name*="ruc" i], input[id*="ruc" i]').first();
    if (!(await rucInput.count())) continue;

    try {
      // Todas las de esta lista son compras: el emisor es el proveedor y el
      // adquiriente es la empresa, o sea «Recibido».
      await f.getByText("Recibido", { exact: false }).first().click({ timeout: 3000 }).catch(() => {});

      await rucInput.fill(p.proveedorRuc);

      const tipoSelect = f.locator("select").first();
      if (await tipoSelect.count()) {
        const etiqueta = nombreTipoComprobante(p.tipoComprobante);
        await tipoSelect.selectOption({ label: etiqueta }).catch(() =>
          console.log(`  ⚠ no encontré la opción "${etiqueta}" en el <select> de tipo; revisa la radiografía de arriba.`));
      }

      // Serie y número: dos cajas de texto, la primera con la serie y la
      // segunda con el número, según la captura. Se llenan por posición
      // dentro del mismo frame que trajo el campo de RUC, no por `name`
      // —no se conoce todavía—.
      const textos = await f.locator(SEL_TEXTO).all();
      const cajasVacias = [];
      for (const t of textos) {
        const valor = await t.inputValue().catch(() => "x");
        if (valor === "") cajasVacias.push(t);
      }
      if (cajasVacias.length >= 2) {
        await cajasVacias[0].fill(p.serie);
        await cajasVacias[1].fill(p.numero);
      } else {
        console.log(`  ⚠ esperaba 2 cajas vacías para serie/número y encontré ${cajasVacias.length}; revisa la radiografía.`);
      }

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
