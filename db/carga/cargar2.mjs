import { createClient } from "@supabase/supabase-js";

// Nada de secretos en el archivo: el repositorio es público.
//   SUPABASE_URL=… SUPABASE_ANON_KEY=… CLAVE_INICIAL=… node db/carga/cargar2.mjs [--escribir]
const { SUPABASE_URL: URL, SUPABASE_ANON_KEY: ANON, CLAVE_INICIAL: CLAVE } = process.env;
if (!URL || !ANON || !CLAVE) {
  console.error("Faltan SUPABASE_URL, SUPABASE_ANON_KEY o CLAVE_INICIAL en el entorno.");
  process.exit(1);
}
import { readFileSync } from "node:fs";
const F = JSON.parse(readFileSync("/tmp/fuente.json", "utf8"));
const sb = createClient(URL, ANON);
await sb.auth.signInWithPassword({ email: "75328441@sin-correo.local", password: CLAVE });
const { data: a } = await sb.auth.getUser();
const { data: yo } = await sb.from("usuarios").select("id, nombre").eq("auth_id", a.user.id).single();
console.log("entré como:", yo.nombre);
const ok = (e,q) => { if (e) { console.error("✗ " + q + ": " + e.message); process.exit(1); } };

const { data: todos } = await sb.from("usuarios").select("id, dni");
const idPorDni = new Map(todos.map(u => [u.dni, u.id]));
const { data: yaTiene } = await sb.from("roles_usuario").select("usuario_id, rol");
const actual = new Map();
for (const r of yaTiene) { if (!actual.has(r.usuario_id)) actual.set(r.usuario_id, new Set()); actual.get(r.usuario_id).add(r.rol); }

// Por diferencia: se agrega lo que falta y se quita lo que sobra. Borrar
// primero y reinsertar dejaba un instante sin permisos, y a quien ejecuta
// esto la política le negaba su propia reinserción.
let sumados = 0, quitados = 0;
for (const p of F.personas) {
  const id = idPorDni.get(p.dni); if (!id) continue;
  const tiene = actual.get(id) ?? new Set();
  const faltan = p.roles.filter(r => !tiene.has(r));
  const sobran = [...tiene].filter(r => !p.roles.includes(r));
  if (faltan.length) { ok((await sb.from("roles_usuario").insert(faltan.map(rol => ({ usuario_id: id, rol })))).error, "roles+ " + p.nombre); sumados += faltan.length; }
  for (const rol of sobran) {
    if (id === yo.id && rol === "ADMIN_SISTEMA") continue;   // nunca quitarse el propio acceso
    ok((await sb.from("roles_usuario").delete().eq("usuario_id", id).eq("rol", rol)).error, "roles- " + p.nombre);
    quitados++;
  }
}
console.log(`roles: +${sumados} / -${quitados}`);

const { data: emp } = await sb.from("empresas").select("id, abreviatura");
const empPorAbrev = new Map(emp.map(e => [e.abreviatura, e.id]));
const { data: ceA } = await sb.from("centros_costo").select("id, codigo");
const cePorCodigo = new Map(ceA.map(c => [c.codigo, c.id]));
let nuevos = 0, act = 0;
for (const c of F.centros) {
  const fila = { codigo: c.codigo, nombre: c.nombre, empresa_id: empPorAbrev.get(c.empresa), activo: c.activo };
  const ex = cePorCodigo.get(c.codigo);
  if (ex) { ok((await sb.from("centros_costo").update(fila).eq("id", ex)).error, "ceco " + c.codigo); act++; }
  else { ok((await sb.from("centros_costo").insert(fila)).error, "ceco " + c.codigo); nuevos++; }
}
console.log(`centros de costo: ${nuevos} nuevos, ${act} actualizados`);
