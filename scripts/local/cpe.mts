// Confirmar los CPE no-E001 contra SUNAT, en local, con N trabajadores en paralelo.
//
//   VIA=api (por omisión)  baja XML+PDF directo de api-cpe con el token de la sesión — sin pantallas.
//   VIA=ui                 llena «Nueva Consulta» en N pestañas, como el workflow pero reusando el formulario.
//
// Uso:  pnpm cpe:local                                   (agosto+septiembre, API, 8 en paralelo)
//       MODO=pdf pnpm cpe:local                          (rellenar el PDF de lo ya guardado sin PDF)
//       VIA=ui WORKERS=2 LIMITE=10 HEADLESS=0 pnpm cpe:local
//
// Variables: PERIODO (202608,202609) · VIA · WORKERS (8) · LIMITE (0 = todos) · ORDEN (antiguo|reciente)
//   HEADLESS (1) · RAMPA_S (UI 8 / API 1) · MAX_INTENTOS (6) · ESPERA_CAIDO_S (API 30 / UI 300) · SUBIDAS (6)
//   LOTE_GUARDADO (20) · PUBLICAR (fin|nunca) · CON_PDF (1) · PDF_EN_PARALELO (6) · BARRA (1)
//   MODO_SESION (compartida|separada, solo UI)
// Nunca correrlo a la vez que un workflow que use la misma cuenta de SOL.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { num, texto, LIMITE, PERIODOS, RUCS, SERIES, TIPOS } from "./comun/config.mts";
import { crearBitacora, vigilarProceso, primeraLinea, usarSalida } from "./comun/bitacora.mts";
import { Barra } from "./comun/barra.mts";
import { pendientes, pendientesSinPdf, publicarDetalle } from "./comun/base.mts";
import { Tuberia, type Trabajador } from "./comun/tuberia.mts";
import { abrirNavegador, nuevoContexto, entrar } from "./sol/sesion.mts";
import { TrabajadorUi } from "./sol/trabajador-ui.mts";
import { Renovador, TrabajadorApi } from "./api/trabajador-api.mts";
import type { BrowserContext } from "playwright";

const VIA = texto("VIA", "api") === "ui" ? "ui" : "api";
// MODO=pdf: rellenar el PDF de lo que ya está guardado sin él (solo por API).
const MODO = texto("MODO", "nuevos") === "pdf" ? "pdf" : "nuevos";
const WORKERS = Math.max(1, num("WORKERS", 8));
const RAMPA_MS = num("RAMPA_S", VIA === "ui" ? 8 : 1) * 1000;
const MODO_SESION = texto("MODO_SESION", "compartida");

const b = crearBitacora(`cpe-${VIA}`);
vigilarProceso(b);
b.log("info", "inicio", `corrida ${b.corrida} · vía ${VIA} · modo ${MODO} · períodos ${PERIODOS.join(",") || "TODOS"} · series ${SERIES} · tipos ${TIPOS.join(",")}${RUCS.length ? ` · RUCS ${RUCS.join(",")}` : ""} · ${WORKERS} en paralelo · logs en ${b.dir}`);

if (MODO === "pdf" && VIA !== "api") { b.log("error", "inicio", "MODO=pdf solo funciona con VIA=api"); process.exit(1); }
const lista = MODO === "pdf" ? await pendientesSinPdf(b) : await pendientes(b);
const aProcesar = LIMITE > 0 ? lista.slice(0, LIMITE) : lista;
b.log("info", "inicio", `pendientes: ${lista.length} · se procesan: ${aProcesar.length}`);
if (!aProcesar.length) process.exit(0);

const tuberia = new Tuberia(b, aProcesar, {
  politica: {
    // Por API los 500 son intermitentes y responden en ~200 ms: se reintenta en 30 s. Por pantalla, lo que pide SUNAT (5 min).
    maxIntentos: num("MAX_INTENTOS", 6), esperaCaidoMs: num("ESPERA_CAIDO_S", VIA === "api" ? 30 : 300) * 1000,
    esperaReintentoMs: num("ESPERA_REINTENTO_S", 20) * 1000, esperaLimiteMs: num("ESPERA_LIMITE_S", 60) * 1000,
  },
  subidasEnParalelo: Math.max(1, num("SUBIDAS", 6)),
  pdfEnParalelo: Math.max(1, num("PDF_EN_PARALELO", 6)),
  loteGuardado: Math.max(1, num("LOTE_GUARDADO", 20)),
  umbralCaido: num("UMBRAL_CAIDO_PCT", 80) / 100,
  pausaCaidoMs: num("PAUSA_CAIDO_S", 120) * 1000,
  watchdogMs: num("WATCHDOG_S", 180) * 1000,
});

const nav = await abrirNavegador();
const principal = await nuevoContexto(nav);
const login = await principal.newPage();
login.on("dialog", d => { d.accept().catch(() => {}); });
try { await entrar(b, login, "login"); }
catch (e) {
  await login.screenshot({ path: join(b.dir, "errores", "login.png"), fullPage: true }).catch(() => {});
  b.log("error", "login", primeraLinea(e));
  await nav.close(); process.exit(1);
}
await login.close();

const cantidad = Math.min(WORKERS, aProcesar.length);
let trabajadores: Trabajador[];
let renovador: Renovador | null = null;
if (VIA === "api") {
  renovador = new Renovador(b, principal);
  await renovador.listo();
  const conPdf = texto("CON_PDF", "1") !== "0";
  trabajadores = Array.from({ length: cantidad }, (_, i) => new TrabajadorApi(b, renovador!, i + 1, conPdf));
} else {
  const contextos: BrowserContext[] = [];
  for (let i = 0; i < cantidad; i++) {
    if (MODO_SESION !== "separada") { contextos.push(principal); continue; }
    const ctx = await nuevoContexto(nav);
    const p = await ctx.newPage();
    await entrar(b, p, `login-${i + 1}`); await p.close();
    contextos.push(ctx);
  }
  trabajadores = contextos.map((ctx, i) => new TrabajadorUi(b, ctx, i + 1, num("ESPERA_RESULTADO_S", 45) * 1000));
}

// Barra fija abajo (avance, ritmo, ETA) y los logs de siempre por encima. BARRA=0 la apaga.
const barra = new Barra(() => tuberia.progreso());
usarSalida(linea => barra.escribir(linea));
barra.iniciar();
const tLatido = setInterval(() => tuberia.latido(trabajadores), 30000);
const tVigilante = setInterval(() => tuberia.vigilar(trabajadores), 15000);
const tVolcado = setInterval(() => { void tuberia.volcar(); }, 60000);
let interrupciones = 0;
process.on("SIGINT", () => {
  if (++interrupciones > 1) { b.log("error", "proceso", "segundo Ctrl+C: salida inmediata (lo bajado sigue en salida/cpe)"); process.exit(130); }
  tuberia.detener = true;
  b.log("aviso", "proceso", "Ctrl+C: se terminan los intentos en curso y se guarda lo bajado. Otro Ctrl+C sale ya.");
});

await Promise.all(trabajadores.map((w, i) => tuberia.correr(w, i * RAMPA_MS)));
b.log("info", "cierre", "consultas terminadas; esperando subidas y guardado");
await tuberia.cerrar();
clearInterval(tLatido); clearInterval(tVigilante); clearInterval(tVolcado);
barra.terminar();
usarSalida(linea => console.log(linea));
await nav.close().catch(() => {});
if (tuberia.base.guardados > 0 && texto("PUBLICAR", "fin") !== "nunca") {
  tuberia.etapas.sumar("hoja", "publicaciones");
  await publicarDetalle(b);
  tuberia.etapas.cerrarSi("hoja", true);
} else tuberia.etapas.omitir("hoja", tuberia.base.guardados > 0 ? "PUBLICAR=nunca" : "no se guardó nada nuevo");
tuberia.etapas.escribir({ progreso: tuberia.progreso(), terminada: true });

const resumen = tuberia.resumen({ etapas: tuberia.etapas.instantanea().etapas, corrida: b.corrida, via: VIA, workers: WORKERS, periodos: PERIODOS, pendientes: lista.length, renovacionesToken: renovador?.renovaciones ?? 0, http: b.conteoHttp() });
writeFileSync(join(b.dir, "resumen.json"), JSON.stringify(resumen, null, 2));
b.log("info", "resumen", `${resumen.minutos} min · OK ${resumen.finales.ok}/${aProcesar.length} · no existe ${resumen.finales.noExiste} · agotados ${resumen.finales.agotados} · sin terminar ${resumen.quedanEnCola} · ${resumen.okPorHora}/hora`);
b.log("info", "resumen", `Drive ${JSON.stringify(resumen.drive)} · base ${JSON.stringify(resumen.base)} · por clase ${JSON.stringify(resumen.porClase)}`);
for (const [k, n] of Object.entries(resumen.http).slice(0, 12)) b.log("info", "http", `${String(n).padStart(5)}× ${k}`);
b.log("info", "resumen", `detalle: ${join(b.dir, "resumen.json")} · intentos: intentos.jsonl · errores HTTP crudos: http.jsonl`);
