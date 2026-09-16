import { notFound, redirect } from "next/navigation";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";
import { leerParametros } from "@/lib/dominio/parametros";
import VistaPlanilla from "@/components/v2/VistaPlanilla";

export default async function DetallePlanilla(
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const solicitante = await solicitanteActual();
  if (!solicitante) redirect("/ingresar");

  const sb = await clienteServidor();

  const { data: planilla } = await sb
    .from("planillas_movilidad")
    .select(`
      id, numero, periodo, fecha_emision, autorizado_en, usuario_id, memo_id,
      usuarios!planillas_movilidad_usuario_id_fkey ( nombre, dni, dni_provisional ),
      autorizador:usuarios!planillas_movilidad_autorizado_por_fkey ( nombre )
    `)
    .eq("id", id)
    .single();

  if (!planilla) notFound();

  const [{ data: gastos }, { data: filasParam }] = await Promise.all([
    sb.from("gastos")
      .select("id, fecha_emision, mov_motivo, mov_destino, total, estado")
      .eq("planilla_movilidad_id", id)
      .order("fecha_emision", { nullsFirst: false }),
    sb.from("parametros").select("clave, valor"),
  ]);

  const dueno = planilla.usuarios as unknown as
    { nombre: string; dni: string | null; dni_provisional: boolean } | null;
  const autorizador = planilla.autorizador as unknown as { nombre: string } | null;

  const esSuya = planilla.usuario_id === solicitante.usuarioId;

  return (
    <VistaPlanilla
      planilla={{
        id: planilla.id,
        numero: planilla.numero,
        periodo: planilla.periodo,
        fechaEmision: planilla.fecha_emision,
        autorizadoEn: planilla.autorizado_en,
        autorizadorNombre: autorizador?.nombre ?? null,
      }}
      trabajador={{
        nombre: dueno?.nombre ?? null,
        dni: dueno?.dni ?? null,
        dniProvisional: dueno?.dni_provisional ?? false,
      }}
      desplazamientos={(gastos ?? []).map(g => ({
        id: g.id,
        fecha: g.fecha_emision,
        motivo: g.mov_motivo,
        destino: g.mov_destino,
        monto: g.total == null ? null : Number(g.total),
      }))}
      parametros={leerParametros(filasParam)}
      // Quien es dueño de la planilla la llena; la jefatura la firma. Son
      // dos casillas distintas del mismo formulario y dos personas.
      puedeEditar={esSuya || autoriza(solicitante, "crear_memo").ok}
      puedeAutorizar={
        !esSuya && autoriza(solicitante, "autorizar_apertura_con_pendientes").ok
      }
    />
  );
}
