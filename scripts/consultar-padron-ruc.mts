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

/** Entra como el robot; ante un corte de red («fetch failed») reintenta 5 veces con espera creciente (30/09/2026: la ruta a Supabase cortaba de a ratos). */
async function autenticarRobot(sb: ReturnType<typeof clienteSupabase>) {
  for (let intento = 1; intento <= 5; intento++) {
    const { error } = await sb.auth.signInWithPassword({
      email: pedir("ROBOT_CORREO"), password: pedir("ROBOT_CLAVE"),
    });
    if (!error) return;
    const deRed = /fetch failed|network|timeout|ECONN|ETIMEDOUT/i.test(error.message);
    if (!deRed || intento === 5) { console.error("✗ No se pudo entrar como el robot:", error.message); process.exit(1); }
    console.log(`⚠ no se pudo entrar como el robot (${error.message}); reintento ${intento}/4 en ${5 * intento} s`);
    await pausaAlAzar(5000 * intento, 5000 * intento);
  }
}

/**
 * La lista de RUC a consultar: los que no están en el padrón, o llevan más de
 * DIAS_VIGENCIA sin revisarse — con los proveedores del año en curso PRIMERO.
 *
 * Dos cosas que se vieron el 30/09/2026:
 *   • la función devuelve de a 1000 filas como máximo (tope de PostgREST) y
 *     había 1 293 pendientes: se pagina, o parte de la lista ni aparecía;
 *   • el SIRE ya trae septiembre–diciembre de 2025 (762 proveedores que solo
 *     están ahí): sin priorizar, el cupo diario (MAX_CONSULTAS) se gastaba en
 *     ellos antes que en los de 2026. PERIODO_DESDE (por omisión, enero del año
 *     en curso) decide qué va primero; lo demás igual se consulta después.
 */
async function rucsPendientes(sb: ReturnType<typeof clienteSupabase>): Promise<string[]> {
  const todos: string[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await sb
      .rpc("rucs_por_actualizar_en_padron", { p_dias_vigencia: DIAS_VIGENCIA })
      .range(desde, desde + 999);
    if (error) { console.error("✗ No se pudo leer la lista de RUC pendientes:", error.message); break; }
    // Solo RUC de 11 dígitos: el SIRE trae un proveedor «0» (basura) que hacía perder 30 s en cada corrida.
    const filas = (data as Array<{ ruc: string }>).map(r => r.ruc).filter(r => /^\d{11}$/.test(r ?? ""));
    todos.push(...filas);
    if (filas.length < 1000) break;
  }
  const periodoDesde = process.env.PERIODO_DESDE?.trim() || `${new Date().getFullYear()}01`;
  const recientes = await proveedoresDesde(sb, periodoDesde);
  const primero = todos.filter(r => recientes.has(r));
  console.log(`${todos.length} RUC pendientes; ${primero.length} con comprobantes desde ${periodoDesde} van primero.`);
  return [...primero, ...todos.filter(r => !recientes.has(r))];
}

/** Los RUC de proveedores con comprobantes en el SIRE desde un período (paginado por id). */
async function proveedoresDesde(sb: ReturnType<typeof clienteSupabase>, periodo: string): Promise<Set<string>> {
  const rucs = new Set<string>();
  let ultimo: string | null = null;
  for (;;) {
    let q = sb.from("comprobantes_sunat").select("id, proveedor_ruc").gte("periodo", periodo);
    if (ultimo) q = q.gt("id", ultimo);
    const { data, error } = await q.order("id").limit(1000);
    if (error) { console.error("⚠ No se pudo leer los proveedores recientes:", error.message); return rucs; }
    for (const f of data ?? []) if (f.proveedor_ruc) rucs.add(f.proveedor_ruc);
    if ((data ?? []).length < 1000) return rucs;
    ultimo = data![data!.length - 1].id;
  }
}

/** Guarda un resultado apenas se consulta —no al final del lote—, para no perder lo ya hecho si algo falla después. */
async function guardarResultado(sb: ReturnType<typeof clienteSupabase>, r: CondicionRuc): Promise<void> {
  const { error } = await sb.rpc("guardar_padron_ruc", { p_filas: [r] });
  if (error) console.error(`  ⚠ no se guardó ${r.ruc}: ${error.message}`);
}

// ── Principal ─────────────────────────────────────────────────────

// PARALELO pestañas a la vez (cada una con su propia sesión, así el reCAPTCHA
// las ve como visitas separadas), todas tomando de la misma cola. Por omisión
// 1, como siempre. Freno automático: si de los últimos 10 resultados 3 o más
// no se pudieron leer —la señal de que SUNAT empieza a rechazar—, todas paran
// 60 s y la pausa entre consultas se duplica (hasta 16 s).
const PARALELO = Math.max(1, Number(process.env.PARALELO?.trim() || "1"));
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

const navegador = await chromium.launch({
  headless: true,
  args: ["--disable-blink-features=AutomationControlled"],
});
// Un User-Agent de navegador real: sin esto el WAF de SUNAT trata distinto
// la petición — se vio lo mismo con el portal SOL en descargar-cpe.mts.
const nuevaPagina = async () => (await navegador.newContext({ locale: "es-PE", userAgent: USER_AGENT })).newPage();
const page = await nuevaPagina();

try {
  const sb = DEBUG ? null : clienteSupabase();
  if (sb) await autenticarRobot(sb);

  const rucs = DEBUG ? RUCS_PRUEBA : await rucsPendientes(sb!);
  const enEstaCorrida = rucs.slice(0, MAX_CONSULTAS);

  console.log(DEBUG
    ? `Modo depuración: consultando ${enEstaCorrida.length} RUC de prueba (${enEstaCorrida.join(", ")}). No se guarda nada.`
    : `${rucs.length} RUC pendientes; consultando ${enEstaCorrida.length} en esta corrida, ${PARALELO} a la vez.`);

  let ok = 0;
  const fallidos: string[] = [];
  const cola = [...enEstaCorrida];
  const recientes: boolean[] = [];
  let pausaMin = 2000;
  let frenoHasta = 0;
  const inicio = Date.now();

  const anotar = (bien: boolean) => {
    recientes.push(bien);
    if (recientes.length > 10) recientes.shift();
    const malos = recientes.filter(x => !x).length;
    if (recientes.length >= 5 && malos >= 3 && Date.now() > frenoHasta) {
      frenoHasta = Date.now() + 60000;
      pausaMin = Math.min(pausaMin * 2, 16000);
      recientes.length = 0;
      console.log(`⚠ ${malos} de los últimos resultados no se pudieron leer: todas paran 60 s y la pausa sube a ${pausaMin / 1000}-${(pausaMin * 2) / 1000} s`);
    }
  };

  const trabajador = async (n: number, pagina: Page) => {
    for (let ruc = cola.shift(); ruc; ruc = cola.shift()) {
      while (Date.now() < frenoHasta) await pausaAlAzar(1000, 1000);
      console.log(`\n· [p${n}] ${ruc}`);
      try {
        const r = await consultarRuc(pagina, ruc);
        if (DEBUG) await evidencia(pagina, `resultado-${ruc}`);
        if (!r.encontrado) {
          console.log(`  ⚠ no se pudo leer el resultado (¿RUC inexistente, o cambió la página?)`);
          fallidos.push(ruc);
          anotar(false);
        } else {
          console.log(
            `  Estado=${r.estado} Condición=${r.condicion} ` +
            `BuenContribuyente=${r.buenContribuyente} AgenteRetención=${r.agenteRetencion} AgentePercepción=${r.agentePercepcion}`
          );
          ok++;
          anotar(true);
          if (sb) await guardarResultado(sb, r);
        }
      } catch (e) {
        console.error(`  ✗ ${e instanceof Error ? e.message : e}`);
        await evidencia(pagina, `error-${ruc}`);
        fallidos.push(ruc);
        anotar(false);
      }
      const hechos = ok + fallidos.length;
      if (hechos % 25 === 0) {
        const porMin = hechos / ((Date.now() - inicio) / 60000);
        console.log(`  … ${hechos}/${enEstaCorrida.length} · ${porMin.toFixed(1)}/min · faltan ~${Math.round(cola.length / Math.max(porMin, 0.1))} min`);
      }
      // Una pausa entre RUC: encadenar consultas sin respiro es justo el
      // patrón que hace que un reCAPTCHA v3 puntúe distinto una sesión.
      if (cola.length) await pausaAlAzar(pausaMin, pausaMin * 2);
    }
  };

  const paginas = [page];
  for (let i = 1; i < Math.min(PARALELO, enEstaCorrida.length); i++) paginas.push(await nuevaPagina());
  // Arranque escalonado: no las N consultas en el mismo segundo.
  await Promise.all(paginas.map(async (p, i) => { await pausaAlAzar(i * 1500, i * 1500 + 500); await trabajador(i + 1, p); }));

  console.log(`\n${ok} de ${enEstaCorrida.length} consultados en ${((Date.now() - inicio) / 60000).toFixed(1)} min.`);
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
