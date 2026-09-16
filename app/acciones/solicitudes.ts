"use server";
import { revalidatePath } from "next/cache";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";
import { revisarAnexo } from "@/lib/dominio/anexo";
import { crearMemo } from "./memos";
import {
  puedeEmitirse, puedeResponder, type EstadoSolicitud,
} from "@/lib/dominio/solicitud";

type Resultado =
  | { ok: true; id?: string }
  | { ok: false; error: string };

interface PersonaPedida {
  usuario_id: string;
  nombre?: string;
  monto: number | null;
  fecha_desde: string | null;
  fecha_hasta: string | null;
}

// ════════════════════════════════════════════════════════════════
// Pedir
// ════════════════════════════════════════════════════════════════
//
// Cualquiera puede pedir. La jefatura que tiene que firmar se toma de la que
// el solicitante tiene registrada, y se congela: si mañana le cambian de
// jefe, la firma que se pidió sigue siendo la que se pidió.

export async function crearSolicitud(datos: {
  tipo: string;
  centro_costo_id: string;
  motivo: string;
  destino?: string;
  personas: PersonaPedida[];
}): Promise<Resultado> {
  const solicitante = await solicitanteActual();
  if (!solicitante) return { ok: false, error: "Sesión no válida." };

  const permiso = autoriza(solicitante, "solicitar_memo");
  if (!permiso.ok) return { ok: false, error: permiso.motivo };

  if (!datos.motivo.trim()) {
    return {
      ok: false,
      error: "Falta el motivo. Es lo que la jefatura lee para decidir, y lo "
        + "que después explica por qué existe el memo.",
    };
  }

  // El pedido se revisa con la misma función que el anexo del memo: si lo
  // que se pide no cuadra, no tiene sentido pedirlo.
  const anexo = revisarAnexo(datos.personas.map(p => ({
    usuarioId: p.usuario_id,
    nombre: p.nombre ?? "esa persona",
    monto: p.monto,
    fechaDesde: p.fecha_desde,
    fechaHasta: p.fecha_hasta,
  })));
  if (anexo.reparos.length) return { ok: false, error: anexo.reparos.join(" ") };

  const sb = await clienteServidor();

  const { data: yo } = await sb
    .from("usuarios").select("jefatura_id").eq("id", solicitante.usuarioId).single();

  const { data: sol, error } = await sb
    .from("solicitudes_memo")
    .insert({
      tipo: datos.tipo,
      centro_costo_id: datos.centro_costo_id,
      solicitante_id: solicitante.usuarioId,
      jefatura_id: yo?.jefatura_id ?? null,
      motivo: datos.motivo.trim(),
      destino: datos.destino?.trim() || null,
      monto_estimado: anexo.total > 0 ? anexo.total : null,
      fecha_desde: anexo.desde,
      fecha_hasta: anexo.hasta,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  const { error: errP } = await sb.from("solicitud_personas").insert(
    datos.personas.map(p => ({
      solicitud_id: sol.id,
      usuario_id: p.usuario_id,
      monto: p.monto,
      fecha_desde: p.fecha_desde,
      fecha_hasta: p.fecha_hasta,
    }))
  );
  if (errP) return { ok: false, error: errP.message };

  revalidatePath("/solicitudes");
  return { ok: true, id: sol.id };
}

// ════════════════════════════════════════════════════════════════
// Firmar
// ════════════════════════════════════════════════════════════════

export async function responderSolicitud(
  solicitudId: string, aprobar: boolean, respuesta: string
): Promise<Resultado> {
  const solicitante = await solicitanteActual();
  if (!solicitante) return { ok: false, error: "Sesión no válida." };

  const sb = await clienteServidor();

  const { data: sol } = await sb
    .from("solicitudes_memo")
    .select("id, estado, solicitante_id, jefatura_id, solicitud_personas ( usuario_id )")
    .eq("id", solicitudId)
    .single();
  if (!sol) return { ok: false, error: "El pedido no existe o no tienes acceso." };

  // Quién puede firmar no lo decide el rol solo: hay que ser la jefatura a
  // la que se le pidió, y no ser parte del viaje.
  const veredicto = puedeResponder(
    {
      id: sol.id,
      estado: sol.estado as EstadoSolicitud,
      solicitanteId: sol.solicitante_id,
      jefaturaId: sol.jefatura_id,
      personas: ((sol.solicitud_personas ?? []) as Array<{ usuario_id: string }>)
        .map(p => p.usuario_id),
    },
    {
      usuarioId: solicitante.usuarioId,
      esJefatura: autoriza(solicitante, "responder_solicitud").ok,
      esAdminSistema: autoriza(solicitante, "editar_catalogos").ok,
    }
  );
  if (!veredicto.puede) return { ok: false, error: veredicto.motivo };

  // Un rechazo sin explicación deja a quien pidió sin saber qué corregir.
  if (!aprobar && !respuesta.trim()) {
    return { ok: false, error: "Escribe por qué lo rechazas: sin eso, quien pidió no sabe qué corregir." };
  }

  const { error } = await sb
    .from("solicitudes_memo")
    .update({
      estado: aprobar ? "APROBADA" : "RECHAZADA",
      respuesta: respuesta.trim() || null,
      respondido_por: solicitante.usuarioId,
      respondido_en: new Date().toISOString(),
    })
    .eq("id", solicitudId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/solicitudes");
  revalidatePath(`/solicitudes/${solicitudId}`);
  return { ok: true };
}

/** Retirar el pedido: el viaje se cayó. Lo hace quien lo pidió. */
export async function anularSolicitud(solicitudId: string): Promise<Resultado> {
  const solicitante = await solicitanteActual();
  if (!solicitante) return { ok: false, error: "Sesión no válida." };

  const sb = await clienteServidor();

  const { data: sol } = await sb
    .from("solicitudes_memo")
    .select("id, estado, solicitante_id")
    .eq("id", solicitudId)
    .single();
  if (!sol) return { ok: false, error: "El pedido no existe o no tienes acceso." };

  if (sol.solicitante_id !== solicitante.usuarioId
      && !autoriza(solicitante, "crear_memo").ok) {
    return { ok: false, error: "Solo quien pidió puede retirarlo." };
  }
  if (sol.estado === "CONVERTIDA") {
    return { ok: false, error: "Este pedido ya tiene su memo: lo que se anula ahora es el memo." };
  }

  const { error } = await sb
    .from("solicitudes_memo").update({ estado: "ANULADA" }).eq("id", solicitudId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/solicitudes");
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════
// Emitir
// ════════════════════════════════════════════════════════════════
//
// Acá el pedido se vuelve memo. Es el punto donde el circuito que hasta hoy
// vivía en una conversación se junta con el que ya estaba en la aplicación.
//
// El anexo del memo sale de las personas del pedido sin traducir nada:
// `solicitud_personas` tiene la misma forma que `memo_asignados` justamente
// para eso.

export async function emitirMemoDeSolicitud(
  solicitudId: string, abrir: boolean
): Promise<Resultado> {
  const solicitante = await solicitanteActual();
  if (!solicitante) return { ok: false, error: "Sesión no válida." };

  const permiso = autoriza(solicitante, "crear_memo");
  if (!permiso.ok) return { ok: false, error: permiso.motivo };

  const sb = await clienteServidor();

  const { data: sol } = await sb
    .from("solicitudes_memo")
    .select(`
      id, estado, tipo, centro_costo_id, destino, motivo,
      solicitante_id, jefatura_id,
      solicitud_personas ( usuario_id, monto, fecha_desde, fecha_hasta )
    `)
    .eq("id", solicitudId)
    .single();
  if (!sol) return { ok: false, error: "El pedido no existe o no tienes acceso." };

  const personas = (sol.solicitud_personas ?? []) as Array<{
    usuario_id: string; monto: number | null;
    fecha_desde: string | null; fecha_hasta: string | null;
  }>;

  // Emitir sin la firma sería volver exactamente a lo de antes.
  const veredicto = puedeEmitirse({
    id: sol.id,
    estado: sol.estado as EstadoSolicitud,
    solicitanteId: sol.solicitante_id,
    jefaturaId: sol.jefatura_id,
    personas: personas.map(p => p.usuario_id),
  });
  if (!veredicto.puede) return { ok: false, error: veredicto.motivo };

  const r = await crearMemo({
    tipo: sol.tipo,
    centro_costo_id: sol.centro_costo_id,
    destino: sol.destino ?? "",
    abrir,
    asignados: personas.map(p => ({
      usuario_id: p.usuario_id,
      monto: p.monto == null ? null : Number(p.monto),
      fecha_desde: p.fecha_desde,
      fecha_hasta: p.fecha_hasta,
    })),
  });
  if (!r.ok) return { ok: false, error: r.error };

  // El enlace en los dos sentidos: el pedido sabe qué memo salió de él, y el
  // memo conserva de dónde viene. Sin esto la aplicación vuelve a saber
  // quién tecleó el memo pero no quién lo pidió.
  const { error } = await sb
    .from("solicitudes_memo")
    .update({ estado: "CONVERTIDA", memo_id: r.id })
    .eq("id", solicitudId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/solicitudes");
  revalidatePath("/administrar");
  return { ok: true, id: r.id };
}
