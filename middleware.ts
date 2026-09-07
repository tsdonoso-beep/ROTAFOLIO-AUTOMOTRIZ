import { createServerClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refresca la sesión en cada petición y protege las rutas privadas.
 *
 * Esto es solo la primera barrera: cada ruta de API vuelve a comprobar rol
 * por su cuenta y la base tiene sus políticas de fila. Que el middleware
 * deje pasar no autoriza nada por sí mismo.
 */
export async function middleware(req: NextRequest) {
  let respuesta = NextResponse.next({ request: req });

  const sb = createServerClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (nuevas) => {
          nuevas.forEach(({ name, value }) => req.cookies.set(name, value));
          respuesta = NextResponse.next({ request: req });
          nuevas.forEach(({ name, value, options }) =>
            respuesta.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data } = await sb.auth.getUser();
  const ruta = req.nextUrl.pathname;
  const esPublica = ruta.startsWith("/ingresar") || ruta.startsWith("/auth");

  if (!data.user && !esPublica) {
    const destino = req.nextUrl.clone();
    destino.pathname = "/ingresar";
    return NextResponse.redirect(destino);
  }

  if (data.user && ruta === "/ingresar") {
    const destino = req.nextUrl.clone();
    destino.pathname = "/";
    return NextResponse.redirect(destino);
  }

  return respuesta;
}

export const config = {
  matcher: [
    // Todo salvo estáticos, imágenes y el favicon.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
