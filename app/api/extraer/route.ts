import { NextRequest, NextResponse } from "next/server";
import { solicitanteActual } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";
import { ExtractorGemini } from "@/lib/extraccion/gemini";
import { PoolClaves } from "@/lib/extraccion/pool-claves";

export const maxDuration = 60;

/**
 * Extrae los datos de un comprobante.
 *
 * La clave de IA la envía el usuario desde su navegador (decisión de la fase
 * beta). Si el servidor tuviera claves configuradas en GEMINI_API_KEYS, se
 * usarían como respaldo — así se puede centralizar más adelante sin tocar la
 * interfaz.
 *
 * La clave viaja en el cuerpo de la petición, nunca en la URL: no queda en
 * los registros del servidor ni en el historial del navegador. Tampoco se
 * guarda: se usa y se descarta.
 */
export async function POST(req: NextRequest) {
  const solicitante = await solicitanteActual();
  if (!solicitante) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });
  }

  const permiso = autoriza(solicitante, "capturar_gasto");
  if (!permiso.ok) {
    return NextResponse.json({ error: permiso.motivo }, { status: 403 });
  }

  let cuerpo: { base64?: string; mimeType?: string; apiKey?: string };
  try {
    cuerpo = await req.json();
  } catch {
    return NextResponse.json({ error: "Petición mal formada." }, { status: 400 });
  }

  const { base64, mimeType, apiKey } = cuerpo;
  if (!base64 || !mimeType) {
    return NextResponse.json({ error: "Falta la imagen." }, { status: 400 });
  }

  const pool = apiKey?.trim()
    ? new PoolClaves([apiKey.trim()])
    : PoolClaves.desdeEntorno();

  if (pool.vacio) {
    return NextResponse.json(
      { error: "Falta configurar tu clave de IA. Usa el botón 🔑 de arriba." },
      { status: 400 }
    );
  }

  try {
    const { resultado, modelo } = await new ExtractorGemini(pool).extraer({ base64, mimeType });
    return NextResponse.json({ resultado, modelo });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
