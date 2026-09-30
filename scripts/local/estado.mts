// Cómo van las corridas: lee logs/cpe-*/estado.json (lo escribe cada latido) sin tocar las corridas.
//
//   pnpm cpe:estado        todas las corridas de hoy
//   pnpm cpe:estado 1      solo la más reciente

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ORDEN, TITULO } from "./comun/etapas.mts";

const LOGS = join(process.cwd(), "logs");
const hoy = new Date().toISOString().slice(0, 10);
const cuantas = Number(process.argv[2] ?? 0);
let dirs = existsSync(LOGS) ? readdirSync(LOGS).filter(d => d.startsWith("cpe-") && existsSync(join(LOGS, d, "estado.json"))) : [];
dirs = dirs.filter(d => d.includes(hoy)).sort((a, b) => statSync(join(LOGS, b)).mtimeMs - statSync(join(LOGS, a)).mtimeMs);
if (cuantas > 0) dirs = dirs.slice(0, cuantas);
if (!dirs.length) { console.log("No hay corridas de hoy con estado.json (se escribe desde el primer latido, a los 30 s)."); process.exit(0); }

for (const d of dirs) {
  const e = JSON.parse(readFileSync(join(LOGS, d, "estado.json"), "utf8"));
  const hace = Math.round((Date.now() - new Date(e.actualizado).getTime()) / 1000);
  const viva = e.terminada ? "TERMINADA" : hace > 90 ? `¿DETENIDA? (sin latido hace ${hace}s)` : `en curso (latido hace ${hace}s)`;
  const pr = e.progreso ?? {};
  console.log(`\n■ ${d} · ${e.minutos} min · ${viva}`);
  if (pr.total) console.log(`  ${pr.hechos}/${pr.total} terminados de punta a punta (${Math.round(100 * pr.hechos / pr.total)}%)`);
  for (const k of ORDEN) {
    const et = e.etapas[k];
    const { estado, duracion } = et;
    const n = Object.fromEntries(Object.entries(et).filter(([c]) => !["titulo", "estado", "inicio", "fin", "duracion"].includes(c)));
    const marca = estado === "terminada" ? "✔" : estado === "en curso" ? "…" : estado === "omitida" ? "—" : " ";
    const nums = Object.entries(n).map(([c, v]) => `${c} ${v}`).join(" · ");
    console.log(`  ${marca} ${TITULO[k].padEnd(16)} ${String(estado).padEnd(10)} ${duracion ?? ""}${nums ? "  ·  " + nums : ""}`);
  }
}
