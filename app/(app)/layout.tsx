import { redirect } from "next/navigation";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import Cabecera from "@/components/v2/Cabecera";
import Pendientes from "@/components/v2/Pendientes";
import { contarPendientes } from "@/lib/datos/pendientes";

/**
 * Marco de las pantallas autenticadas. Resuelve identidad y roles en el
 * servidor: la interfaz nunca decide por su cuenta qué puede hacer alguien.
 */
export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const solicitante = await solicitanteActual();
  if (!solicitante) redirect("/ingresar");

  const sb = await clienteServidor();
  const { data } = await sb
    .from("usuarios")
    .select("nombre")
    .eq("id", solicitante.usuarioId)
    .single();

  // Va en el marco y no en la portada porque a un rendidor puro se lo
  // redirige directo a sus memos: nunca vería la portada, y es justo quien
  // necesita enterarse de que le devolvieron un comprobante.
  const conteos = await contarPendientes(solicitante);

  return (
    <div style={{ minHeight: "100dvh" }}>
      <Cabecera nombre={data?.nombre ?? "Usuario"} roles={solicitante.roles} />
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 20px 80px" }}>
        <Pendientes conteos={conteos} />
        {children}
      </main>
    </div>
  );
}
