import { redirect } from "next/navigation";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import Cabecera from "@/components/v2/Cabecera";

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

  return (
    <div style={{ minHeight: "100dvh" }}>
      <Cabecera nombre={data?.nombre ?? "Usuario"} roles={solicitante.roles} />
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 20px 80px" }}>
        {children}
      </main>
    </div>
  );
}
