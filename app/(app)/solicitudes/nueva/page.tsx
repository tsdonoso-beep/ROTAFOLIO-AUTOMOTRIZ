import { redirect } from "next/navigation";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";
import FormularioSolicitud from "@/components/v2/FormularioSolicitud";

export default async function NuevaSolicitud() {
  const solicitante = await solicitanteActual();
  if (!solicitante) redirect("/ingresar");
  if (!autoriza(solicitante, "solicitar_memo").ok) redirect("/");

  const sb = await clienteServidor();

  const [{ data: centros }, { data: personas }, { data: yo }] = await Promise.all([
    sb.from("centros_costo").select("id, codigo, nombre").eq("activo", true).order("codigo"),
    sb.from("usuarios")
      .select("id, nombre, dni, cargo, areas ( nombre )")
      .eq("activo", true).order("nombre"),
    sb.from("usuarios")
      .select("jefatura_id, jefe:usuarios!usuarios_jefatura_id_fkey ( nombre )")
      .eq("id", solicitante.usuarioId).single(),
  ]);

  const jefe = yo?.jefe as unknown as { nombre: string } | null;

  return (
    <FormularioSolicitud
      centros={centros ?? []}
      personas={(personas ?? []).map(p => ({
        id: p.id, nombre: p.nombre, dni: p.dni, cargo: p.cargo,
        area: (p.areas as unknown as { nombre: string } | null)?.nombre ?? null,
      }))}
      yo={solicitante.usuarioId}
      // Se dice de entrada a quién le va a llegar. Si no hay jefatura
      // registrada, se dice también: es lo que va a trabar la firma.
      jefeNombre={jefe?.nombre ?? null}
    />
  );
}
