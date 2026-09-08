import { notFound, redirect } from "next/navigation";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";
import { leerParametros } from "@/lib/dominio/parametros";
import VistaRevision from "@/components/v2/VistaRevision";
import { cargarExpediente } from "@/lib/expediente";

export default async function ContabilidadMemo({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const solicitante = await solicitanteActual();
  if (!solicitante) redirect("/ingresar");
  if (!autoriza(solicitante, "marcar_contabilizado").ok) redirect("/");

  const sb = await clienteServidor();
  const exp = await cargarExpediente(sb, id);
  if (!exp) notFound();

  return (
    <VistaRevision
      memo={exp.memo}
      gastos={exp.gastos}
      parametros={leerParametros(exp.parametros)}
      modo="contabilidad"
    />
  );
}
