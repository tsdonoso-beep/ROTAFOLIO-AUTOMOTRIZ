// El domicilio fiscal de los proveedores y clientes, desde el padrón reducido de SUNAT
//
// SUNAT publica cada día un archivo con todos los RUC del país
// (padron_reducido_ruc.zip, ~400 MB). Esto lo baja, lo lee de corrido sin
// descomprimirlo a disco (unzip -p) y guarda en ruc_domicilio solo los RUC
// que nos importan (rucs_para_domicilio: proveedores, clientes, Base de
// Compras). Los nombres del ubigeo (San Isidro, Lima…) salen de la lista del
// INEI del paquete npm «ubigeo-peru», que se baja en cada corrida (no se
// guarda en el repositorio).
//
// No necesita Clave SOL ni navegador: es un archivo público. Pedido de
// Contabilidad (06/10/2026): ver dónde está cada proveedor sin entrar a la
// Consulta RUC.
//
// Variables: SUPABASE_URL, SUPABASE_ANON_KEY, ROBOT_CORREO, ROBOT_CLAVE.
//   DEBUG=1            solo lee y escribe salida/padron-domicilios/domicilios.json, sin tocar la base.
//   PADRON_ZIP=ruta    usa un zip ya bajado (para probar sin bajar 400 MB).
//   RUCS=ruc1,ruc2     en vez de pedir la lista a la base.

import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createClient } from "@supabase/supabase-js";
import { leerLineaPadron, lugarDeUbigeo, ubigeosDesdeLista, type Ubigeos } from "../lib/sunat/padron-reducido.ts";

const DEBUG = process.env.DEBUG === "1";
const URL_PADRON = "http://www2.sunat.gob.pe/padron_reducido_ruc.zip";
const URL_UBIGEO = "https://registry.npmjs.org/ubigeo-peru/-/ubigeo-peru-2.0.2.tgz";
const SALIDA = join(process.cwd(), "salida", "padron-domicilios");
mkdirSync(SALIDA, { recursive: true });

function leer(...nombres: string[]): string {
  for (const n of nombres) { const v = (process.env[n] ?? "").trim(); if (v) return v; }
  console.error(`✗ Falta ${nombres.join(" o ")} en el entorno.`);
  process.exit(1);
}

/** Corre un programa y devuelve lo que escribió (para tar). */
function correr(cmd: string, args: string[], entrada?: Buffer): Promise<Buffer> {
  return new Promise((ok, mal) => {
    const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"] });
    const trozos: Buffer[] = [];
    p.stdout.on("data", d => trozos.push(d));
    p.on("error", mal);
    p.on("close", c => c === 0 ? ok(Buffer.concat(trozos)) : mal(new Error(`${cmd} terminó con ${c}`)));
    p.stdin.end(entrada);
  });
}

async function nombresDeUbigeo(): Promise<Ubigeos> {
  const r = await fetch(URL_UBIGEO);
  if (!r.ok) throw new Error(`No se pudo bajar la lista de ubigeos (${r.status}).`);
  const json = await correr("tar", ["-xzO", "package/src/ubigeo-inei.json"], Buffer.from(await r.arrayBuffer()));
  return ubigeosDesdeLista(JSON.parse(json.toString("utf8")));
}

async function bajarPadron(): Promise<string> {
  const local = process.env.PADRON_ZIP?.trim();
  if (local) return local;
  const destino = join(SALIDA, "padron_reducido_ruc.zip");
  const t0 = Date.now();
  const r = await fetch(URL_PADRON);
  if (!r.ok || !r.body) throw new Error(`SUNAT no entregó el padrón (${r.status}).`);
  await pipeline(Readable.fromWeb(r.body as never), createWriteStream(destino));
  console.log(`· Padrón bajado en ${Math.round((Date.now() - t0) / 1000)}s`);
  return destino;
}

const sb = DEBUG && process.env.RUCS ? null : createClient(leer("SUPABASE_URL", "PROJECT_URL"), leer("SUPABASE_ANON_KEY", "ANON_KEY"),
  { auth: { persistSession: false } });
if (sb) {
  const { error } = await sb.auth.signInWithPassword({ email: leer("ROBOT_CORREO"), password: leer("ROBOT_CLAVE") });
  if (error) { console.error(`✗ No se pudo entrar a la base: ${error.message}`); process.exit(1); }
}

// A quién buscar.
let buscados: Set<string>;
if (process.env.RUCS?.trim()) {
  buscados = new Set(process.env.RUCS.split(",").map(r => r.trim()).filter(r => /^\d{11}$/.test(r)));
} else {
  // La base entrega de a 1000 filas: se pide por páginas hasta que no venga ninguna.
  buscados = new Set();
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await sb!.rpc("rucs_para_domicilio").range(desde, desde + 999);
    if (error) { console.error(`✗ rucs_para_domicilio: ${error.message}`); process.exit(1); }
    const pagina = (data ?? []) as Array<{ ruc: string }>;
    pagina.forEach(f => buscados.add(f.ruc));
    if (pagina.length < 1000) break;
  }
}
console.log(`· ${buscados.size} RUC por buscar en el padrón`);

const [nombres, zip] = await Promise.all([nombresDeUbigeo(), bajarPadron()]);
if (!existsSync(zip)) { console.error(`✗ No existe ${zip}`); process.exit(1); }

// Leer el padrón de corrido: unzip -p | latin1 → líneas.
const t0 = Date.now();
// En Windows no hay unzip: su tar (bsdtar, viene con Windows 10/11) también lee zip.
const unzip = process.platform === "win32"
  ? spawn("tar", ["-xOf", zip], { stdio: ["ignore", "pipe", "inherit"] })
  : spawn("unzip", ["-p", zip], { stdio: ["ignore", "pipe", "inherit"] });
unzip.stdout.setEncoding("latin1");
const filas: Array<Record<string, string>> = [];
let leidas = 0;
for await (const linea of createInterface({ input: unzip.stdout, crlfDelay: Infinity })) {
  leidas++;
  if (!buscados.has(linea.slice(0, 11))) continue;
  const d = leerLineaPadron(linea);
  if (!d) continue;
  filas.push({ ...d, ...lugarDeUbigeo(d.ubigeo, nombres) });
}
console.log(`· ${leidas.toLocaleString("es-PE")} líneas leídas en ${Math.round((Date.now() - t0) / 1000)}s: ${filas.length} de los ${buscados.size} RUC están en el padrón`);
const conDireccion = filas.filter(f => f.direccion).length;
console.log(`· ${conDireccion} con dirección (las personas naturales vienen sin ella)`);
writeFileSync(join(SALIDA, "domicilios.json"), JSON.stringify(filas));

if (DEBUG || !sb) {
  console.log("· DEBUG: no se toca la base. Muestra:", filas.slice(0, 3));
  process.exit(0);
}
if (!filas.length) { console.error("✗ El padrón no trajo ninguno de nuestros RUC: no se guarda nada."); process.exit(1); }

let guardados = 0;
for (let i = 0; i < filas.length; i += 1000) {
  const { data, error } = await sb.rpc("guardar_domicilios_ruc", { p_filas: filas.slice(i, i + 1000) });
  if (error) { console.error(`✗ guardar_domicilios_ruc: ${error.message}`); process.exit(1); }
  guardados += Number(data) || 0;
}
console.log(`✓ ${guardados} domicilios guardados en la base`);
