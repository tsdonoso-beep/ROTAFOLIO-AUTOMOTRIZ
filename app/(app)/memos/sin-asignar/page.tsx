import Link from "next/link";
import { redirect } from "next/navigation";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import { Encabezado, Vacio } from "@/components/v2/Encabezado";
import { IconoAtras, IconoBandeja } from "@/components/v2/Iconos";
import { leerParametros } from "@/lib/dominio/parametros";
import { consolidar } from "@/lib/dominio/memo";
import { MEMO_EDITABLE } from "@/lib/dominio/estados";
import BandejaSinAsignar from "@/components/v2/BandejaSinAsignar";
import type {
  Alerta, ClaseGasto, EstadoGasto, EstadoMemo, Gasto,
} from "@/lib/dominio/tipos";

/**
 * Los comprobantes que se capturaron sin memo.
 *
 * Existen porque la fecha no alcanzó para decidir: ninguno de los memos
 * abiertos la cubría, o varios la cubrían y adivinar habría movido plata
 * de un centro de costo a otro. Aquí la persona resuelve esa duda.
 */
export default async function SinAsignar() {
  const solicitante = await solicitanteActual();
  if (!solicitante) redirect("/ingresar");

  const sb = await clienteServidor();

  const { data: asignaciones } = await sb
    .from("memo_asignados")
    .select("memo_id")
    .eq("usuario_id", solicitante.usuarioId);
  const ids = (asignaciones ?? []).map(a => a.memo_id);

  const [{ data: gastos }, { data: memos }, { data: filasParam }] = await Promise.all([
    sb.from("gastos").select("*")
      .eq("usuario_id", solicitante.usuarioId)
      .is("memo_id", null)
      .order("fecha_emision", { ascending: false }),
    ids.length
      ? sb.from("memos")
          .select(`
            id, correlativo, destino, estado, monto_autorizado,
            fecha_salida, fecha_retorno_prev,
            centros_costo ( codigo, drive_folder ),
            empresas ( ruc, abreviatura ),
            gastos ( estado, clase, total, alertas )
          `)
          .in("id", ids)
      : Promise.resolve({ data: [] as unknown[] }),
    sb.from("parametros").select("clave, valor"),
  ]);

  // Para rendir como caja chica hace falta decir a qué centro de costo va:
  // el gasto ya ocurrió y nadie lo imputó por adelantado.
  const { data: centros } = await sb
    .from("centros_costo").select("id, codigo, nombre")
    .eq("activo", true).order("codigo");

  const disponibles = ((memos ?? []) as Array<Record<string, unknown>>)
    .filter(m => MEMO_EDITABLE.includes(m.estado as EstadoMemo))
    .map(m => {
      const cc = m.centros_costo as { codigo: string; drive_folder: string | null } | null;
      const g = (m.gastos ?? []) as Array<{
        estado: EstadoGasto; clase: ClaseGasto; total: number | null; alertas: Alerta[];
      }>;
      return {
        id: m.id as string,
        correlativo: m.correlativo as string,
        destino: (m.destino ?? null) as string | null,
        estado: m.estado as EstadoMemo,
        fecha_salida: (m.fecha_salida ?? null) as string | null,
        fecha_retorno_prev: (m.fecha_retorno_prev ?? null) as string | null,
        monto_autorizado: Number(m.monto_autorizado),
        rendido: consolidar(Number(m.monto_autorizado), g).rendido,
        centroCostoFolder: cc?.drive_folder || cc?.codigo || "SIN-CENTRO",
        empresaRuc: (m.empresas as { ruc: string } | null)?.ruc ?? null,
        empresaAbrev: (m.empresas as { abreviatura: string } | null)?.abreviatura ?? "SIN-EMPRESA",
      };
    });

  return (
    <>
      <Link href="/memos" className="hover-atras" style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        fontSize: 13, color: "var(--text2)", textDecoration: "none", marginBottom: 16,
      }}>
        <IconoAtras size={15} />
        Mis memos
      </Link>

      <Encabezado
        titulo="Sin asignar"
        bajada="Comprobantes sueltos. Cada uno puede mudarse a un memo de viáticos, o varios juntos pueden rendirse como caja chica."
      />

      {!gastos?.length ? (
        <Vacio
          icono={<IconoBandeja size={26} />}
          titulo="No hay nada pendiente de ubicar"
          texto="Acá llegan los comprobantes que la fecha no alcanzó para ubicar, y los que capturas sin memo para rendirlos como caja chica."
        />
      ) : (
        <BandejaSinAsignar
          gastos={gastos as unknown as Gasto[]}
          memos={disponibles}
          parametros={leerParametros(filasParam)}
          centros={centros ?? []}
        />
      )}
    </>
  );
}
