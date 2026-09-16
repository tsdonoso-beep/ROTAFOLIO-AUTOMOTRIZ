import { notFound, redirect } from "next/navigation";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";
import { leerParametros } from "@/lib/dominio/parametros";
import VistaMemo from "@/components/v2/VistaMemo";
import type { Gasto } from "@/lib/dominio/tipos";

export default async function DetalleMemo({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const solicitante = await solicitanteActual();
  if (!solicitante) redirect("/ingresar");

  const sb = await clienteServidor();

  // Las políticas de fila ya impiden leer un memo ajeno: si no es suyo ni
  // tiene rol para verlo todo, esta consulta no devuelve nada.
  const { data: memo } = await sb
    .from("memos")
    .select(`
      id, correlativo, tipo, estado, destino, monto_autorizado,
      fecha_salida, fecha_retorno_prev, observacion_actual,
      padre:memos!memos_memo_referido_id_fkey ( id, correlativo ),
      centros_costo ( codigo, nombre, drive_folder ),
      empresas ( ruc, razon_social, abreviatura ),
      memo_asignados ( usuario_id, monto, fecha_desde, fecha_hasta )
    `)
    .eq("id", id)
    .single();

  if (!memo) notFound();

  const [{ data: gastos }, { data: filasParam }, { data: devoluciones }] = await Promise.all([
    sb.from("gastos").select("*").eq("memo_id", id).order("creado_en", { ascending: false }),
    sb.from("parametros").select("clave, valor"),
    sb.from("devoluciones")
      .select("id, monto, operacion, fecha, nota")
      .eq("memo_id", id).eq("usuario_id", solicitante.usuarioId)
      .order("fecha"),
  ]);

  const centro = memo.centros_costo as unknown as
    { codigo: string; nombre: string; drive_folder: string | null } | null;
  const empresa = memo.empresas as unknown as
    { ruc: string; razon_social: string; abreviatura: string } | null;

  // La fila del anexo de quien está mirando. Un memo de cuadrilla autoriza
  // S/ 9,064.00 entre once personas: mostrarle ese número a cada una, con su
  // propia rendición debajo, le dice que le sobran ocho mil soles.
  const miFila = ((memo.memo_asignados ?? []) as Array<{
    usuario_id: string; monto: number | null;
    fecha_desde: string | null; fecha_hasta: string | null;
  }>).find(a => a.usuario_id === solicitante.usuarioId) ?? null;

  const esAsignado = miFila !== null;

  const puedeCapturar = esAsignado
    && autoriza(solicitante, "capturar_gasto").ok;

  return (
    <VistaMemo
      memo={{
        id: memo.id,
        correlativo: memo.correlativo,
        tipo: memo.tipo,
        estado: memo.estado,
        padre: memo.padre as unknown as { id: string; correlativo: string } | null,
        destino: memo.destino,
        monto_autorizado: Number(memo.monto_autorizado),
        fecha_salida: memo.fecha_salida,
        fecha_retorno_prev: memo.fecha_retorno_prev,
        observacion_actual: memo.observacion_actual,
        centro: memo.centros_costo as unknown as { codigo: string; nombre: string } | null,
        cuadrilla: (memo.memo_asignados ?? []).length,
      }}
      usuarioId={solicitante.usuarioId}
      asignado={miFila && miFila.monto != null ? {
        monto: Number(miFila.monto),
        fecha_desde: miFila.fecha_desde,
        fecha_hasta: miFila.fecha_hasta,
      } : null}
      devoluciones={(devoluciones ?? []).map(d => ({
        id: d.id, monto: Number(d.monto), operacion: d.operacion,
        fecha: d.fecha, nota: d.nota,
      }))}
      memoCaptura={{
        id: memo.id,
        correlativo: memo.correlativo,
        destino: memo.destino,
        estado: memo.estado,
        fecha_salida: memo.fecha_salida,
        fecha_retorno_prev: memo.fecha_retorno_prev,
        monto_autorizado: Number(memo.monto_autorizado),
        rendido: 0,   // lo recalcula VistaMemo con los gastos ya cargados
        // La foto se archiva bajo <centro de costo>/<memo>. Si el centro no
        // declara carpeta, se usa su código: es preferible una carpeta nueva
        // con nombre reconocible a perder el archivo.
        centroCostoFolder: centro?.drive_folder || centro?.codigo || "SIN-CENTRO",
        empresaRuc: empresa?.ruc ?? null,
        empresaAbrev: empresa?.abreviatura ?? "SIN-EMPRESA",
      }}
      gastos={(gastos ?? []) as unknown as Gasto[]}
      parametros={leerParametros(filasParam)}
      puedeCapturar={puedeCapturar}
      puedeAdministrar={autoriza(solicitante, "crear_memo").ok}
    />
  );
}
