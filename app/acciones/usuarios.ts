"use server";
import { revalidatePath } from "next/cache";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";

type Resultado = { ok: true } | { ok: false; error: string };

/** Hasta dónde se sube buscando un ciclo antes de rendirse. */
const PROFUNDIDAD_MAXIMA = 20;

/**
 * Define de quién depende una persona.
 *
 * Es lo que habilita el tablero del líder: las políticas de fila usan esta
 * relación para decidir a quién alcanza cada jefatura. Mientras no llegue
 * el organigrama de RRHH, se asigna a mano desde Sistema.
 */
export async function asignarJefatura(
  usuarioId: string,
  jefaturaId: string | null
): Promise<Resultado> {
  const solicitante = await solicitanteActual();
  if (!solicitante) return { ok: false, error: "Sesión no válida." };

  const permiso = autoriza(solicitante, "editar_catalogos");
  if (!permiso.ok) return { ok: false, error: permiso.motivo };

  if (jefaturaId === usuarioId) {
    return { ok: false, error: "Una persona no puede ser su propia jefatura." };
  }

  const sb = await clienteServidor();

  const { data: antes } = await sb
    .from("usuarios").select("nombre, jefatura_id").eq("id", usuarioId).single();
  if (!antes) return { ok: false, error: "La persona no existe." };

  // Un ciclo dejaría a un grupo reportándose a sí mismo: nadie sería
  // responsable de esas rendiciones y el tablero mostraría un equipo que
  // se contiene a sí mismo. Se sube por la cadena antes de permitirlo.
  if (jefaturaId) {
    let actual: string | null = jefaturaId;
    for (let i = 0; i < PROFUNDIDAD_MAXIMA && actual; i++) {
      if (actual === usuarioId) {
        return {
          ok: false,
          error: "Eso crearía un círculo: esa persona ya depende, directa o indirectamente, de quien intentas asignarle.",
        };
      }
      const { data: arriba }: { data: { jefatura_id: string | null } | null } = await sb
        .from("usuarios").select("jefatura_id").eq("id", actual).single();
      actual = arriba?.jefatura_id ?? null;
    }
  }

  const { error } = await sb
    .from("usuarios").update({ jefatura_id: jefaturaId }).eq("id", usuarioId);
  if (error) return { ok: false, error: error.message };

  await sb.from("eventos").insert({
    entidad: "USUARIO", entidad_id: usuarioId, accion: "EDITAR",
    usuario_id: solicitante.usuarioId,
    datos_antes: { jefatura_id: antes.jefatura_id },
    datos_despues: { jefatura_id: jefaturaId },
  });

  revalidatePath("/sistema");
  revalidatePath("/tablero");
  return { ok: true };
}
