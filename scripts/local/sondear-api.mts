// Sondeo: ¿cuál es la forma más rápida (y que funcione) de sacarle el XML a SUNAT?
//
// Entra a SOL una vez, abre «Nueva Consulta» solo para obtener el token de
// api-cpe y después prueba, sobre la MISMA muestra de pendientes:
//   A. XML directo por API                    (sin pantallas, sin consultar antes)
//   B. Cabecera por API                       (lo que hace el botón «Consultar»; da 500 donde el XML sí baja)
//   C. PDF directo por API
// Todo con el cliente HTTP de Playwright: el `fetch` de Node lo corta SUNAT (ver api/cliente.mts).
//   D. Lista masiva por rango de fechas      (varias formas de pedirla: cuál acepta SUNAT)
//   E. A con 1, 4 y 8 en paralelo            (cuánto aguanta antes de 429/500)
// No guarda nada en Drive ni en la base: los XML quedan en salida/sondeo/ y
// el informe en logs/sondeo-<fecha>/informe.json + http.jsonl (cada error HTTP crudo).
//
//   SONDEO_N=12 pnpm cpe:sondeo

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { num, RUC } from "./comun/config.mts";
import { crearBitacora, vigilarProceso, primeraLinea, type Bitacora } from "./comun/bitacora.mts";
import { pendientes } from "./comun/base.mts";
import { xmlsDe } from "./comun/drive.mts";
import type { Pendiente } from "./comun/tipos.mts";
import { leerComprobanteXml, documentoPrincipal } from "../../lib/sunat/cpe-xml.ts";
import { abrirNavegador, nuevoContexto, entrar, abrirFormulario, Token } from "./sol/sesion.mts";
import { ClienteApi } from "./api/cliente.mts";

const b = crearBitacora("sondeo");
vigilarProceso(b);
const N = num("SONDEO_N", 12);
const SALIDA = join(process.cwd(), "salida", "sondeo");
mkdirSync(SALIDA, { recursive: true });

interface Medida {
  prueba: string;
  comprobante: string;
  status: number;
  clase: string;
  ms: number;
  nota?: string;
}
const medidas: Medida[] = [];
function anotar(m: Medida) {
  medidas.push(m);
  b.log(
    m.clase === "OK" ? "info" : "aviso",
    m.prueba,
    `${m.comprobante}: HTTP ${m.status} ${m.clase} en ${m.ms} ms${m.nota ? " · " + m.nota : ""}`,
  );
}

/** Muestra repartida a lo largo de la lista (no los N primeros: los primeros siempre son los mismos, y F002-3792 da 500 siempre). */
function muestra<T>(lista: T[], n: number): T[] {
  if (lista.length <= n) return lista;
  const paso = lista.length / n;
  return Array.from({ length: n }, (_, i) => lista[Math.floor(i * paso)]);
}
const etiqueta = (p: Pendiente) => `${p.proveedorRuc} ${p.tipoComprobante} ${p.serie}-${p.numero}`;

async function pruebaXml(api: ClienteApi, p: Pendiente, prueba: string) {
  const { r, archivo } = await api.archivo(p, "XML");
  let nota = r.clase === "OK" ? "" : r.texto.slice(0, 200);
  if (archivo) {
    writeFileSync(join(SALIDA, archivo.nombre), archivo.datos);
    try {
      const c = leerComprobanteXml(documentoPrincipal(xmlsDe(archivo)) ?? "");
      nota = `${archivo.nombre} ${archivo.datos.length} B · leído: ${c.serie}-${c.numero} ${c.moneda} ${c.total}, ${c.items.length} ítems`;
    } catch (e) {
      nota = `${archivo.nombre}: bajó pero no se pudo leer (${primeraLinea(e)})`;
    }
  }
  anotar({ prueba, comprobante: etiqueta(p), status: r.status, clase: r.clase, ms: r.ms, nota });
  return r.clase;
}

/** C: el PDF, igual que el XML. */
async function pruebaPdf(api: ClienteApi, p: Pendiente) {
  const { r, archivo } = await api.archivo(p, "PDF");
  if (archivo) writeFileSync(join(SALIDA, archivo.nombre), archivo.datos);
  anotar({
    prueba: "C-pdf",
    comprobante: etiqueta(p),
    status: r.status,
    clase: r.clase,
    ms: r.ms,
    nota: archivo ? `${archivo.nombre} ${archivo.datos.length} B` : r.texto.slice(0, 200),
  });
}

/** D: formas posibles de la lista masiva de recibidos, una semana de agosto. */
async function pruebaLista(api: ClienteApi, ejemplo: Pendiente) {
  const variantes: Array<{ nombre: string; ruc: string; extra: Record<string, string> }> = [
    { nombre: "ruc propio", ruc: RUC, extra: {} },
    { nombre: "ruc propio + doc receptor", ruc: RUC, extra: { codDocIde: "6", numDocIde: RUC } },
    { nombre: "ruc proveedor", ruc: ejemplo.proveedorRuc, extra: {} },
    { nombre: "ruc proveedor + doc receptor", ruc: ejemplo.proveedorRuc, extra: { codDocIde: "6", numDocIde: RUC } },
    { nombre: "ruc proveedor + codEstado 01", ruc: ejemplo.proveedorRuc, extra: { codEstado: "01" } },
  ];
  const [a, m] = [ejemplo.fechaEmision?.slice(0, 4) ?? "2026", ejemplo.fechaEmision?.slice(5, 7) ?? "08"];
  for (const v of variantes) {
    const r = await api.lista(v.ruc, ejemplo.tipoComprobante, `01/${m}/${a}`, `28/${m}/${a}`, v.extra);
    const n = Array.isArray(r.json?.comprobantes) ? r.json.comprobantes.length : null;
    const primero = n ? JSON.stringify(r.json!.comprobantes![0]).slice(0, 300) : r.texto.slice(0, 200);
    anotar({
      prueba: `D-lista (${v.nombre})`,
      comprobante: `${v.ruc} ${ejemplo.tipoComprobante} ${m}/${a}`,
      status: r.status,
      clase: r.clase,
      ms: r.ms,
      nota: n !== null ? `${n} comprobantes · ${primero}` : primero,
    });
  }
}

/** E: descargas en paralelo, para ver el ritmo real y cuándo empieza a fallar. */
async function pruebaParalelo(api: ClienteApi, lista: Pendiente[], concurrencia: number) {
  const t0 = Date.now();
  const cola = [...lista];
  const clases: Record<string, number> = {};
  await Promise.all(
    Array.from({ length: concurrencia }, async () => {
      for (let p = cola.shift(); p; p = cola.shift()) {
        const clase = await pruebaXml(api, p, `E-paralelo-${concurrencia}`);
        clases[clase] = (clases[clase] ?? 0) + 1;
      }
    }),
  );
  const s = (Date.now() - t0) / 1000;
  b.log(
    "info",
    `E-paralelo-${concurrencia}`,
    `${lista.length} en ${s.toFixed(1)} s → ${((lista.length / s) * 60).toFixed(0)}/min · ${JSON.stringify(clases)}`,
  );
  return { concurrencia, n: lista.length, segundos: Number(s.toFixed(1)), porMinuto: Math.round((lista.length / s) * 60), clases };
}

async function principal(b: Bitacora) {
  const todos = await pendientes(b);
  b.log("info", "sondeo", `pendientes: ${todos.length}; muestra de ${N} (+ ${N * 3} para el paralelo)`);
  const base = muestra(todos, N);
  const extra = muestra(
    todos.filter(p => !base.includes(p)),
    N * 3,
  );

  const nav = await abrirNavegador();
  const ctx = await nuevoContexto(nav);
  const token = new Token();
  token.vigilar(ctx);
  const page = await ctx.newPage();
  page.on("dialog", d => {
    d.accept().catch(() => {});
  });
  try {
    await entrar(b, page, "login");
    const t0 = Date.now();
    await abrirFormulario(b, page, "menu");
    await token.esperar();
    const vence = token.expira ? new Date(token.expira * 1000).toLocaleTimeString() : "?";
    b.log("info", "token", `token de api-cpe listo en ${((Date.now() - t0) / 1000).toFixed(1)} s (vence ${vence})`);

    const api = new ClienteApi(b, ctx.request, () => token.valor, "A");
    for (const p of base) await pruebaXml(api, p, "A-xml");
    const apiB = new ClienteApi(b, ctx.request, () => token.valor, "B");
    for (const p of base) {
      const r = await apiB.consultar(p);
      anotar({ prueba: "B-cabecera", comprobante: etiqueta(p), status: r.status, clase: r.clase, ms: r.ms, nota: r.texto.slice(0, 200) });
    }
    for (const p of base) await pruebaPdf(api, p);
    await pruebaLista(api, base[0]);
    const paralelo = [];
    let resto = extra;
    for (const c of [1, 4, 8]) {
      const tanda = resto.slice(0, Math.max(c * 2, 4));
      resto = resto.slice(tanda.length);
      if (tanda.length) paralelo.push(await pruebaParalelo(api, tanda, c));
    }
    return { paralelo };
  } finally {
    await nav.close().catch(() => {});
  }
}

const { paralelo } = await principal(b).catch(e => {
  b.log("error", "sondeo", primeraLinea(e));
  return { paralelo: [] };
});

// Informe: por prueba, cuántos OK, tiempo mediano y los estados HTTP que devolvió SUNAT.
const porPrueba = new Map<string, Medida[]>();
for (const m of medidas) porPrueba.set(m.prueba.replace(/ \(.*\)$/, ""), [...(porPrueba.get(m.prueba.replace(/ \(.*\)$/, "")) ?? []), m]);
const tabla = [...porPrueba.entries()].map(([prueba, ms]) => {
  const t = ms.map(m => m.ms).sort((x, y) => x - y);
  const estados: Record<string, number> = {};
  for (const m of ms) estados[m.status] = (estados[m.status] ?? 0) + 1;
  return { prueba, intentos: ms.length, ok: ms.filter(m => m.clase === "OK").length, msMediano: t[Math.floor(t.length / 2)] ?? 0, estados };
});
writeFileSync(join(b.dir, "informe.json"), JSON.stringify({ tabla, paralelo, http: b.conteoHttp(), medidas }, null, 2));
console.log("\n── Informe ──");
for (const f of tabla)
  console.log(
    `${f.prueba.padEnd(22)} ${String(f.ok).padStart(3)}/${String(f.intentos).padEnd(3)} OK · mediana ${String(f.msMediano).padStart(5)} ms · HTTP ${JSON.stringify(f.estados)}`,
  );
for (const p of paralelo)
  console.log(`paralelo ${p.concurrencia}: ${p.n} en ${p.segundos}s → ${p.porMinuto}/min ${JSON.stringify(p.clases)}`);
console.log("\nEstados HTTP por servicio:");
for (const [k, n] of Object.entries(b.conteoHttp())) console.log(`${String(n).padStart(4)}× ${k}`);
console.log(`\nDetalle: ${join(b.dir, "informe.json")} · errores HTTP crudos: ${join(b.dir, "http.jsonl")}`);
