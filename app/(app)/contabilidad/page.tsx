import { redirect } from "next/navigation";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";
import { Encabezado } from "@/components/v2/Encabezado";
import { IconoContabilidad } from "@/components/v2/Iconos";
import { BandejaMemos, CAMPOS_MEMO, type FilaMemo } from "@/components/v2/BandejaMemos";

export default async function Contabilidad() {
  const solicitante = await solicitanteActual();
  if (!solicitante) redirect("/ingresar");
  if (!autoriza(solicitante, "marcar_contabilizado").ok) redirect("/");

  const sb = await clienteServidor();
  const { data } = await sb
    .from("memos")
    .select(CAMPOS_MEMO)
    .in("estado", ["APROBADA", "CONTABILIZADA"])
    .order("aprobado_en", { ascending: true });

  const memos = (data ?? []) as unknown as FilaMemo[];
  const porContabilizar = memos.filter(m => m.estado === "APROBADA");

  return (
    <>
      <Encabezado
        titulo="Contabilidad"
        bajada={
          porContabilizar.length
            ? `${porContabilizar.length} rendición${porContabilizar.length === 1 ? "" : "es"} aprobada${porContabilizar.length === 1 ? "" : "s"} lista${porContabilizar.length === 1 ? "" : "s"} para exportar y contabilizar.`
            : "Rendiciones aprobadas y su estado de contabilización."
        }
      />
      <BandejaMemos
        memos={memos}
        base="/contabilidad"
        vacio={{
          icono: <IconoContabilidad size={26} />,
          titulo: "Sin rendiciones aprobadas",
          texto: "Aquí llegan las rendiciones una vez que el revisor de costos las aprueba, con el expediente completo.",
        }}
      />
    </>
  );
}
