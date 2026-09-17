"use server";
import { revalidatePath } from "next/cache";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";
import { siguienteCiclo } from "@/lib/dominio/cajachica";

type Resultado =
  | { ok: true; id?: string }
  | { ok: false; error: string };

// ════════════════════════════════════════════════════════════════
// El fondo de caja chica
// ════════════════════════════════════════════════════════════════
//
// La caja es el fondo: dura, tiene un responsable y una cuenta. El memo es un
// ciclo de esa caja: nace, se rinde y se cierra, y el siguiente ciclo es un
// memo nuevo que apunta al anterior. Así cada reposición queda cerrada y
// auditable, en vez de reabrir algo ya cerrado y perder la historia.

export async function crearCaja(datos: {
  codigo: string;
  nombre: string;
  responsableId: string;
  centroCostoId: string;
}): Promise<Resultado> {
  const solicitante = await solicitanteActual();
  if (!solicitante) return { ok: false, error: "Sesión no válida." };

  const permiso = autoriza(solicitante, "crear_memo");
  if (!permiso.ok) return { ok: false, error: permiso.motivo };

  if (!datos.codigo.trim() || !datos.nombre.trim()) {
    return { ok: false, error: "La caja necesita un código y un nombre." };
  }
  if (!datos.responsableId) {
    return {
      ok: false,
      error: "Falta el responsable. Una caja sin responsable es un fondo del "
        + "que nadie rinde: en el memo 194-2026 el anexo lo dice con todas sus "
        + "letras, «Ejecutor y Administrador de Caja Chica».",
    };
  }

  const sb = await clienteServidor();

  const { data: cc } = await sb
    .from("centros_costo").select("empresa_id").eq("id", datos.centroCostoId).single();
  if (!cc) return { ok: false, error: "El centro de costo no existe." };

  const { data, error } = await sb
    .from("cajas_chicas")
    .insert({
      codigo: datos.codigo.trim(),
      nombre: datos.nombre.trim(),
      empresa_id: cc.empresa_id,
      responsable_id: datos.responsableId,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: `Ya existe una caja con el código ${datos.codigo}.` };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/caja");
  return { ok: true, id: data.id };
}

/**
 * Repone el fondo: abre el ciclo siguiente.
 *
 * No reabre el anterior. El ciclo que se cerró queda cerrado con lo que se
 * gastó y lo que se repuso, y el nuevo apunta a él. Es lo que permite
 * contestar «cuánto se repuso y cuándo» sin reconstruirlo de memoria.
 */
export async function reponerCaja(datos: {
  cajaId: string;
  monto: number;
  centroCostoId: string;
}): Promise<Resultado> {
  const solicitante = await solicitanteActual();
  if (!solicitante) return { ok: false, error: "Sesión no válida." };

  const permiso = autoriza(solicitante, "crear_memo");
  if (!permiso.ok) return { ok: false, error: permiso.motivo };

  if (!(datos.monto > 0)) {
    return { ok: false, error: "El monto de la reposición debe ser mayor que cero." };
  }

  const sb = await clienteServidor();

  const { data: caja } = await sb
    .from("cajas_chicas")
    .select("id, codigo, empresa_id, responsable_id, activa")
    .eq("id", datos.cajaId)
    .single();
  if (!caja) return { ok: false, error: "La caja no existe o no tienes acceso." };
  if (!caja.activa) return { ok: false, error: "Esta caja está desactivada." };

  const { data: ciclos } = await sb
    .from("memos")
    .select("id, ciclo, estado, creado_en")
    .eq("caja_id", datos.cajaId)
    .order("creado_en", { ascending: false });

  // Dos ciclos vivos a la vez son dos fondos, y el saldo deja de significar
  // nada: primero se rinde el que está abierto.
  const vivo = (ciclos ?? []).find(m =>
    ["ABIERTO", "EN_RENDICION", "PRESENTADA", "OBSERVADA"].includes(m.estado));
  if (vivo) {
    return {
      ok: false,
      error: "Esta caja ya tiene un ciclo abierto. Rinde ese antes de reponer: "
        + "dos ciclos a la vez son dos fondos, y el saldo deja de significar nada.",
    };
  }

  const anterior = (ciclos ?? [])[0] ?? null;
  const anio = new Date().getFullYear();

  const { data: sec, error: errSec } = await sb.rpc("siguiente_correlativo", {
    p_empresa: caja.empresa_id, p_anio: anio, p_tipo: "CAJA_CHICA",
  });
  if (errSec) return { ok: false, error: `No se pudo generar el correlativo: ${errSec.message}` };

  const { data: emp } = await sb
    .from("empresas").select("abreviatura").eq("id", caja.empresa_id).single();
  const correlativo =
    `${emp?.abreviatura ?? "EMP"}-${anio}-CCH-${String(sec).padStart(5, "0")}`;

  const { data: memo, error } = await sb
    .from("memos")
    .insert({
      correlativo,
      tipo: "CAJA_CHICA",
      empresa_id: caja.empresa_id,
      centro_costo_id: datos.centroCostoId,
      caja_id: caja.id,
      ciclo: siguienteCiclo(anterior?.ciclo ?? null, anio),
      // La cadena es la que ordena de verdad: el número del ciclo es una
      // etiqueta, y hay dos numeraciones sin reconciliar.
      memo_referido_id: anterior?.id ?? null,
      monto_autorizado: datos.monto,
      estado: "ABIERTO",
      creado_por: solicitante.usuarioId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  // El responsable de la caja es quien rinde por ella.
  const { error: errAsig } = await sb.from("memo_asignados").insert({
    memo_id: memo.id,
    usuario_id: caja.responsable_id,
    monto: datos.monto,
  });
  if (errAsig) return { ok: false, error: errAsig.message };

  revalidatePath(`/caja/${caja.id}`);
  revalidatePath("/caja");
  return { ok: true, id: memo.id };
}
