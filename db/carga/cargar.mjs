import { createClient } from "@supabase/supabase-js";

// Nada de secretos en el archivo: el repositorio es público.
//   SUPABASE_URL=… SUPABASE_ANON_KEY=… CLAVE_INICIAL=… node db/carga/cargar.mjs [--escribir]
const { SUPABASE_URL: URL, SUPABASE_ANON_KEY: ANON, CLAVE_INICIAL: CLAVE } = process.env;
if (!URL || !ANON || !CLAVE) {
  console.error("Faltan SUPABASE_URL, SUPABASE_ANON_KEY o CLAVE_INICIAL en el entorno.");
  process.exit(1);
}
import { readFileSync } from "node:fs";
const SECO = !process.argv.includes("--escribir");
const F = JSON.parse(readFileSync("/tmp/fuente.json", "utf8"));

const sb = createClient(URL, ANON);
await sb.auth.signInWithPassword({ email: "36532278@sin-correo.local", password: CLAVE });

// Las siete cuentas de prueba son personas reales con DNI inventado. Se
// ACTUALIZAN en su sitio, no se reemplazan: tienen memos y gastos colgando.
const EQUIVALE = {
  "Alonzo Huanca": "Alonzo Huanca Dueñas",
  "Annie Mantilla": "Annie Mantilla",
  "Camila García Rosell": "Camila Garcia Rosell",
  "Justo Lavilla": "Justo Lavilla",
  "Rosa Aucca": "Rosa Gely Aucca Chuquizuta",
  "Tomás Donoso": "Tomas Donoso",
};

const { data: actuales } = await sb.from("usuarios").select("id, dni, nombre, email, auth_id");
const porNombreReal = new Map(F.personas.map(p => [p.nombre, p]));
const plan = { actualizar: [], insertar: [], intactos: [] };

for (const a of actuales) {
  const real = porNombreReal.get(EQUIVALE[a.nombre] ?? "");
  if (real) plan.actualizar.push({ id: a.id, de: a, a: real });
  else plan.intactos.push(a);
}
const yaMapeados = new Set(plan.actualizar.map(x => x.a.dni));
plan.insertar = F.personas.filter(p => !yaMapeados.has(p.dni));

console.log("╔══ LO QUE VA A PASAR " + (SECO ? "(corrida en seco)" : "(ESCRIBIENDO)") + " ══╗\n");
console.log("ACTUALIZAR en su sitio — conservan sus memos y gastos:");
for (const x of plan.actualizar)
  console.log(`   ${x.de.nombre.padEnd(24)} dni ${x.de.dni} → ${x.a.dni}   ${x.a.nombre}`);
console.log(`\nINSERTAR: ${plan.insertar.length} personas nuevas`);
console.log("\nNI SE TOCAN:");
for (const x of plan.intactos) console.log(`   ${x.nombre} (dni ${x.dni})`);
console.log(`\nÁREAS: ${F.areas.length}   ·   CENTROS DE COSTO: ${F.centros.length}`);

if (SECO) { console.log("\n(nada se escribió — agrega --escribir)"); process.exit(0); }

const ok = (e, q) => { if (e) { console.error("✗ " + q + ": " + e.message); process.exit(1); } };
console.log("\n── escribiendo ──");

// ── 1. Áreas ──
const { data: arActuales } = await sb.from("areas").select("id, nombre");
const arPorNombre = new Map(arActuales.map(a => [a.nombre, a.id]));
const faltan = F.areas.filter(n => !arPorNombre.has(n));
if (faltan.length) {
  const { data, error } = await sb.from("areas").insert(faltan.map(nombre => ({ nombre }))).select("id, nombre");
  ok(error, "insertar áreas");
  for (const a of data) arPorNombre.set(a.nombre, a.id);
}
console.log(`   áreas: ${faltan.length} nuevas, ${arPorNombre.size} en total`);

// ── 2. Personas: primero la ficha, sin jefatura ──
for (const x of plan.actualizar) {
  const { error } = await sb.from("usuarios").update({
    dni: x.a.dni, dni_provisional: false, nombre: x.a.nombre, email: x.a.email,
    area_id: x.a.area ? arPorNombre.get(x.a.area) ?? null : null, activo: true,
  }).eq("id", x.id);
  ok(error, "actualizar " + x.a.nombre);
}
if (plan.insertar.length) {
  const { error } = await sb.from("usuarios").insert(plan.insertar.map(p => ({
    dni: p.dni, dni_provisional: false, nombre: p.nombre, email: p.email,
    area_id: p.area ? arPorNombre.get(p.area) ?? null : null, activo: true,
  })));
  ok(error, "insertar personas");
}
console.log(`   personas: ${plan.actualizar.length} actualizadas, ${plan.insertar.length} insertadas`);

// ── 3. Jefatura: segunda pasada, ya con todos creados ──
const { data: todos } = await sb.from("usuarios").select("id, dni");
const idPorDni = new Map(todos.map(u => [u.dni, u.id]));
let conJefe = 0, sinJefe = 0;
for (const p of F.personas) {
  const jefeId = p.jefe ? idPorDni.get(p.jefe) : null;
  if (p.jefe && !jefeId) { console.log(`   ⚠ ${p.nombre}: su jefe ${p.jefe} no está`); continue; }
  const { error } = await sb.from("usuarios").update({ jefatura_id: jefeId }).eq("id", idPorDni.get(p.dni));
  ok(error, "jefatura de " + p.nombre);
  jefeId ? conJefe++ : sinJefe++;
}
console.log(`   jefatura: ${conJefe} con jefe, ${sinJefe} encabezan su área`);

// ── 4. Roles ──
for (const p of F.personas) {
  const id = idPorDni.get(p.dni);
  await sb.from("roles_usuario").delete().eq("usuario_id", id);
  const { error } = await sb.from("roles_usuario").insert(p.roles.map(rol => ({ usuario_id: id, rol })));
  ok(error, "roles de " + p.nombre);
}
console.log(`   roles: asignados a ${F.personas.length} personas`);

// ── 5. Centros de costo ──
const { data: emp } = await sb.from("empresas").select("id, abreviatura");
const empPorAbrev = new Map(emp.map(e => [e.abreviatura, e.id]));
const { data: ceActuales } = await sb.from("centros_costo").select("id, codigo");
const cePorCodigo = new Map(ceActuales.map(c => [c.codigo, c.id]));
let ceNuevos = 0, ceAct = 0;
for (const c of F.centros) {
  const fila = { codigo: c.codigo, nombre: c.nombre, empresa_id: empPorAbrev.get(c.empresa), activo: c.activo };
  const existe = cePorCodigo.get(c.codigo);
  if (existe) { ok((await sb.from("centros_costo").update(fila).eq("id", existe)).error, "ceco " + c.codigo); ceAct++; }
  else { ok((await sb.from("centros_costo").insert(fila)).error, "ceco " + c.codigo); ceNuevos++; }
}
console.log(`   centros de costo: ${ceNuevos} nuevos, ${ceAct} actualizados`);
console.log("\n── listo. Faltan las cuentas de acceso (van por SQL) ──");
