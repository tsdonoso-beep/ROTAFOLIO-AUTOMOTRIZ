import type { clienteServidor } from "./supabase/servidor.ts";
import type { EstadoMemo, Gasto } from "./dominio/tipos.ts";

export interface Expediente {
  memo: {
    id: string;
    correlativo: string;
    estado: EstadoMemo;
    destino: string | null;
    monto_autorizado: number;
    fecha_salida: string | null;
    fecha_retorno_prev: string | null;
    centro: { codigo: string; nombre: string } | null;
    empresa: string;
    asignados: string[];
    aprobadoPor: string | null;
  };
  gastos: Gasto[];
  parametros: Array<{ clave: string; valor: unknown }> | null;
}

/**
 * Carga el memo con todo lo necesario para revisarlo o exportarlo.
 *
 * Devuelve null si el memo no existe o si las políticas de fila impiden
 * verlo: desde fuera no se distingue una cosa de la otra, que es lo
 * correcto — decirlo revelaría que el memo existe.
 */
export async function cargarExpediente(
  sb: Awaited<ReturnType<typeof clienteServidor>>,
  id: string
): Promise<Expediente | null> {
  const { data: memo } = await sb
    .from("memos")
    .select(`
      id, correlativo, estado, destino, monto_autorizado,
      fecha_salida, fecha_retorno_prev,
      centros_costo ( codigo, nombre ),
      empresas ( razon_social, abreviatura ),
      memo_asignados ( usuarios ( nombre ) ),
      aprobador:usuarios!memos_aprobado_por_fkey ( nombre )
    `)
    .eq("id", id)
    .single();

  if (!memo) return null;

  const [{ data: gastos }, { data: parametros }] = await Promise.all([
    sb.from("gastos").select("*").eq("memo_id", id).order("fecha_emision", { ascending: true }),
    sb.from("parametros").select("clave, valor"),
  ]);

  const empresa = memo.empresas as unknown as { razon_social: string; abreviatura: string } | null;
  const aprobador = memo.aprobador as unknown as { nombre: string } | null;

  return {
    memo: {
      id: memo.id,
      correlativo: memo.correlativo,
      estado: memo.estado as EstadoMemo,
      destino: memo.destino,
      monto_autorizado: Number(memo.monto_autorizado),
      fecha_salida: memo.fecha_salida,
      fecha_retorno_prev: memo.fecha_retorno_prev,
      centro: memo.centros_costo as unknown as { codigo: string; nombre: string } | null,
      empresa: empresa?.abreviatura ?? "",
      // Supabase tipa la relación anidada como arreglo aunque devuelva un
      // objeto, según cómo infiera la cardinalidad. Se acepta cualquiera.
      asignados: (memo.memo_asignados ?? [])
        .flatMap((a: { usuarios: unknown }) => {
          const u = a.usuarios;
          if (!u) return [];
          return (Array.isArray(u) ? u : [u]) as Array<{ nombre?: string }>;
        })
        .map(u => u.nombre)
        .filter((n): n is string => !!n),
      aprobadoPor: aprobador?.nombre ?? null,
    },
    gastos: (gastos ?? []) as unknown as Gasto[],
    parametros,
  };
}
