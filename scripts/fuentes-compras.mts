// Leer la hoja privada de Contabilidad (Compras, COMEX y Almacén) y subirla a la base
//
// La hoja la llena CopiarFuentes.gs dos veces al día (00:45 y 11:15), con los
// permisos de quien la instaló, desde los archivos originales: la base de
// compras nacionales, el STATUS DE CARGAS de COMEX y el kardex de Almacén.
// Está compartida como Lector SOLO con la cuenta de servicio del robot.
//
// Esto la lee entera (sin formato: fechas como número de serie, montos como
// número), la junta por OC y por vale (lib/drive/fuentes-compras.ts) y la sube
// con cargar_fuentes_compras(): la base anota lo que cambió desde la lectura
// anterior (un monto, una DAM, un vale corregido o anulado) y cruza todo con
// las carpetas madre (carpetas_madre_fuentes, detalle_de_carpeta).
//
//   FUENTES_HOJA   el ID de la hoja privada (por omisión, la de Contabilidad)
//   FUENTES_JSON   en vez de leer la hoja, un archivo con las pestañas
//                  ({ "NACIONALES": [[…], …], … }), para probar en la computadora
//   DEBUG=1        lee y resume, pero no sube nada a la base
//
// Corre en el flujo de las carpetas (carpetas-oc.yml), antes de leerlas.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { conectarDrive } from "../lib/drive/servidor.ts";
import { leerFuentes, PESTANAS, type Celda, type Fuentes } from "../lib/drive/fuentes-compras.ts";
import { cargarClaveDeArchivo } from "./local/comun/config.mts";

cargarClaveDeArchivo();

const DEBUG = process.env.DEBUG === "1";
const HOJA = process.env.FUENTES_HOJA?.trim() || "1sJhaKxamPG1lIEAaso5uprqUU_ixHLylQtAY53KUEms";
const EMPRESA_RUC = process.env.EMPRESA_RUC?.trim() || "20512201611";
const SALIDA = join(process.cwd(), "salida", "fuentes-compras");
mkdirSync(SALIDA, { recursive: true });

function leer(...nombres: string[]): string {
  for (const n of nombres) { const v = (process.env[n] ?? "").trim(); if (v) return v; }
  throw new Error(`falta ${nombres.join(" o ")} en el entorno`);
}

/** Las pestañas de la hoja privada, sin formato. Las que no están no se piden (Sheets rechaza todo el pedido). */
async function leerHoja(): Promise<Partial<Record<(typeof PESTANAS)[number], Celda[][]>>> {
  const { hojas } = conectarDrive();
  const meta = await hojas.spreadsheets.get({ spreadsheetId: HOJA, fields: "properties(title),sheets(properties(title))" });
  const hay = new Set((meta.data.sheets ?? []).map(s => s.properties?.title ?? ""));
  console.log(`· hoja «${meta.data.properties?.title}»: ${[...hay].join(", ")}`);
  const pedir = PESTANAS.filter(p => hay.has(p));
  const r = await hojas.spreadsheets.values.batchGet({
    spreadsheetId: HOJA,
    ranges: pedir.map(p => `'${p}'`),
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "SERIAL_NUMBER",
  });
  const out: Partial<Record<(typeof PESTANAS)[number], Celda[][]>> = {};
  (r.data.valueRanges ?? []).forEach((v, i) => { out[pedir[i]] = (v.values ?? []) as Celda[][]; });
  return out;
}

// Las filas como las columnas de la base.
const filasDeCompras = (f: Fuentes) => f.compras.map(c => ({
  procedencia: c.procedencia, oc: c.oc, oc_original: c.ocOriginal, empresa: c.empresa, tipo_documento: c.tipoDocumento,
  fecha: c.fecha, requerimiento: c.requerimiento, proveedor_ruc: c.proveedorRuc, proveedor: c.proveedor, pais: c.pais,
  proyecto: c.proyecto, concepto: c.concepto, moneda: c.moneda, total: c.total, total_soles: c.totalSoles,
  forma_pago: c.formaPago, condicion_pago: c.condicionPago, incoterm: c.incoterm, lugar_entrega: c.lugarEntrega,
  tiempo_entrega: c.tiempoEntrega, solicitado: c.solicitado, elaborado: c.elaborado, items: c.items,
}));
const filasDeComex = (f: Fuentes) => f.comex.map(c => ({
  oc: c.oc, oc_original: c.ocOriginal, empresa: c.empresa, comprador: c.comprador, estado_compra: c.estadoCompra,
  fecha_oc: c.fechaOc, proveedor: c.proveedor, origen: c.origen, incoterm: c.incoterm, modalidad: c.modalidad,
  operador: c.operador, awb_bl: c.awbBl, etd: c.etd, eta: c.eta, ata: c.ata, fecha_aprox_planta: c.fechaAproxPlanta,
  fecha_real_planta: c.fechaRealPlanta, documentos_enviados: c.documentosEnviados, agente_aduanas: c.agenteAduanas,
  dam: c.dam, costeo: c.costeo, observaciones: c.observaciones, embarques: c.embarques,
  duas: c.duas.map(d => ({ dua: d.dua, fecha: d.fecha, encargado: d.encargado, subio_oc: d.subioOc, fecha_subida: d.fechaSubida, observacion: d.observacion })),
}));
const filasDeVales = (f: Fuentes) => f.vales.map(v => ({
  id: v.id, vale: v.vale, fecha_registro: v.fechaRegistro, fecha_operacion: v.fechaOperacion, movimiento: v.movimiento,
  operacion: v.operacion, proveedor: v.proveedor, tipo_documento: v.tipoDocumento, numero_documento: v.numeroDocumento,
  tipo_orden: v.tipoOrden, numero_orden: v.numeroOrden, oc: v.oc ?? "", procedencia: v.procedencia ?? "", proyecto: v.proyecto,
  sede: v.sede, responsable: v.responsable, recepcionado: v.recepcionado, documento_ruta: v.documentoRuta,
  documento_url: v.documentoUrl, vale_url: v.valeUrl, items: v.items, cantidad: v.cantidad,
}));

const inicio = Date.now();
const pestanas = process.env.FUENTES_JSON?.trim()
  ? JSON.parse(readFileSync(process.env.FUENTES_JSON.trim(), "utf8"))
  : await leerHoja();
const f = leerFuentes(pestanas);

const resumen = {
  hoja: HOJA,
  compras: { nacionales: f.compras.filter(c => c.procedencia === "Nacional").length, importaciones: f.compras.filter(c => c.procedencia === "Importación").length },
  comex: f.comex.length,
  vales: f.vales.length,
  valesConOc: f.vales.filter(v => v.oc).length,
  copia: f.estado,
  avisos: f.avisos,
  carga: {} as Record<string, unknown>,
};
for (const a of f.avisos) console.log(`⚠ ${a}`);
console.log(`· Compras: ${resumen.compras.nacionales} OC nacionales y ${resumen.compras.importaciones} de importación`);
console.log(`· COMEX: ${resumen.comex} OC · Almacén: ${resumen.vales} vales (${resumen.valesConOc} con OC)`);
// Una copia vieja no se descarta (es lo último que hay), pero se avisa.
const ultima = f.estado.map(e => e.fin ?? e.inicio ?? "").filter(Boolean).sort().pop();
if (ultima) {
  const horas = (Date.now() - new Date(ultima).getTime()) / 3600000;
  console.log(`· la hoja se copió por última vez: ${ultima}${horas > 20 ? ` ⚠ hace ${Math.round(horas)} h (¿se detuvo CopiarFuentes.gs?)` : ""}`);
}
for (const e of f.estado) if (!/^OK/.test(e.resultado)) console.log(`⚠ ${e.pestana}: ${e.resultado}`);

if (DEBUG) {
  console.log("DEBUG=1: no se sube nada a la base.");
} else {
  const sb = createClient(leer("SUPABASE_URL", "PROJECT_URL"), leer("SUPABASE_ANON_KEY", "ANON_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await sb.auth.signInWithPassword({ email: leer("ROBOT_CORREO"), password: leer("ROBOT_CLAVE") });
  if (error) throw new Error(`No se pudo entrar como el robot: ${error.message}`);
  const cargas: [string, unknown[], boolean][] = [
    ["COMPRAS", filasDeCompras(f), !!pestanas["NACIONALES"]?.length || !!pestanas["IMPO - BASE"]?.length],
    ["COMEX", filasDeComex(f), !!pestanas["IMPO - STATUS"]?.length],
    ["ALMACEN", filasDeVales(f), !!pestanas["KARDEX - VALES"]?.length],
    ["COPIA", f.estado, f.estado.length > 0],
  ];
  for (const [fuente, filas, hay] of cargas) {
    // Una pestaña que no llegó no se sube: borraría lo que ya está en la base.
    if (!hay) { console.log(`· ${fuente}: sin datos en la hoja, se deja lo que ya está en la base`); continue; }
    const { data, error: e } = await sb.rpc("cargar_fuentes_compras", { p_empresa_ruc: EMPRESA_RUC, p_fuente: fuente, p_filas: filas });
    if (e) throw new Error(`${fuente}: ${e.message}`);
    resumen.carga[fuente] = data;
    const d = data as { filas: number; antes: number; cambios: number; borro: boolean };
    console.log(`· ${fuente}: ${d.filas} filas (antes ${d.antes}), ${d.cambios} cambios anotados${d.borro ? "" : " ⚠ llegaron menos de la mitad: no se borró nada"}`);
  }
}

writeFileSync(join(SALIDA, "resumen.json"), JSON.stringify(resumen, null, 2));
console.log(`listo en ${Math.round((Date.now() - inicio) / 1000)} s`);
