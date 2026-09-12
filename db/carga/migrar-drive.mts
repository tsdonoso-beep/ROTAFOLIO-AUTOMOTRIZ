// Lleva a la estructura nueva lo que se archivó con la vieja.
//
// Hasta la migración 014 las fotos se guardaban en dos niveles —centro de
// costo y memo—. Ahora son cuatro: empresa, período, centro de costo y
// memo. El mecanismo que mueve archivos ya existe, pero solo actúa cuando a
// un comprobante suelto se le asigna un memo: lo archivado antes no lo
// mueve nadie nunca.
//
// Sin esta pasada, un mismo memo termina partido: la carátula en la ruta
// nueva y la foto que la sustenta en la vieja.
//
// Mover en Drive NO cambia el identificador del archivo, así que el
// drive_url que la aplicación tiene guardado sigue sirviendo. No hay que
// tocar la base de datos.
//
//   SUPABASE_URL=… SUPABASE_ANON_KEY=… CLAVE_INICIAL=… \
//   GOOGLE_SA_EMAIL=… GOOGLE_SA_PRIVATE_KEY=… GOOGLE_DRIVE_FOLDER_ID=… \
//   node --experimental-strip-types db/carga/migrar-drive.mts [--escribir]

import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import { rutaDrive } from "../../lib/dominio/memo.ts";
import { aCsv, filasCsv } from "../../lib/export/csv.ts";
import { asegurarRuta, conectarDrive, subir } from "../../lib/drive/servidor.ts";
import type { Gasto } from "../../lib/dominio/tipos.ts";

const SECO = !process.argv.includes("--escribir");
const { SUPABASE_URL: URL, SUPABASE_ANON_KEY: ANON, CLAVE_INICIAL: CLAVE, DNI_ADMIN } = process.env;
if (!URL || !ANON || !CLAVE) {
  console.error("Faltan SUPABASE_URL, SUPABASE_ANON_KEY o CLAVE_INICIAL.");
  process.exit(1);
}

const sb = createClient(URL, ANON);
const { error: eLogin } = await sb.auth.signInWithPassword({
  email: `${DNI_ADMIN ?? "75328441"}@sin-correo.local`, password: CLAVE,
});
if (eLogin) { console.error("No se pudo entrar:", eLogin.message); process.exit(1); }

const { drive, raiz } = conectarDrive();
const DRIVES = { supportsAllDrives: true, includeItemsFromAllDrives: true };

const { data: memos } = await sb.from("memos").select(`
  id, correlativo, destino, fecha_salida,
  empresas ( abreviatura ),
  centros_costo ( codigo, nombre, drive_folder ),
  memo_asignados ( usuarios ( nombre ) ),
  aprobador:usuarios!memos_aprobado_por_fkey ( nombre ),
  gastos ( * )
`);

type M = {
  id: string; correlativo: string; destino: string | null; fecha_salida: string | null;
  empresas: { abreviatura: string } | null;
  centros_costo: { codigo: string; nombre: string; drive_folder: string | null } | null;
  memo_asignados: Array<{ usuarios: { nombre: string } | null }>;
  aprobador: { nombre: string } | null;
  gastos: Gasto[];
};

console.log(SECO ? "╔══ CORRIDA EN SECO ══╗\n" : "╔══ ESCRIBIENDO ══╗\n");
let movidos = 0, yaEstaban = 0, resumenes = 0, sinFoto = 0;

for (const m of ((memos ?? []) as unknown as M[])) {
  const gastos = m.gastos ?? [];
  if (!gastos.length) continue;

  const carpetas = rutaDrive({
    empresaAbrev: m.empresas?.abreviatura ?? "SIN-EMPRESA",
    fechaSalida: m.fecha_salida,
    centroCostoFolder: m.centros_costo?.drive_folder ?? m.centros_costo?.codigo ?? "SIN-CENTRO",
    correlativo: m.correlativo,
  });

  console.log(`${m.correlativo}  (${gastos.length} comprobante${gastos.length === 1 ? "" : "s"})`);
  console.log(`   destino: ${carpetas.join(" / ")}`);

  const destino = SECO ? null : await asegurarRuta(drive, carpetas, raiz);

  for (const g of gastos) {
    if (!g.storage_key) { sinFoto++; continue; }
    try {
      const act = await drive.files.get({ fileId: g.storage_key, fields: "name,parents", ...DRIVES });
      const padres = act.data.parents ?? [];

      if (destino && padres.includes(destino)) { yaEstaban++; console.log(`   = ${act.data.name} ya estaba`); continue; }
      if (SECO) { console.log(`   → movería ${act.data.name}`); movidos++; continue; }

      await drive.files.update({
        fileId: g.storage_key, addParents: destino!, removeParents: padres.join(","),
        fields: "id", ...DRIVES,
      });
      console.log(`   ✓ movido ${act.data.name}`);
      movidos++;
    } catch (e) {
      console.log(`   ✗ ${g.storage_key}: ${(e as Error).message.slice(0, 90)}`);
    }
  }

  // La carátula, para los memos que quedaron sin ella.
  if (SECO) { console.log("   → generaría su RESUMEN"); resumenes++; continue; }
  const filas = filasCsv({
    correlativo: m.correlativo,
    empresa: m.empresas?.abreviatura ?? "",
    centroCodigo: m.centros_costo?.codigo ?? "",
    centroNombre: m.centros_costo?.nombre ?? "",
    destino: m.destino ?? "",
    rendidor: (m.memo_asignados ?? []).map(a => a.usuarios?.nombre).filter(Boolean).join(", "),
    aprobadoPor: m.aprobador?.nombre ?? "",
  }, gastos);
  await subir({
    contenido: Buffer.from("﻿" + aCsv(filas), "utf8"), mimeType: "text/csv",
    nombre: `RESUMEN ${m.correlativo}.csv`, carpetas, reemplazar: true,
  });
  console.log("   ✓ RESUMEN generado");
  resumenes++;
}

console.log(`\n${SECO ? "se moverían" : "movidos"}: ${movidos} · ya en su sitio: ${yaEstaban}`
  + ` · ${SECO ? "resúmenes a generar" : "resúmenes"}: ${resumenes} · comprobantes sin foto: ${sinFoto}`);
if (SECO) console.log("\n(nada se tocó — agrega --escribir)");
