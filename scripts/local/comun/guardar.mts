// Guardar lo confirmado en Supabase (guardar_cpe) y publicar la hoja de detalle.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { RUC } from "./config.mts";
import { dormir, type Bitacora } from "./bitacora.mts";
import { base } from "./base.mts";
import { prepararLote, identidad } from "../../../lib/sunat/cpe-importacion.ts";
import type { ComprobanteCpe } from "../../../lib/sunat/cpe-xml.ts";
import { publicarHojaPorAnio } from "../../../lib/drive/servidor.ts";
import { filasItemsSunat, filaDetalleDesdeRpc, detalleCpeCompleto, TIPOS_ITEMS } from "../../../lib/export/items-sunat.ts";

export type Confirmado = { c: ComprobanteCpe; xmlUrl: string | null; pdfUrl: string | null };

/** `guardar_cpe` (idempotente) con 3 intentos; si no entra, el lote queda en disco. */
export async function guardarLote(b: Bitacora, comprobantes: Confirmado[]): Promise<{ guardados: number; items: number }> {
  const docs = prepararLote(
    comprobantes.map(x => x.c),
    RUC,
  );
  const porId = new Map(comprobantes.map(x => [identidad(x.c), x]));
  for (const d of docs) {
    const par = porId.get(identidad(d));
    d.xmlDriveUrl = par?.xmlUrl ?? null;
    d.pdfDriveUrl = par?.pdfUrl ?? null;
  }
  for (let i = 1; i <= 3; i++) {
    const { data, error } = await (await base(i > 1)).rpc("guardar_cpe", { p_empresa_ruc: RUC, p_docs: docs });
    if (!error) {
      const r = (Array.isArray(data) ? data[0] : data) as { nuevos: number; actualizados: number; items: number };
      b.log("info", "base", `guardados ${docs.length}: ${r?.nuevos} nuevos, ${r?.actualizados} actualizados, ${r?.items} ítems`);
      return { guardados: (r?.nuevos ?? 0) + (r?.actualizados ?? 0), items: r?.items ?? 0 };
    }
    b.log("error", "base", `guardar_cpe falló (intento ${i}/3): ${error.message}`, { error });
    await dormir(3000 * i);
  }
  const archivo = join(b.dir, `lote-no-guardado-${Date.now()}.json`);
  writeFileSync(archivo, JSON.stringify(docs));
  b.log("error", "base", `el lote quedó en ${archivo}`);
  return { guardados: 0, items: 0 };
}

/** Reescribe «COMPROBANTES SUNAT - DETALLE» con todo el detalle de la base. */
export async function publicarDetalle(b: Bitacora): Promise<void> {
  if (!process.env.GOOGLE_DRIVE_FOLDER_ID) {
    b.log("info", "hoja", "sin GOOGLE_DRIVE_FOLDER_ID: no se publica");
    return;
  }
  const t0 = Date.now();
  try {
    const filas = (await detalleCpeCompleto(await base(), null)).map(filaDetalleDesdeRpc);
    const r = await publicarHojaPorAnio({
      filas: filasItemsSunat(filas),
      nombre: "COMPROBANTES SUNAT - DETALLE",
      carpetas: ["SUNAT"],
      tipos: TIPOS_ITEMS,
    });
    for (const a of r.anteriores) b.log("info", "hoja", `hoja aparte ${a.anio}: ${a.filas} ítems · ${a.url}`);
    b.log("info", "hoja", `detalle publicado: ${filas.length} ítems en ${((Date.now() - t0) / 1000).toFixed(0)}s · ${r.url}`);
  } catch (e) {
    b.log("error", "hoja", `no se pudo publicar: ${e instanceof Error ? e.message : e}`);
  }
}
