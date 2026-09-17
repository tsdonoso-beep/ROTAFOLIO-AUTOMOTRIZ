import { redirect } from "next/navigation";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";
import FormularioMemo from "@/components/v2/FormularioMemo";

export default async function NuevoMemo() {
  const solicitante = await solicitanteActual();
  if (!solicitante) redirect("/ingresar");
  if (!autoriza(solicitante, "crear_memo").ok) redirect("/");

  const sb = await clienteServidor();

  const [{ data: centros }, { data: personas }, { data: padres }, { data: recientes }] =
    await Promise.all([
    sb.from("centros_costo").select("id, codigo, nombre").eq("activo", true).order("codigo"),
    // Solo se puede asignar a quien tiene el rol de rendidor.
    sb.from("usuarios")
      .select("id, nombre, dni, email, cargo, activo, areas ( nombre ), roles_usuario!inner(rol)")
      .eq("activo", true)
      .eq("roles_usuario.rol", "RENDIDOR")
      .order("nombre"),
    // Los viáticos vivos, para colgarles un memo de pasajes. Un pasaje sin
    // padre es un gasto suelto que nadie sabe a qué viaje pertenece.
    sb.from("memos")
      .select("id, correlativo, destino")
      .eq("tipo", "VIATICOS")
      .in("estado", ["ABIERTO", "EN_RENDICION"])
      .order("correlativo", { ascending: false })
      .limit(50),

    // Las cuadrillas de los últimos memos, para poder copiarlas. Un memo de
    // once personas no se arma eligiendo once veces de una lista.
    sb.from("memos")
      .select("id, correlativo, destino, centro_costo_id, creado_en, memo_asignados ( usuario_id )")
      .order("creado_en", { ascending: false })
      .limit(40),
  ]);

  return (
    <FormularioMemo
      centros={centros ?? []}
      // Quién puede pasar por encima del bloqueo de §7.3 se decide acá, en el
      // servidor. El formulario solo muestra u oculta la casilla; la acción
      // vuelve a comprobarlo antes de escribir.
      puedeAutorizarPendientes={autoriza(solicitante, "autorizar_apertura_con_pendientes").ok}
      padres={(padres ?? []).map(m => ({
        id: m.id, correlativo: m.correlativo, destino: m.destino,
      }))}
      personas={(personas ?? []).map(p => ({
        id: p.id, nombre: p.nombre, dni: p.dni, email: p.email,
        cargo: p.cargo,
        area: (p.areas as unknown as { nombre: string } | null)?.nombre ?? null,
      }))}
      cuadrillas={((recientes ?? []) as unknown as Array<{
        id: string; correlativo: string; destino: string | null;
        centro_costo_id: string | null; creado_en: string;
        memo_asignados: Array<{ usuario_id: string }>;
      }>).map(m => ({
        memoId: m.id,
        correlativo: m.correlativo,
        destino: m.destino,
        centroCostoId: m.centro_costo_id,
        fecha: m.creado_en?.slice(0, 10) ?? null,
        personas: (m.memo_asignados ?? []).map(a => a.usuario_id),
      }))}
    />
  );
}
