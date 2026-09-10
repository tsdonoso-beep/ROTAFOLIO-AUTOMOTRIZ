import { redirect } from "next/navigation";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";
import FormularioMemo from "@/components/v2/FormularioMemo";

export default async function NuevoMemo() {
  const solicitante = await solicitanteActual();
  if (!solicitante) redirect("/ingresar");
  if (!autoriza(solicitante, "crear_memo").ok) redirect("/");

  const sb = await clienteServidor();

  const [{ data: centros }, { data: personas }] = await Promise.all([
    sb.from("centros_costo").select("id, codigo, nombre").eq("activo", true).order("codigo"),
    // Solo se puede asignar a quien tiene el rol de rendidor.
    sb.from("usuarios")
      .select("id, nombre, dni, email, activo, roles_usuario!inner(rol)")
      .eq("activo", true)
      .eq("roles_usuario.rol", "RENDIDOR")
      .order("nombre"),
  ]);

  return (
    <FormularioMemo
      centros={centros ?? []}
      // Quién puede pasar por encima del bloqueo de §7.3 se decide acá, en el
      // servidor. El formulario solo muestra u oculta la casilla; la acción
      // vuelve a comprobarlo antes de escribir.
      puedeAutorizarPendientes={autoriza(solicitante, "autorizar_apertura_con_pendientes").ok}
      personas={(personas ?? []).map(p => ({
        id: p.id, nombre: p.nombre, dni: p.dni, email: p.email,
      }))}
    />
  );
}
