"use server";
import { revalidatePath } from "next/cache";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";
import { impedimentosParaPresentar, transicionMemoValida } from "@/lib/dominio/estados";
import type { AccionEvento, EstadoMemo } from "@/lib/dominio/tipos";

type Resultado = { ok: true; id?: string } | { ok: false; error: string };

/**
 * Toda transición deja rastro. La marca de tiempo la pone la base, no el
 * navegador, y la tabla no admite update ni delete (SPEC §10.3).
 */
async function registrarEvento(
  sb: Awaited<ReturnType<typeof clienteServidor>>,
  entidad: "MEMO" | "GASTO",
  entidadId: string,
  accion: AccionEvento,
  usuarioId: string,
  antes?: unknown,
  despues?: unknown
) {
  await sb.from("eventos").insert({
    entidad, entidad_id: entidadId, accion, usuario_id: usuarioId,
    datos_antes: antes ?? null, datos_despues: despues ?? null,
  });
}

// ════════════════════════════════════════════════════════════════
// Crear memo (ADMIN_MEMOS)
// ════════════════════════════════════════════════════════════════

export async function crearMemo(datos: {
  tipo: string;
  centro_costo_id: string;
  asignados: string[];
  destino: string;
  fecha_salida: string;
  fecha_retorno_prev: string;
  monto_autorizado: number;
  abrir: boolean;
}): Promise<Resultado> {
  const solicitante = await solicitanteActual();
  if (!solicitante) return { ok: false, error: "Sesión no válida." };

  const permiso = autoriza(solicitante, "crear_memo");
  if (!permiso.ok) return { ok: false, error: permiso.motivo };

  if (!datos.asignados.length) {
    return { ok: false, error: "Asigna al menos una persona al memo." };
  }
  if (!(datos.monto_autorizado > 0)) {
    return { ok: false, error: "El monto autorizado debe ser mayor que cero." };
  }

  const sb = await clienteServidor();

  const { data: cc } = await sb
    .from("centros_costo")
    .select("id, empresa_id, empresas ( abreviatura )")
    .eq("id", datos.centro_costo_id)
    .single();

  if (!cc) return { ok: false, error: "El centro de costo no existe." };

  const abrev = (cc.empresas as unknown as { abreviatura: string } | null)?.abreviatura ?? "EMP";
  const anio = new Date().getFullYear();

  // El correlativo sale de una secuencia en la base. Contar filas daría
  // números repetidos si dos personas crean un memo a la vez.
  const { data: sec, error: errSec } = await sb.rpc("siguiente_correlativo", {
    p_empresa: cc.empresa_id, p_anio: anio, p_tipo: datos.tipo,
  });
  if (errSec) return { ok: false, error: `No se pudo generar el correlativo: ${errSec.message}` };

  const abreviaturaTipo: Record<string, string> = {
    VIATICOS: "VIA", PASAJES: "PAS", CAJA_CHICA: "CCH", OTRO: "OTR",
  };
  const correlativo = `${abrev}-${anio}-${abreviaturaTipo[datos.tipo] ?? "OTR"}-${String(sec).padStart(5, "0")}`;

  const { data: memo, error } = await sb
    .from("memos")
    .insert({
      correlativo,
      tipo: datos.tipo,
      empresa_id: cc.empresa_id,
      centro_costo_id: datos.centro_costo_id,
      destino: datos.destino || null,
      fecha_salida: datos.fecha_salida || null,
      fecha_retorno_prev: datos.fecha_retorno_prev || null,
      monto_autorizado: datos.monto_autorizado,
      estado: datos.abrir ? "ABIERTO" : "BORRADOR",
      creado_por: solicitante.usuarioId,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  const { error: errAsig } = await sb.from("memo_asignados").insert(
    datos.asignados.map(u => ({ memo_id: memo.id, usuario_id: u }))
  );
  if (errAsig) return { ok: false, error: errAsig.message };

  await registrarEvento(sb, "MEMO", memo.id, "CREAR", solicitante.usuarioId, null, {
    correlativo, monto_autorizado: datos.monto_autorizado, asignados: datos.asignados,
  });

  revalidatePath("/administrar");
  revalidatePath("/memos");
  return { ok: true, id: memo.id };
}

// ════════════════════════════════════════════════════════════════
// Presentar rendición (RENDIDOR)
// ════════════════════════════════════════════════════════════════

export async function presentarRendicion(memoId: string): Promise<Resultado> {
  const solicitante = await solicitanteActual();
  if (!solicitante) return { ok: false, error: "Sesión no válida." };

  const sb = await clienteServidor();

  const { data: memo } = await sb
    .from("memos")
    .select("id, estado, memo_asignados ( usuario_id ), gastos ( estado, alertas, alertas_confirmadas )")
    .eq("id", memoId)
    .single();

  if (!memo) return { ok: false, error: "El memo no existe o no tienes acceso." };

  const esAsignado = (memo.memo_asignados ?? [])
    .some((a: { usuario_id: string }) => a.usuario_id === solicitante.usuarioId);

  const permiso = autoriza(solicitante, "presentar_rendicion", {
    propietarioId: esAsignado ? solicitante.usuarioId : "otro",
  });
  if (!permiso.ok) return { ok: false, error: permiso.motivo };

  const transicion = transicionMemoValida(memo.estado as EstadoMemo, "PRESENTADA", solicitante.roles);
  if (!transicion.ok) return { ok: false, error: transicion.motivo };

  // Se comprueban todos los impedimentos juntos para no ir de uno en uno.
  const impedimentos = impedimentosParaPresentar(memo.gastos ?? []);
  if (impedimentos.length) {
    return {
      ok: false,
      error: impedimentos.map(i => `${i.motivo}${i.cantidad ? ` (${i.cantidad})` : ""}`).join(" "),
    };
  }

  const { error } = await sb
    .from("memos")
    .update({ estado: "PRESENTADA", presentado_en: new Date().toISOString(), observacion_actual: null })
    .eq("id", memoId);
  if (error) return { ok: false, error: error.message };

  await sb.from("gastos").update({ estado: "PRESENTADO" })
    .eq("memo_id", memoId).in("estado", ["VALIDADO", "CON_ALERTA", "EXTRAIDO"]);

  await registrarEvento(sb, "MEMO", memoId, "PRESENTAR", solicitante.usuarioId,
    { estado: memo.estado }, { estado: "PRESENTADA" });

  revalidatePath("/memos");
  revalidatePath("/revisar");
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════
// Aprobar y observar (REVISOR_COSTOS / CONTABILIDAD)
// ════════════════════════════════════════════════════════════════

export async function aprobarRendicion(memoId: string): Promise<Resultado> {
  const solicitante = await solicitanteActual();
  if (!solicitante) return { ok: false, error: "Sesión no válida." };

  const permiso = autoriza(solicitante, "aprobar_rendicion");
  if (!permiso.ok) return { ok: false, error: permiso.motivo };

  const sb = await clienteServidor();
  const { data: memo } = await sb.from("memos").select("estado").eq("id", memoId).single();
  if (!memo) return { ok: false, error: "El memo no existe." };

  const transicion = transicionMemoValida(memo.estado as EstadoMemo, "APROBADA", solicitante.roles);
  if (!transicion.ok) return { ok: false, error: transicion.motivo };

  const { error } = await sb.from("memos").update({
    estado: "APROBADA",
    aprobado_por: solicitante.usuarioId,
    aprobado_en: new Date().toISOString(),
    observacion_actual: null,
  }).eq("id", memoId);
  if (error) return { ok: false, error: error.message };

  await sb.from("gastos").update({ estado: "APROBADO" })
    .eq("memo_id", memoId).eq("estado", "PRESENTADO");

  await registrarEvento(sb, "MEMO", memoId, "APROBAR", solicitante.usuarioId,
    { estado: memo.estado }, { estado: "APROBADA" });

  revalidatePath("/revisar");
  revalidatePath("/contabilidad");
  return { ok: true };
}

/**
 * Observa gastos concretos, no la rendición entera.
 *
 * Es deliberado (SPEC §4.1): solo los gastos marcados vuelven a ser
 * editables. Devolver todo obligaría a rehacer la rendición completa por
 * una observación menor, que es el reproceso que hoy sufren.
 */
export async function observarGastos(
  memoId: string,
  observaciones: Array<{ gastoId: string; motivo: string }>
): Promise<Resultado> {
  const solicitante = await solicitanteActual();
  if (!solicitante) return { ok: false, error: "Sesión no válida." };

  const permiso = autoriza(solicitante, "observar_devolver");
  if (!permiso.ok) return { ok: false, error: permiso.motivo };

  const conMotivo = observaciones.filter(o => o.motivo.trim());
  if (!conMotivo.length) {
    return { ok: false, error: "Cada observación necesita un motivo escrito." };
  }

  const sb = await clienteServidor();
  const { data: memo } = await sb.from("memos").select("estado").eq("id", memoId).single();
  if (!memo) return { ok: false, error: "El memo no existe." };

  const transicion = transicionMemoValida(memo.estado as EstadoMemo, "OBSERVADA", solicitante.roles);
  if (!transicion.ok) return { ok: false, error: transicion.motivo };

  for (const o of conMotivo) {
    await sb.from("gastos")
      .update({ estado: "OBSERVADO", observacion: o.motivo.trim() })
      .eq("id", o.gastoId).eq("memo_id", memoId);

    await registrarEvento(sb, "GASTO", o.gastoId, "OBSERVAR", solicitante.usuarioId,
      null, { motivo: o.motivo.trim() });
  }

  const resumen = `${conMotivo.length} gasto(s) observado(s).`;
  const { error } = await sb.from("memos")
    .update({ estado: "OBSERVADA", observacion_actual: resumen })
    .eq("id", memoId);
  if (error) return { ok: false, error: error.message };

  await registrarEvento(sb, "MEMO", memoId, "OBSERVAR", solicitante.usuarioId,
    { estado: memo.estado }, { estado: "OBSERVADA", resumen });

  revalidatePath("/revisar");
  revalidatePath("/memos");
  return { ok: true };
}

export async function marcarContabilizado(memoId: string, asiento: string): Promise<Resultado> {
  const solicitante = await solicitanteActual();
  if (!solicitante) return { ok: false, error: "Sesión no válida." };

  const permiso = autoriza(solicitante, "marcar_contabilizado");
  if (!permiso.ok) return { ok: false, error: permiso.motivo };

  const sb = await clienteServidor();
  const { data: memo } = await sb.from("memos").select("estado").eq("id", memoId).single();
  if (!memo) return { ok: false, error: "El memo no existe." };

  const transicion = transicionMemoValida(memo.estado as EstadoMemo, "CONTABILIZADA", solicitante.roles);
  if (!transicion.ok) return { ok: false, error: transicion.motivo };

  const { error } = await sb.from("memos")
    .update({ estado: "CONTABILIZADA", contabilizado_en: new Date().toISOString() })
    .eq("id", memoId);
  if (error) return { ok: false, error: error.message };

  await sb.from("gastos").update({ estado: "CONTABILIZADO" })
    .eq("memo_id", memoId).eq("estado", "APROBADO");

  await registrarEvento(sb, "MEMO", memoId, "CONTABILIZAR", solicitante.usuarioId,
    { estado: memo.estado }, { estado: "CONTABILIZADA", asiento: asiento || null });

  revalidatePath("/contabilidad");
  return { ok: true };
}
