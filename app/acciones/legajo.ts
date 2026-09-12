"use server";
import { clienteServidor } from "@/lib/supabase/servidor";
import { subir, explicarFallo } from "@/lib/drive/servidor";
import { aCsv, filasCsv } from "@/lib/export/csv";
import { rutaDrive } from "@/lib/dominio/memo";
import type { Gasto } from "@/lib/dominio/tipos";

/**
 * Deja en la carpeta del memo una hoja con todo lo que contiene.
 *
 * Es el sobre manila, digital: quien abre la carpeta encuentra las fotos y,
 * al lado, la carátula con una fila por comprobante —proveedor, RUC, tipo,
 * serie, número, fecha, subtotal, IGV, total, estado, alertas y el enlace a
 * la propia foto—. Sin esto, la carpeta es un montón de imágenes que no se
 * explican solas.
 *
 * Se regenera entera cada vez, reemplazando la anterior. Reconstruirla es
 * barato y garantiza que nunca quede describiendo un expediente que ya
 * cambió, que es peor que no tenerla.
 *
 * Nunca lanza: esto acompaña al expediente, no lo gobierna. Si Drive falla,
 * el memo y sus gastos siguen íntegros en la base.
 */
export async function actualizarLegajo(
  memoId: string
): Promise<{ ok: true; url: string } | { ok: false; motivo: string }> {
  try {
    const sb = await clienteServidor();

    const { data: memo } = await sb
      .from("memos")
      .select(`
        id, correlativo, destino, fecha_salida, monto_autorizado,
        empresas ( abreviatura ),
        centros_costo ( codigo, nombre, drive_folder ),
        memo_asignados ( usuarios ( nombre ) ),
        aprobador:usuarios!memos_aprobado_por_fkey ( nombre ),
        gastos ( * )
      `)
      .eq("id", memoId)
      .single();

    if (!memo) return { ok: false, motivo: "El memo no existe." };

    const m = memo as unknown as {
      correlativo: string; destino: string | null; fecha_salida: string | null;
      empresas: { abreviatura: string } | null;
      centros_costo: { codigo: string; nombre: string; drive_folder: string | null } | null;
      memo_asignados: Array<{ usuarios: { nombre: string } | null }>;
      aprobador: { nombre: string } | null;
      gastos: Gasto[];
    };

    const gastos = m.gastos ?? [];
    if (!gastos.length) return { ok: false, motivo: "El memo todavía no tiene comprobantes." };

    const filas = filasCsv({
      correlativo: m.correlativo,
      empresa: m.empresas?.abreviatura ?? "",
      centroCodigo: m.centros_costo?.codigo ?? "",
      centroNombre: m.centros_costo?.nombre ?? "",
      destino: m.destino ?? "",
      rendidor: (m.memo_asignados ?? [])
        .map(a => a.usuarios?.nombre).filter(Boolean).join(", "),
      aprobadoPor: m.aprobador?.nombre ?? "",
    }, gastos);

    const { url } = await subir({
      // La marca de orden de bytes es lo que hace que Excel en español lo
      // abra en columnas en vez de en una sola tira de texto.
      contenido: Buffer.from("﻿" + aCsv(filas), "utf8"),
      mimeType: "text/csv",
      nombre: `RESUMEN ${m.correlativo}.csv`,
      carpetas: rutaDrive({
        empresaAbrev: m.empresas?.abreviatura ?? "SIN-EMPRESA",
        fechaSalida: m.fecha_salida,
        centroCostoFolder: m.centros_costo?.drive_folder
          ?? m.centros_costo?.codigo ?? "SIN-CENTRO",
        correlativo: m.correlativo,
      }),
      reemplazar: true,
    });

    return { ok: true, url };
  } catch (e) {
    return { ok: false, motivo: explicarFallo(e) };
  }
}
