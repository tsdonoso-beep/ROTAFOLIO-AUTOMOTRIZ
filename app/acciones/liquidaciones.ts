"use server";
import { revalidatePath } from "next/cache";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";

type Resultado = { ok: true; id?: string } | { ok: false; error: string };

/**
 * Emite la liquidación de una persona: netea sus rendiciones cerradas y las
 * congela en un documento.
 *
 * Los montos NO se mandan desde el navegador. La función de la base los
 * recalcula a partir de los memos, porque esto es un documento de pago y no
 * un resumen: si el número viaja por el cliente, el número es del cliente.
 */
export async function emitirLiquidacion(
  usuarioId: string, memoIds: string[]
): Promise<Resultado> {
  const solicitante = await solicitanteActual();
  if (!solicitante) return { ok: false, error: "Sesión no válida." };

  const permiso = autoriza(solicitante, "exportar");
  if (!permiso.ok) return { ok: false, error: permiso.motivo };

  if (!memoIds.length) {
    return { ok: false, error: "No hay rendiciones cerradas que liquidar." };
  }

  const sb = await clienteServidor();
  const { data: id, error } = await sb.rpc("emitir_liquidacion", {
    p_usuario: usuarioId, p_memos: memoIds,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/liquidaciones");
  revalidatePath(`/liquidaciones/${usuarioId}`);
  return { ok: true, id: id as string };
}

/**
 * Registra que la plata se movió. Es lo que cierra los memos.
 *
 * Solo Contabilidad: es el único punto de la app donde se afirma un hecho
 * del mundo real —se pagó, se cobró— y no una decisión sobre un documento.
 */
export async function registrarPago(
  liquidacionId: string, referencia: string, observacion: string
): Promise<Resultado> {
  const solicitante = await solicitanteActual();
  if (!solicitante) return { ok: false, error: "Sesión no válida." };

  if (!referencia.trim()) {
    return {
      ok: false,
      error: "Falta la referencia del movimiento. Sin eso no hay cómo "
        + "encontrarlo después, que es para lo que sirve registrarlo.",
    };
  }

  const sb = await clienteServidor();
  const { error } = await sb.rpc("registrar_pago_liquidacion", {
    p_liquidacion: liquidacionId,
    p_referencia: referencia.trim(),
    p_observacion: observacion.trim() || null,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/liquidaciones");
  revalidatePath("/contabilidad");
  revalidatePath("/memos");
  return { ok: true };
}
