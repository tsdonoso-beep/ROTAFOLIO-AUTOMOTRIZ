import { notFound, redirect } from "next/navigation";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";
import { liquidar, type MemoLiquidable } from "@/lib/dominio/liquidacion";
import VistaLiquidacion from "@/components/v2/VistaLiquidacion";

interface MemoCrudo {
  id: string;
  correlativo: string;
  estado: string;
  destino: string | null;
  fecha_salida: string | null;
  monto_autorizado: number;
  gastos: MemoLiquidable["gastos"];
}

export default async function DetalleLiquidacion({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const solicitante = await solicitanteActual();
  if (!solicitante) redirect("/ingresar");
  if (!autoriza(solicitante, "exportar").ok) redirect("/");

  const sb = await clienteServidor();

  const { data: persona } = await sb
    .from("usuarios").select("id, nombre, dni").eq("id", id).single();
  if (!persona) notFound();

  const { data: asignaciones } = await sb
    .from("memo_asignados").select("memo_id").eq("usuario_id", id);
  const ids = (asignaciones ?? []).map(a => a.memo_id);

  const { data } = ids.length
    ? await sb
        .from("memos")
        .select("id, correlativo, estado, destino, fecha_salida, monto_autorizado, gastos ( estado, clase, total, alertas )")
        .in("id", ids)
        .not("estado", "in", "(BORRADOR,ANULADO)")
    : { data: [] };

  const memos: MemoLiquidable[] = ((data ?? []) as unknown as MemoCrudo[]).map(m => ({
    id: m.id,
    correlativo: m.correlativo,
    estado: m.estado as MemoLiquidable["estado"],
    destino: m.destino,
    fecha_salida: m.fecha_salida,
    monto_autorizado: Number(m.monto_autorizado),
    gastos: m.gastos ?? [],
  }));

  const { data: quien } = await sb
    .from("usuarios").select("nombre").eq("id", solicitante.usuarioId).single();

  return (
    <VistaLiquidacion
      persona={{ nombre: persona.nombre, dni: persona.dni }}
      liquidacion={liquidar(memos)}
      emitidoPor={quien?.nombre ?? ""}
    />
  );
}
