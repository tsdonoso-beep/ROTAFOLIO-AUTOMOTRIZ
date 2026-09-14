// La consulta diaria a SUNAT
//
// Corre en GitHub Actions, no en Vercel: allá un cron solo puede correr una
// vez al día y cada ejecución muere al minuto, mientras que el ticket de
// SUNAT tarda entre uno y tres minutos.
//
// Consulta el mes en curso y el anterior. El anterior porque los proveedores
// siguen declarando después del cierre, así que un mes «terminado» cambia
// durante semanas; el actual para ver lo que va entrando.
//
// Entra con la cuenta del robot, no con la de una persona. Así la bitácora
// dice quién consultó, y la clave de nadie vive en un servidor.

import { createClient } from "@supabase/supabase-js";
import { credencialesDe } from "../lib/sunat/credenciales.ts";
import { pedirExportacion, consultarTicket, bajarArchivo } from "../lib/sunat/sire.ts";
import { periodoDe, periodoCerradoAnterior, validarPeriodo } from "../lib/sunat/periodo.ts";
import { leerZip } from "../lib/sunat/zip.ts";
import { leerPropuestaRce, revisarIdentidad } from "../lib/sunat/rce.ts";
import { filasComprobantesSunat, type ComprobanteHistorico } from "../lib/export/comprobantes-sunat.ts";
import { aCsv } from "../lib/export/csv.ts";
import { publicarHoja } from "../lib/drive/servidor.ts";

const EMPRESA = process.env.SUNAT_EMPRESA ?? "INROPRIN";
const RUC     = process.env.SUNAT_RUC ?? "20512201611";

/** Corta la ejecución diciendo qué falta, en vez de fallar más adelante. */
function exigir(nombre: string): string {
  const v = (process.env[nombre] ?? "").trim();
  if (!v) {
    console.error(`✗ Falta la variable ${nombre}. Se ponen en Settings · Secrets del repositorio.`);
    process.exit(1);
  }
  return v;
}

const url    = exigir("SUPABASE_URL");
const anon   = exigir("SUPABASE_ANON_KEY");
const correo = exigir("ROBOT_CORREO");
const clave  = exigir("ROBOT_CLAVE");

const leidas = credencialesDe(EMPRESA, RUC, process.env);
if (!leidas.ok) { console.error("✗ " + leidas.motivo); process.exit(1); }
const cred = leidas.cred;

const sb = createClient(url, anon, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { error: eLogin } = await sb.auth.signInWithPassword({
  email: correo, password: clave,
});
if (eLogin) { console.error("✗ El robot no pudo entrar:", eLogin.message); process.exit(1); }

/** Espera a que SUNAT tenga listo el archivo. */
async function esperarTicket(periodo: string, ticket: string) {
  const limite = Date.now() + 6 * 60 * 1000;
  while (Date.now() < limite) {
    await new Promise(r => setTimeout(r, 8000));
    const t = await consultarTicket(cred, periodo, ticket);
    if (!t) continue;
    if (t.fallado) throw new Error(`SUNAT rechazó el proceso: ${t.descripcion}`);
    if (t.terminado && t.archivo) {
      return {
        ...t.archivo,
        periodo: t.archivo.periodo || periodo,
        numTicket: t.archivo.numTicket || ticket,
      };
    }
  }
  throw new Error(`El ticket ${ticket} no terminó en seis minutos.`);
}

async function consultar(periodo: string): Promise<boolean> {
  const arranque = Date.now();
  console.log(`\n── ${periodo} ──`);

  const ticket = await pedirExportacion(cred, periodo, "csv");
  console.log(`  ticket ${ticket}`);

  const archivo = await esperarTicket(periodo, ticket);
  console.log(`  archivo ${archivo.nombre}`);

  const dentro = leerZip(await bajarArchivo(cred, archivo));
  if (dentro.length === 0) throw new Error("El archivo de SUNAT vino vacío.");
  const reporte = dentro.reduce((a, b) => (b.contenido.length > a.contenido.length ? b : a));

  const { filas, ...lectura } = leerPropuestaRce(reporte.contenido.toString("utf8"));
  const identidad = revisarIdentidad(filas, cred.ruc);
  if (!identidad.ok) console.error(`  ⚠ ${identidad.motivo}`);
  console.log(`  ${filas.length} comprobantes leídos`);

  const { data: g, error: eG } = await sb.rpc("guardar_comprobantes_sunat", {
    p_empresa_ruc: cred.ruc, p_periodo: periodo, p_filas: filas,
  });
  if (eG) throw new Error(`No se pudieron guardar: ${eG.message}`);
  const guardado = (Array.isArray(g) ? g[0] : g) ?? { nuevos: 0, cambiados: 0 };
  console.log(`  ${guardado.nuevos} nuevos · ${guardado.cambiados} distintos de la última vez`);

  const { error: eB } = await sb.rpc("registrar_consulta_sunat", {
    p_empresa_ruc: cred.ruc, p_periodo: periodo,
    p_ticket: ticket, p_archivo: reporte.nombre,
    p_comprobantes_sunat: filas.length, p_comprobantes_nuestros: 0,
    p_cuadran: 0, p_monto_distinto: 0, p_no_estan_en_sunat: 0,
    p_no_comparables: 0, p_solo_en_sunat: 0, p_monto_solo_en_sunat: 0,
    p_columnas_faltantes: lectura.faltantes,
    p_identidad_sospechosa: identidad.ok ? null : identidad.motivo,
    p_segundos: Math.round((Date.now() - arranque) / 1000),
  });
  if (eB) console.error(`  ⚠ No se pudo anotar en la bitácora: ${eB.message}`);

  return guardado.cambiados > 0;
}

/**
 * Deja la hoja de Contabilidad al día.
 *
 * Sin esto la hoja se congela hasta que alguien entre a la aplicación y le dé
 * al botón, que es justo lo que se quería evitar al automatizar la consulta:
 * quien la mira vería datos viejos sin ninguna señal de que lo son.
 *
 * Es opcional: si faltan las credenciales de Drive, la consulta igual sirvió
 * y los datos quedaron guardados. Se avisa y se sigue.
 */
async function publicarLaHoja(): Promise<void> {
  if (!process.env.GOOGLE_SA_EMAIL || !process.env.GOOGLE_DRIVE_FOLDER_ID) {
    console.log("\nSin credenciales de Drive: no se actualiza la hoja de Contabilidad.");
    return;
  }

  const { data, error } = await sb.rpc("historico_comprobantes_sunat");
  if (error || !Array.isArray(data)) {
    console.error("⚠ No se pudo leer el histórico para la hoja:", error?.message);
    return;
  }

  // Quién rindió cada comprobante: es la columna que SUNAT no puede dar, y la
  // que hace que esta hoja valga más que bajar el archivo del portal.
  const gastos: Array<Record<string, unknown>> = [];
  for (let desde = 0; ; desde += 1000) {
    const { data: pagina } = await sb
      .from("gastos")
      .select("proveedor_ruc, tipo_comprobante, serie, numero, usuarios:usuario_id ( nombre )")
      .eq("clase", "COMPROBANTE")
      .not("numero", "is", null)
      .range(desde, desde + 999);
    if (!pagina?.length) break;
    gastos.push(...pagina);
    if (pagina.length < 1000) break;
  }

  const sinCeros = (v: string | null) => (v ?? "").replace(/^0+/, "") || "";
  const llave = (r: string | null, t: string | null, se: string | null, n: string | null) =>
    [r ?? "", t ?? "", (se ?? "").toUpperCase(), sinCeros(n)].join("|");

  const quien = new Map<string, string>();
  for (const g of gastos) {
    const u = g.usuarios as { nombre?: string } | null;
    if (u?.nombre) {
      quien.set(llave(
        g.proveedor_ruc as string | null, g.tipo_comprobante as string | null,
        g.serie as string | null, g.numero as string | null,
      ), u.nombre);
    }
  }

  const historico = (data as ComprobanteHistorico[]).map(c => ({
    ...c,
    total: c.total == null ? null : Number(c.total),
    rendidoPor: quien.get(llave(c.proveedorRuc, c.tipoComprobante, c.serie, c.numero)) ?? null,
  }));

  const r = await publicarHoja({
    csv: aCsv(filasComprobantesSunat(historico)),
    nombre: "COMPROBANTES SUNAT",
    carpetas: ["SUNAT"],
  });
  console.log(`\nHoja al día: ${historico.length} comprobantes · ${r.url}`);
}

const hoy = new Date();
const periodos = [periodoDe(hoy), periodoCerradoAnterior(hoy)]
  .filter(p => validarPeriodo(p, hoy).ok);

let hubo = false;
const fallaron: string[] = [];

for (const p of periodos) {
  try {
    if (await consultar(p)) hubo = true;
  } catch (e) {
    // Un período que falla no debe impedir el otro: SUNAT limita cuántas
    // exportaciones se encolan seguidas, y perder los dos por eso sería
    // perder el día entero.
    const motivo = e instanceof Error ? e.message : String(e);
    console.error(`  ✗ ${p}: ${motivo}`);
    fallaron.push(`${p}: ${motivo}`);
  }
}

console.log(`\n${hubo ? "⚠ Hubo comprobantes que cambiaron." : "Sin cambios."}`);

// La hoja se actualiza aunque algún período haya fallado: lo que sí entró
// merece quedar visible.
try {
  await publicarLaHoja();
} catch (e) {
  console.error("⚠ No se pudo actualizar la hoja:", e instanceof Error ? e.message : String(e));
}

if (fallaron.length === periodos.length) {
  console.error("\n✗ Fallaron todos los períodos.");
  process.exit(1);
}
if (fallaron.length) {
  console.error(`\n⚠ Falló ${fallaron.length} de ${periodos.length}:\n  ${fallaron.join("\n  ")}`);
}
