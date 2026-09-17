import { notFound, redirect } from "next/navigation";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";
import { estadoDeLaCaja, type CicloDeCaja } from "@/lib/dominio/cajachica";
import VistaCaja from "@/components/v2/VistaCaja";

export default async function DetalleCaja(
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const solicitante = await solicitanteActual();
  if (!solicitante) redirect("/ingresar");

  const sb = await clienteServidor();
  const administra = autoriza(solicitante, "crear_memo").ok;

  const [{ data: caja }, { data: centros }] = await Promise.all([
    sb.from("cajas_chicas")
      .select(`
        id, codigo, nombre, activa,
        usuarios!cajas_chicas_responsable_id_fkey ( nombre ),
        memos ( id, correlativo, ciclo, estado, monto_autorizado, creado_en,
                centro_costo_id, gastos ( total ) )
      `)
      .eq("id", id)
      .single(),
    administra
      ? sb.from("centros_costo").select("id, codigo, nombre").eq("activo", true).order("codigo")
      : Promise.resolve({ data: [] }),
  ]);

  if (!caja) notFound();

  const memos = (caja.memos ?? []) as Array<{
    id: string; correlativo: string; ciclo: string | null; estado: string;
    monto_autorizado: number; creado_en: string; centro_costo_id: string | null;
    gastos: Array<{ total: number | null }>;
  }>;

  const ciclos: CicloDeCaja[] = memos
    .map(m => ({
      id: m.id,
      correlativo: m.correlativo,
      ciclo: m.ciclo,
      estado: m.estado,
      monto: Number(m.monto_autorizado),
      rendido: (m.gastos ?? []).reduce((s, g) => s + Number(g.total ?? 0), 0),
      fecha: m.creado_en?.slice(0, 10) ?? null,
    }))
    .sort((a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? ""));

  return (
    <VistaCaja
      caja={{
        id: caja.id,
        codigo: caja.codigo,
        nombre: caja.nombre,
        activa: caja.activa,
        responsable: (caja.usuarios as unknown as { nombre: string } | null)?.nombre ?? "—",
      }}
      estado={estadoDeLaCaja(ciclos)}
      ciclos={ciclos}
      centros={centros ?? []}
      // El último centro de costo usado es casi siempre el siguiente: la caja
      // es de un proyecto, no de todos.
      centroSugerido={memos[0]?.centro_costo_id ?? null}
      puedeReponer={administra}
    />
  );
}
