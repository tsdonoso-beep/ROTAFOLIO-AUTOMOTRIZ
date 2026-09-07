import { redirect } from "next/navigation";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";
import { Encabezado } from "@/components/v2/Encabezado";
import { BandejaMemos, CAMPOS_MEMO, type FilaMemo } from "@/components/v2/BandejaMemos";

export default async function Revisar() {
  const solicitante = await solicitanteActual();
  if (!solicitante) redirect("/ingresar");

  // El rol se comprueba en el servidor, no ocultando el enlace del menú.
  if (!autoriza(solicitante, "aprobar_rendicion").ok) redirect("/");

  const sb = await clienteServidor();
  const { data } = await sb
    .from("memos")
    .select(CAMPOS_MEMO)
    .eq("estado", "PRESENTADA")
    // Lo más antiguo primero: quien lleva más esperando se atiende antes.
    .order("presentado_en", { ascending: true });

  return (
    <>
      <Encabezado
        titulo="Rendiciones por revisar"
        bajada="Ordenadas por antigüedad. Las que traen alertas son las que necesitan tu criterio."
      />
      <BandejaMemos
        memos={(data ?? []) as unknown as FilaMemo[]}
        base="/revisar"
        vacio={{
          icono: "✅",
          titulo: "No hay nada por revisar",
          texto: "Cuando alguien presente una rendición aparecerá aquí con su consolidado y sus alertas.",
        }}
      />
    </>
  );
}
