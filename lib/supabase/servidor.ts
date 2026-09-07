import { createServerClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import { cookies } from "next/headers";
import type { Rol } from "../dominio/tipos.ts";
import type { Solicitante } from "../dominio/permisos.ts";

/**
 * Cliente de servidor ligado a las cookies de la petición. Respeta las
 * políticas de fila: si el usuario no debe ver una fila, no la ve, aunque
 * la ruta se equivoque.
 */
export async function clienteServidor() {
  const almacen = await cookies();

  return createServerClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => almacen.getAll(),
        setAll: (nuevas) => {
          try {
            nuevas.forEach(({ name, value, options }) =>
              almacen.set(name, value, options)
            );
          } catch {
            // En un Server Component las cookies son de solo lectura; el
            // middleware ya se encarga de refrescar la sesión.
          }
        },
      },
    }
  );
}

/**
 * Resuelve quién hace la petición y con qué roles.
 *
 * Es la pieza que reemplaza al PIN del MVP: la identidad sale del token
 * verificado por el servidor de autenticación, no de algo que el navegador
 * pueda afirmar. `getUser()` contacta al servidor de identidad en vez de
 * confiar en la cookie, que es lo que la hace fiable.
 */
export async function solicitanteActual(): Promise<Solicitante | null> {
  const sb = await clienteServidor();

  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return null;

  const { data: fila } = await sb
    .from("usuarios")
    .select("id, area_id, activo, roles_usuario(rol)")
    .eq("auth_id", auth.user.id)
    .single();

  if (!fila || !fila.activo) return null;

  return {
    usuarioId: fila.id,
    areaId: fila.area_id,
    roles: (fila.roles_usuario ?? []).map((r: { rol: string }) => r.rol as Rol),
  };
}
