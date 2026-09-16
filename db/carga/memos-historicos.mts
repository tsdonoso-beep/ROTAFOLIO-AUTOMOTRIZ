// Carga el histórico de memos de viáticos con su anexo
//
//   python3 db/carga/leer-seguimiento.py SEGUIMIENTO.xlsx > /tmp/seguimiento.json
//   SUPABASE_URL=… SUPABASE_ANON_KEY=… CLAVE_INICIAL=… \
//     node --experimental-strip-types db/carga/memos-historicos.mts [--escribir]
//
// Corre EN SECO salvo que se le pase --escribir. Sin esa bandera imprime el
// plan y no toca nada.
//
// ── Por qué esta fuente y no el MemoTracker ──────────────────────
//
// El MemoTracker tiene el flujo: el hilo de correo, la aprobación, la carpeta
// y el pago. Lo que NO tiene es a quiénes cubre cada memo ni cuánto le tocó a
// cada uno: eso vive dentro del anexo del Word y nadie lo abre.
//
// El seguimiento de Control de Gestión sí lo tiene, fila por fila, para 520
// memos-persona. Y trae además las fechas de salida y llegada de CADA persona,
// que es lo que hace falta para medir vencimientos sin atribuirle a una el
// plazo de otra.
//
// ── Alcance de esta carga ────────────────────────────────────────
//
// Solo los 213 memos de viáticos que tienen anexo. Los 125 de hospedaje y caja
// chica viven en otra hoja, van por responsable y no por persona, y los de
// caja chica necesitan además que exista su caja. Son una segunda fase con
// decisiones propias; mezclarlas acá sería cargar la mitad de cada cosa.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const { SUPABASE_URL: URL, SUPABASE_ANON_KEY: ANON, CLAVE_INICIAL: CLAVE } = process.env;
if (!URL || !ANON || !CLAVE) {
  console.error("Faltan SUPABASE_URL, SUPABASE_ANON_KEY o CLAVE_INICIAL en el entorno.");
  process.exit(1);
}

const SECO = !process.argv.includes("--escribir");
const RUC = process.env.EMPRESA_RUC ?? "20512201611";
const F = JSON.parse(readFileSync(process.env.FUENTE ?? "/tmp/seguimiento.json", "utf8")) as Fuente;

interface Persona {
  dni: string; nombre: string; cargo: string; activo: boolean;
  banco: string; cuenta: string; cci: string; correo: string;
}
interface FilaAnexo {
  correlativo: string; dni: string; nombre: string; proyecto: string;
  tipo: string; status: string; monto: number | null;
  fecha_desde: string | null; fecha_hasta: string | null; carpeta: string;
}
interface Fuente { personas: Persona[]; anexo: FilaAnexo[] }

// ── Del vocabulario de Control de Gestión al nuestro ─────────────
//
// El número dice cuánto trabajo falta, y el estado del memo es el MENOS
// avanzado de su gente: si una persona no presentó, el memo no está
// presentado. En 73 de los 213 memos la gente no coincide, así que esto
// decide de verdad y no es un detalle.
const AVANCE: Record<string, { estado: string; orden: number }> = {
  "VIGENTE":         { estado: "ABIERTO",      orden: 0 },
  "POR REGULARIZAR": { estado: "EN_RENDICION", orden: 1 },
  "OBSERVADO":       { estado: "OBSERVADA",    orden: 2 },
  "EN REVISIÓN":     { estado: "PRESENTADA",   orden: 3 },
  "PRESENTADO":      { estado: "PRESENTADA",   orden: 3 },
  "REVISADO":        { estado: "PRESENTADA",   orden: 3 },
};

const sb = createClient(URL, ANON);
const { error: eAuth } = await sb.auth.signInWithPassword({
  email: process.env.CORREO_ADMIN ?? "36532278@sin-correo.local",
  password: CLAVE,
});
if (eAuth) { console.error("No se pudo entrar:", eAuth.message); process.exit(1); }

const { data: empresa } = await sb.from("empresas").select("id").eq("ruc", RUC).single();
if (!empresa) { console.error(`No existe la empresa con RUC ${RUC}.`); process.exit(1); }

const { data: cecos } = await sb.from("centros_costo").select("id, codigo, abreviatura");
const porAbrev = new Map((cecos ?? []).filter(c => c.abreviatura).map(c => [c.abreviatura!, c.id]));

const { data: usuarios } = await sb.from("usuarios").select("id, dni, nombre, activo");
const porDni = new Map((usuarios ?? []).filter(u => u.dni).map(u => [u.dni!, u]));

// ── Plan: personas ───────────────────────────────────────────────
//
// Entran también los cesados. Quien dejó la empresa sin rendir es justamente
// la plata que cuesta recuperar: si no existe en la base, su deuda tampoco.
// Entran con `activo` en false y sin cuenta de acceso: figuran para atribuir y
// cobrar, no para entrar a la aplicación.
const conMemo = new Set(F.anexo.map(a => a.dni));
const porCrear = F.personas
  .filter(p => conMemo.has(p.dni) && !porDni.has(p.dni))
  .map(p => ({
    dni: p.dni,
    nombre: p.nombre,
    // Los técnicos de campo usan su correo personal y treinta y dos no tienen
    // ninguno. El padrón ya resolvió esto antes con un dominio que no existe:
    // vale como identificador único y no es una dirección a la que se pueda
    // escribir por error.
    email: p.correo || `${p.dni}@sin-correo.local`,
    activo: p.activo,
    // El DNI viene de la ficha de contrato de Recursos Humanos, no es uno
    // inventado para poder crear la cuenta: entra como definitivo.
    dni_provisional: false,
  }));

// Las cuentas bancarias de estas personas están en la misma ficha y la tabla
// que las guarda existe y está vacía. No se cargan acá a propósito: escribir
// cincuenta y un números de cuenta en producción es una decisión aparte de
// cargar el histórico, y merece su propio sí. Va con el generador del memo,
// que es quien las necesita de verdad.

const sinFicha = [...conMemo].filter(d => !porDni.has(d) && !F.personas.some(p => p.dni === d));

// ── Plan: memos ──────────────────────────────────────────────────
const grupos = new Map<string, FilaAnexo[]>();
for (const f of F.anexo) {
  if (!grupos.has(f.correlativo)) grupos.set(f.correlativo, []);
  grupos.get(f.correlativo)!.push(f);
}

const { data: yaEstan } = await sb
  .from("memos").select("id, correlativo").eq("empresa_id", empresa.id);
const memoPorCorrelativo = new Map((yaEstan ?? []).map(m => [m.correlativo, m.id]));

const plan: Array<{
  correlativo: string; estado: string; ceco: string | null; proyecto: string;
  monto: number; personas: number; desde: string | null; hasta: string | null;
  carpeta: string; existe: boolean; sinPersona: string[];
}> = [];

for (const [correlativo, filas] of grupos) {
  const avances = filas.map(f => AVANCE[f.status]).filter(Boolean);
  const menor = avances.length
    ? avances.reduce((a, b) => (a.orden <= b.orden ? a : b))
    : { estado: "ABIERTO", orden: 0 };

  const abrev = filas.find(f => f.proyecto)?.proyecto ?? "";
  const desdes = filas.map(f => f.fecha_desde).filter(Boolean) as string[];
  const hastas = filas.map(f => f.fecha_hasta).filter(Boolean) as string[];

  plan.push({
    correlativo,
    estado: menor.estado,
    ceco: porAbrev.get(abrev) ?? null,
    proyecto: abrev,
    // El monto del memo es la suma de su anexo, nunca un número aparte. Es la
    // invariante que memo_cuadra() comprueba, y la que el memo 194-2026
    // rompió: S/ 500.00 en el párrafo contra S/ 1,500.00 en la tabla.
    monto: Math.round(filas.reduce((s, f) => s + (f.monto ?? 0), 0) * 100) / 100,
    personas: filas.length,
    desde: desdes.length ? desdes.sort()[0] : null,
    hasta: hastas.length ? hastas.sort()[hastas.length - 1] : null,
    carpeta: filas.find(f => f.carpeta)?.carpeta ?? "",
    existe: memoPorCorrelativo.has(correlativo),
    sinPersona: filas.filter(f => !porDni.has(f.dni) && !porCrear.some(p => p.dni === f.dni))
                     .map(f => f.dni),
  });
}

// ── Qué se va a hacer ────────────────────────────────────────────
const sinCeco = plan.filter(p => !p.ceco);
const sinMonto = plan.filter(p => p.monto <= 0);
const sinFechas = plan.filter(p => !p.desde || !p.hasta);
const nuevos = plan.filter(p => !p.existe);

console.log(`\n${SECO ? "EN SECO — no se escribe nada" : "ESCRIBIENDO"}\n`);
console.log(`Personas    ${porCrear.length} por crear · ${conMemo.size - porCrear.length} ya están`);
if (sinFicha.length) console.log(`            ${sinFicha.length} con memo pero sin ficha de contrato: ${sinFicha.join(", ")}`);
console.log(`            cesadas entre las nuevas: ${porCrear.filter(p => !p.activo).length}`);
console.log(`\nMemos       ${nuevos.length} por crear · ${plan.length - nuevos.length} ya existen`);
console.log(`            ${F.anexo.length} filas de anexo`);
console.log(`            S/ ${plan.reduce((s, p) => s + p.monto, 0).toLocaleString("es-PE", { minimumFractionDigits: 2 })} en total`);

const porEstado = plan.reduce<Record<string, number>>((a, p) => ({ ...a, [p.estado]: (a[p.estado] ?? 0) + 1 }), {});
console.log(`            estados: ${Object.entries(porEstado).map(([k, v]) => `${k} ${v}`).join(" · ")}`);

console.log(`\nSe quedan fuera`);
console.log(`            ${sinCeco.length} sin centro de costo reconocido`);
if (sinCeco.length) {
  const cuales = [...new Set(sinCeco.map(p => p.proyecto || "(vacío)"))];
  console.log(`              proyectos: ${cuales.join(" · ")}`);
}
console.log(`            ${sinMonto.length} sin monto`);
console.log(`            ${sinFechas.length} sin fechas completas (entran igual, las fechas quedan en null)`);

const cargables = plan.filter(p => !p.existe && p.ceco && p.monto > 0);
console.log(`\nEntran      ${cargables.length} memos\n`);

if (SECO) {
  console.log("Para aplicarlo: agregar --escribir\n");
  process.exit(0);
}

// ── Escribir ─────────────────────────────────────────────────────
let creadas = 0;
for (const p of porCrear) {
  const { error } = await sb.from("usuarios").insert(p);
  if (error) console.error(`  ✗ persona ${p.dni}: ${error.message}`);
  else creadas++;
}
console.log(`Personas creadas: ${creadas}`);

const { data: todos } = await sb.from("usuarios").select("id, dni");
const idPorDni = new Map((todos ?? []).filter(u => u.dni).map(u => [u.dni!, u.id]));
const { data: yo } = await sb.from("usuarios").select("id").eq("auth_id",
  (await sb.auth.getUser()).data.user?.id ?? "").single();

let memosOk = 0, anexoOk = 0;
for (const p of cargables) {
  const { data: memo, error } = await sb.from("memos").insert({
    correlativo: p.correlativo,
    tipo: "VIATICOS",
    empresa_id: empresa.id,
    centro_costo_id: p.ceco,
    monto_autorizado: p.monto,
    moneda: "PEN",
    estado: p.estado,
    fecha_salida: p.desde,
    fecha_retorno_prev: p.hasta,
    drive_folder_id: p.carpeta || null,
    creado_por: yo?.id,
  }).select("id").single();

  if (error) { console.error(`  ✗ memo ${p.correlativo}: ${error.message}`); continue; }
  memosOk++;

  const filas = grupos.get(p.correlativo)!
    .filter(f => idPorDni.has(f.dni))
    .map(f => ({
      memo_id: memo.id,
      usuario_id: idPorDni.get(f.dni)!,
      monto: f.monto,
      fecha_desde: f.fecha_desde,
      fecha_hasta: f.fecha_hasta,
    }));

  if (filas.length) {
    const { error: e2 } = await sb.from("memo_asignados").insert(filas);
    if (e2) console.error(`  ✗ anexo de ${p.correlativo}: ${e2.message}`);
    else anexoOk += filas.length;
  }
}

console.log(`Memos creados: ${memosOk} · filas de anexo: ${anexoOk}\n`);
