"use server";
import { revalidatePath } from "next/cache";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";

type Resultado =
  | { ok: true; id?: string }
  | { ok: false; error: string };

/**
 * Registra una constancia de pago.
 *
 * Una por banco. El memo 594-2026 tiene dos: la planilla de haberes 1439 del
 * BCP, con siete personas, y la operación contra el CCI de Interbank con las
 * otras cuatro. Registrar solo la primera y dar el memo por pagado deja a
 * cuatro personas esperando sin que nadie lo sepa.
 */
export async function registrarConstancia(datos: {
  memoId: string;
  banco: string;
  planilla?: string | null;
  fecha?: string | null;
  lineas: Array<{ usuarioId: string; monto: number; procesada: boolean; motivo?: string | null }>;
}): Promise<Resultado> {
  const solicitante = await solicitanteActual();
  if (!solicitante) return { ok: false, error: "Sesión no válida." };

  const permiso = autoriza(solicitante, "crear_memo");
  if (!permiso.ok) return { ok: false, error: permiso.motivo };

  if (!datos.banco.trim()) {
    return {
      ok: false,
      error: "Falta el banco. Es lo que parte el pago en varias planillas, "
        + "así que sin él no se sabe qué falta por cobrar.",
    };
  }

  const conMonto = datos.lineas.filter(l => l.monto > 0);
  if (conMonto.length === 0) {
    return { ok: false, error: "Marca al menos a una persona con su monto." };
  }

  const sb = await clienteServidor();

  const { data: pago, error } = await sb
    .from("pagos")
    .insert({
      memo_id: datos.memoId,
      banco: datos.banco.trim(),
      planilla: datos.planilla?.trim() || null,
      fecha: datos.fecha || null,
      registrado_por: solicitante.usuarioId,
    })
    .select("id")
    .single();

  // La misma planilla del mismo banco dos veces es la misma constancia
  // subida dos veces, y duplica lo pagado.
  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        error: `La planilla ${datos.planilla} de ${datos.banco} ya está registrada.`,
      };
    }
    return { ok: false, error: error.message };
  }

  const { error: errL } = await sb.from("pago_lineas").insert(
    conMonto.map(l => ({
      pago_id: pago.id,
      usuario_id: l.usuarioId,
      monto: l.monto,
      procesada: l.procesada,
      motivo: l.motivo?.trim() || null,
    }))
  );
  if (errL) return { ok: false, error: errL.message };

  revalidatePath(`/memos/${datos.memoId}`);
  revalidatePath(`/revisar/${datos.memoId}`);
  return { ok: true, id: pago.id };
}

export async function borrarConstancia(
  pagoId: string, memoId: string
): Promise<Resultado> {
  const solicitante = await solicitanteActual();
  if (!solicitante) return { ok: false, error: "Sesión no válida." };

  const permiso = autoriza(solicitante, "crear_memo");
  if (!permiso.ok) return { ok: false, error: permiso.motivo };

  const sb = await clienteServidor();
  const { error } = await sb.from("pagos").delete().eq("id", pagoId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/memos/${memoId}`);
  return { ok: true };
}
