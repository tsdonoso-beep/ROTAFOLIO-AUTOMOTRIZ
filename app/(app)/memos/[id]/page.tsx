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
      id, correlativo, estado, destino, monto_autorizado,
      fecha_salida, fecha_retorno_prev, observacion_actual,
      centros_costo ( codigo, nombre, drive_folder ),
      empresas ( ruc, razon_social ),
      memo_asignados ( usuario_id )
    `)
    .eq("id", id)
    .single();

  if (!memo) notFound();

  const [{ data: gastos }, { data: filasParam }] = await Promise.all([
    sb.from("gastos").select("*").eq("memo_id", id).order("creado_en", { ascending: false }),
    sb.from("parametros").select("clave, valor"),
  ]);

  const centro = memo.centros_costo as unknown as
    { codigo: string; nombre: string; drive_folder: string | null } | null;
  const empresa = memo.empresas as unknown as
    { ruc: string; razon_social: string } | null;

  const esAsignado = (memo.memo_asignados ?? [])
    .some((a: { usuario_id: string }) => a.usuario_id === solicitante.usuarioId);

  const puedeCapturar = esAsignado
    && autoriza(solicitante, "capturar_gasto").ok;

  return (
    <VistaMemo
      memo={{
        id: memo.id,
        correlativo: memo.correlativo,
        estado: memo.estado,
        destino: memo.destino,
        monto_autorizado: Number(memo.monto_autorizado),
        fecha_salida: memo.fecha_salida,
        fecha_retorno_prev: memo.fecha_retorno_prev,
        observacion_actual: memo.observacion_actual,
        centro: memo.centros_costo as unknown as { codigo: string; nombre: string } | null,
      }}
      contexto={{
        // La foto se archiva bajo <centro de costo>/<memo>. Si el centro no
        // declara carpeta, se usa su código: es preferible una carpeta nueva
        // con nombre reconocible a perder el archivo.
        empresaAbrev: empresa?.razon_social ?? "",
        empresaRuc: empresa?.ruc ?? null,
        centroCostoFolder: centro?.drive_folder || centro?.codigo || "SIN-CENTRO",
        correlativo: memo.correlativo,
      }}
      gastos={(gastos ?? []) as unknown as Gasto[]}
      parametros={leerParametros(filasParam)}
      puedeCapturar={puedeCapturar}
    />
  );
}
