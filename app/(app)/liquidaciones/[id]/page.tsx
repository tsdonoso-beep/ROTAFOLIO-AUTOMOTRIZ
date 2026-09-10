import { notFound, redirect } from "next/navigation";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";
import { liquidar, memosLiquidables, type LiquidacionEmitida, type MemoLiquidable } from "@/lib/dominio/liquidacion";
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

  const { data: crudas } = await sb
    .from("liquidaciones")
    .select("id, neto, estado, referencia, emitida_en, pagada_en, liquidacion_memos ( memo_id )")
    .eq("usuario_id", id)
    .order("emitida_en", { ascending: false });

  const emitidas: LiquidacionEmitida[] = ((crudas ?? []) as unknown as Array<{
    id: string; neto: number; estado: string; referencia: string | null;
    emitida_en: string; pagada_en: string | null;
    liquidacion_memos: Array<{ memo_id: string }>;
  }>).map(l => ({
    id: l.id,
    neto: Number(l.neto),
    estado: l.estado as LiquidacionEmitida["estado"],
    referencia: l.referencia,
    emitidaEn: l.emitida_en.slice(0, 10),
    pagadaEn: l.pagada_en?.slice(0, 10) ?? null,
    memoIds: (l.liquidacion_memos ?? []).map(m => m.memo_id),
  }));

  const liquidacion = liquidar(memos);

  return (
    <VistaLiquidacion
      persona={{ id, nombre: persona.nombre, dni: persona.dni }}
      liquidacion={liquidacion}
      emitidoPor={quien?.nombre ?? ""}
      emitidas={emitidas}
      // Qué memos puede llevar una liquidación nueva se decide en el
      // servidor: el navegador no elige qué se paga.
      disponibles={memosLiquidables(liquidacion, emitidas).disponibles}
      puedeRegistrarPago={autoriza(solicitante, "marcar_contabilizado").ok}
    />
  );
}
