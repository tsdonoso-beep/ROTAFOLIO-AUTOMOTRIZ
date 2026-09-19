// Consultar la condición del RUC de cada proveedor en SUNAT (Buen
// Contribuyente / Agente de Retención) y guardarla en la base
//
// Si a una compra le corresponde o no la retención del IGV depende de si el
// proveedor es Buen Contribuyente o Agente de Retención/Percepción — algo
// que Contabilidad hoy revisa a mano, RUC por RUC, en la Consulta RUC
// pública de SUNAT.
//
// A diferencia de esa misma consulta hecha con una petición suelta (que se
// intentó primero, desde Apps Script), el botón «Buscar» de esa pantalla
// dispara un reCAPTCHA v3: el campo «token» del formulario llega vacío del
// servidor y solo se llena cuando `grecaptcha.execute(...)` corre en un
// navegador de verdad. Por eso esto usa Playwright —igual que
// `descargar-cpe.mts`— y no una petición HTTP a secas: el navegador resuelve
// el captcha en silencio, como lo haría una persona al hacer clic.
//
// A diferencia de `descargar-cpe.mts`, esta consulta NO necesita login: la
// Consulta RUC es pública. La lista de a quién consultar sale de la base
// (`rucs_por_actualizar_en_padron`), no de un rango de fechas.
//
// DOS FASES:
//   • Depuración (DEBUG=1, por omisión): consulta uno o pocos RUC de prueba
//     (RUCS_PRUEBA) y sube capturas + HTML de cada paso como artefacto. No
//     toca la base.
//   • Real (DEBUG=0): trae la lista de RUC vencidos de la base, los consulta
//     todos (hasta MAX_CONSULTAS) y guarda cada resultado con `guardar_padron_ruc`.

import { chromium, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { leerResultadoConsultaRuc, type CondicionRuc } from "../lib/sunat/consulta-ruc.ts";

// ── Configuración desde el entorno ────────────────────────────────

function pedir(...nombres: string[]): string {
  for (const n of nombres) { const v = (process.env[n] ?? "").trim(); if (v) return v; }
  console.error(`✗ Falta ${nombres.join(" o ")} en el entorno.`);
  process.exit(1);
}

const DEBUG = process.env.DEBUG !== "0";
const DIAS_VIGENCIA = Number(process.env.DIAS_VIGENCIA?.trim() || "30");
const MAX_CONSULTAS = Number(process.env.MAX_CONSULTAS?.trim() || "80");

// En depuración, o para probar un RUC puntual sin esperar la lista de la
// base: "20501529363,20601712521".
const RUCS_PRUEBA = (process.env.RUCS?.trim() || "20501529363")
  .split(",").map(r => r.trim()).filter(Boolean);

const URL_FORMULARIO = "https://e-consultaruc.sunat.gob.pe/cl-ti-itmrconsruc/FrameCriterioBusquedaWeb.jsp";

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

/** Una pausa aleatoria entre consultas: parecerse a un ritmo humano, no a un bucle. */
function pausaAlAzar(minMs: number, maxMs: number): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise(r => setTimeout(r, ms));
}

// ── La consulta, en el navegador ───────────────────────────────────

/**
 * Consulta un RUC en la pantalla pública, dejando que el propio navegador
 * resuelva el reCAPTCHA v3 al hacer clic en «Buscar» — ninguna cabecera ni
 * token se arma a mano.
 */
async function consultarRuc(page: Page, ruc: string): Promise<CondicionRuc> {
  await page.goto(URL_FORMULARIO, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("#txtRuc", { timeout: 30000 });

  await page.fill("#txtRuc", ruc);
  await page.click("#btnAceptar");

  // Tras el clic: grecaptcha.execute(...) resuelve el token (silencioso, sin
  // UI) y recién ahí el formulario navega a jcrS00Alias con el resultado.
  await page.waitForURL(/jcrS00Alias/i, { timeout: 30000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

  const html = await page.content();
  return leerResultadoConsultaRuc(html, ruc);
}

// ── Guardar en la base ──────────────────────────────────────────────

function clienteSupabase() {
  const url = pedir("SUPABASE_URL", "PROJECT_URL");
  return createClient(url, pedir("SUPABASE_ANON_KEY", "ANON_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } });
}

async function autenticarRobot(sb: ReturnType<typeof clienteSupabase>) {
  const { error } = await sb.auth.signInWithPassword({
    email: pedir("ROBOT_CORREO"), password: pedir("ROBOT_CLAVE"),
  });
  if (error) { console.error("✗ No se pudo entrar como el robot:", error.message); process.exit(1); }
}

/** La lista de RUC a consultar: los que no están en el padrón, o llevan más de DIAS_VIGENCIA sin revisarse. */
async function rucsPendientes(sb: ReturnType<typeof clienteSupabase>): Promise<string[]> {
  const { data, error } = await sb.rpc("rucs_por_actualizar_en_padron", { p_dias_vigencia: DIAS_VIGENCIA });
  if (error) { console.error("✗ No se pudo leer la lista de RUC pendientes:", error.message); return []; }
  return (data as Array<{ ruc: string }>).map(r => r.ruc).filter(Boolean);
}

/** Guarda un resultado apenas se consulta —no al final del lote—, para no perder lo ya hecho si algo falla después. */
async function guardarResultado(sb: ReturnType<typeof clienteSupabase>, r: CondicionRuc): Promise<void> {
  const { error } = await sb.rpc("guardar_padron_ruc", { p_filas: [r] });
  if (error) console.error(`  ⚠ no se guardó ${r.ruc}: ${error.message}`);
}

// ── Principal ─────────────────────────────────────────────────────

const navegador = await chromium.launch({
  headless: true,
  args: ["--disable-blink-features=AutomationControlled"],
});
const contexto = await navegador.newContext({
  locale: "es-PE",
  // Un User-Agent de navegador real: sin esto el WAF de SUNAT trata distinto
  // la petición — se vio lo mismo con el portal SOL en descargar-cpe.mts.
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
});
const page = await contexto.newPage();

try {
  const sb = DEBUG ? null : clienteSupabase();
  if (sb) await autenticarRobot(sb);

  const rucs = DEBUG ? RUCS_PRUEBA : await rucsPendientes(sb!);
  const enEstaCorrida = rucs.slice(0, MAX_CONSULTAS);

  console.log(DEBUG
    ? `Modo depuración: consultando ${enEstaCorrida.length} RUC de prueba (${enEstaCorrida.join(", ")}). No se guarda nada.`
    : `${rucs.length} RUC pendientes; consultando ${enEstaCorrida.length} en esta corrida.`);

  let ok = 0;
  const fallidos: string[] = [];

  for (const [i, ruc] of enEstaCorrida.entries()) {
    console.log(`\n· ${ruc}`);
    try {
      const r = await consultarRuc(page, ruc);
      if (DEBUG) await evidencia(page, `resultado-${ruc}`);

      if (!r.encontrado) {
        console.log(`  ⚠ no se pudo leer el resultado (¿RUC inexistente, o cambió la página?)`);
        fallidos.push(ruc);
      } else {
        console.log(
          `  Estado=${r.estado} Condición=${r.condicion} ` +
          `BuenContribuyente=${r.buenContribuyente} AgenteRetención=${r.agenteRetencion} AgentePercepción=${r.agentePercepcion}`
        );
        ok++;
        if (sb) await guardarResultado(sb, r);
      }
    } catch (e) {
      console.error(`  ✗ ${e instanceof Error ? e.message : e}`);
      await evidencia(page, `error-${ruc}`);
      fallidos.push(ruc);
    }

    // Una pausa entre RUC: encadenar consultas sin respiro es justo el
    // patrón que hace que un reCAPTCHA v3 puntúe distinto una sesión.
    if (i < enEstaCorrida.length - 1) await pausaAlAzar(2000, 4000);
  }

  console.log(`\n${ok} de ${enEstaCorrida.length} consultados.`);
  if (fallidos.length) console.log(`No se pudieron leer: ${fallidos.join(", ")}`);
  if (!DEBUG && rucs.length > enEstaCorrida.length) {
    console.log(`Quedan ${rucs.length - enEstaCorrida.length} RUC pendientes para la próxima corrida.`);
  }
} catch (e) {
  await evidencia(page, "error-general");
  console.error("✗", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await navegador.close();
}
