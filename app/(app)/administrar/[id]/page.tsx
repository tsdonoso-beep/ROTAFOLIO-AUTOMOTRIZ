import { redirect } from "next/navigation";
import { solicitanteActual } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";

/**
 * El administrador de memos no tiene una vista propia del expediente: si
 * además revisa, va a la del revisor; si no, a la del memo.
 */
export default async function AdministrarMemo({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const solicitante = await solicitanteActual();
  if (!solicitante) redirect("/ingresar");
  if (!autoriza(solicitante, "crear_memo").ok) redirect("/");

  redirect(autoriza(solicitante, "aprobar_rendicion").ok ? `/revisar/${id}` : `/memos/${id}`);
}
