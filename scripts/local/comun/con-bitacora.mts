// Bitácora al estilo de scripts/local para CUALQUIER script, sin tocarlo.
//
//   node --experimental-strip-types --import ./scripts/local/comun/con-bitacora.mts scripts/sunat-diario.mts
//
// Se carga antes del script y:
//   • a cada línea de consola le pone la hora y el nivel (· info, ⚠ aviso, ✗ error)
//     —igual que cpe:local— y la guarda en logs/<script>-<fecha>/eventos.jsonl;
//   • toda respuesta de `fetch` con estado >= 400 (o que ni responde) queda en
//     http.jsonl con su cuerpo crudo, y se cuentan todas por servicio y estado;
//   • al terminar deja resumen.json (duración, cuántos avisos y errores, códigos
//     HTTP) e imprime una línea de cierre; estado.json se reescribe cada 30 s
//     para ver desde otra terminal si sigue vivo (`pnpm cpe:estado`).
// Así los scripts viejos (sunat-diario, descargar-cpe, padrón…) informan igual
// que los nuevos sin reescribirlos.

import { basename, join } from "node:path";
import { writeFileSync } from "node:fs";
import { crearBitacora, type Nivel } from "./bitacora.mts";
import { duracion } from "./barra.mts";

const script = basename(process.argv[1] ?? "script").replace(/\.(m?ts|m?js)$/, "");
const b = crearBitacora(script);
const inicio = Date.now();
const cuenta = { info: 0, aviso: 0, error: 0 };
const original = { log: console.log, info: console.info, warn: console.warn, error: console.error };

export function nivelDe(linea: string, porOmision: Nivel): Nivel {
  const t = linea.trimStart();
  if (/^(✗|❌|error\b)/i.test(t)) return "error";
  if (/^(⚠|warn)/i.test(t)) return "aviso";
  return porOmision;
}

function texto(args: unknown[]): string {
  return args.map(a => typeof a === "string" ? a : a instanceof Error ? (a.stack ?? a.message) : JSON.stringify(a)).join(" ");
}

function escribir(porOmision: Nivel, args: unknown[]) {
  const todo = texto(args);
  for (const linea of todo.split("\n")) {
    if (!linea.trim()) { original.log(""); continue; }
    const nivel = nivelDe(linea, porOmision);
    cuenta[nivel]++;
    const marca = nivel === "error" ? "✗" : nivel === "aviso" ? "⚠" : "·";
    const limpia = linea.replace(/^\s*(✗|⚠|❌)\s?/, "");
    original.log(`${new Date().toTimeString().slice(0, 8)} ${marca} ${limpia}`);
    b.jsonl("eventos.jsonl", { t: new Date().toISOString(), nivel, msg: limpia });
  }
}

console.log = (...a: unknown[]) => escribir("info", a);
console.info = (...a: unknown[]) => escribir("info", a);
console.warn = (...a: unknown[]) => escribir("aviso", a);
console.error = (...a: unknown[]) => escribir("error", a);

// fetch: cada respuesta cuenta; las que fallan quedan crudas en http.jsonl.
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async (entrada: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
  const metodo = init?.method ?? (typeof entrada === "object" && "method" in entrada ? entrada.method : "GET");
  const t0 = Date.now();
  try {
    const r = await fetchOriginal(entrada, init);
    const cuerpo = r.status >= 400 ? await r.clone().text().catch(() => "") : undefined;
    b.http({ metodo, url, status: r.status, cuerpo, ms: Date.now() - t0 });
    return r;
  } catch (e) {
    const causa = e instanceof Error ? `${e.message}${(e as { cause?: { code?: string; message?: string } }).cause ? ` (${(e as { cause: { code?: string; message?: string } }).cause.code ?? ""} ${(e as { cause: { message?: string } }).cause.message ?? ""})` : ""}` : String(e);
    b.http({ metodo, url, status: 0, cuerpo: causa, ms: Date.now() - t0 });
    throw e;
  }
};

function estado(terminada: boolean, codigo?: number) {
  const r = {
    actualizado: new Date().toISOString(), corrida: b.corrida, script, minutos: Number(((Date.now() - inicio) / 60000).toFixed(1)),
    terminada, codigoSalida: codigo ?? null, lineas: cuenta, http: b.conteoHttp(),
  };
  try { writeFileSync(join(b.dir, terminada ? "resumen.json" : "estado.json"), JSON.stringify(r, null, 2)); } catch { /* nunca tumba el script */ }
  return r;
}
const latido = setInterval(() => estado(false), 30000);
latido.unref();

process.on("exit", codigo => {
  estado(true, codigo);
  writeFileSync(join(b.dir, "estado.json"), JSON.stringify({ ...estado(true, codigo), terminada: true }, null, 2));
  const http = Object.entries(b.conteoHttp()).filter(([k]) => !/ 2\d\d /.test(k)).map(([k, n]) => `${n}× ${k}`).slice(0, 5).join(" · ");
  original.log(`${new Date().toTimeString().slice(0, 8)} ${codigo === 0 ? "·" : "✗"} [resumen] ${script} terminó en ${duracion(Date.now() - inicio)} (salida ${codigo}) · ${cuenta.aviso} avisos · ${cuenta.error} errores${http ? ` · HTTP con error: ${http}` : ""} · logs en ${b.dir}`);
});
