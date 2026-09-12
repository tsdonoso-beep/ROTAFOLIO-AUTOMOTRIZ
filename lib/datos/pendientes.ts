import { clienteServidor } from "@/lib/supabase/servidor";
import { autoriza, type Solicitante } from "@/lib/dominio/permisos";
import { MEMO_PENDIENTE } from "@/lib/dominio/estados";
import { SIN_PENDIENTES, type ConteosPendientes } from "@/lib/dominio/pendientes";

/**
 * Cuenta lo que esta persona tiene esperando.
 *
 * Cada consulta va detrás de su permiso: si no puedes revisar, no se
 * pregunta cuántas hay por revisar. No es solo ahorro —son siete consultas
 * en cada carga— sino que la cuenta corresponda a lo que esa persona
 * efectivamente puede hacer.
 *
 * Las políticas de fila ya limitan qué ve cada quien; acá se acota además
 * a lo que es SUYO, que no es lo mismo: Contabilidad ve todos los memos,
 * pero "tus gastos observados" son los que capturó ella.
 */
export async function contarPendientes(
  solicitante: Solicitante
): Promise<ConteosPendientes> {
  const sb = await clienteServidor();
  const yo = solicitante.usuarioId;
  const c: ConteosPendientes = { ...SIN_PENDIENTES };

  // `head: true` pide solo la cuenta: no se traen las filas para
  // descartarlas después.
  const soloCuenta = { count: "exact" as const, head: true };

  const tareas: Array<Promise<void>> = [];

  // ── Lo propio, para cualquiera ──
  tareas.push((async () => {
    const { count } = await sb
      .from("gastos").select("*", soloCuenta)
      .eq("usuario_id", yo).eq("estado", "OBSERVADO");
    c.gastosObservados = count ?? 0;
  })());

  // Una subida fallida se guardaba y nadie la miraba nunca. Se cuenta sobre
  // drive_error y no sobre drive_url en blanco: un Yape legítimamente no
  // tiene foto, y eso no es un problema que haya que avisar.
  tareas.push((async () => {
    const { count } = await sb
      .from("gastos").select("*", soloCuenta)
      .eq("usuario_id", yo).not("drive_error", "is", null);
    c.fotosSinArchivar = count ?? 0;
  })());

  tareas.push((async () => {
    const { data } = await sb
      .from("memo_asignados")
      .select("memos ( estado, fecha_retorno_prev )")
      .eq("usuario_id", yo);

    const hoy = new Date().toISOString().slice(0, 10);
    c.rendicionesVencidas = ((data ?? []) as unknown as Array<{
      memos: { estado: string; fecha_retorno_prev: string | null } | null;
    }>).filter(f =>
      f.memos
      && MEMO_PENDIENTE.includes(f.memos.estado as never)
      && f.memos.fecha_retorno_prev !== null
      && f.memos.fecha_retorno_prev < hoy
    ).length;
  })());

  // ── Lo que llega por el rol ──
  if (autoriza(solicitante, "autorizar_apertura_con_pendientes").ok) {
    tareas.push((async () => {
      const { count } = await sb
        .from("autorizaciones_memo").select("*", soloCuenta)
        .eq("jefe_id", yo).eq("estado", "PENDIENTE");
      c.vistoBueno = count ?? 0;
    })());
  }

  if (autoriza(solicitante, "aprobar_rendicion").ok) {
    tareas.push((async () => {
      const { count } = await sb
        .from("memos").select("*", soloCuenta).eq("estado", "PRESENTADA");
      c.porRevisar = count ?? 0;
    })());
  }

  if (autoriza(solicitante, "marcar_contabilizado").ok) {
    tareas.push((async () => {
      const { count } = await sb
        .from("memos").select("*", soloCuenta).eq("estado", "APROBADA");
      c.porContabilizar = count ?? 0;
    })());
    tareas.push((async () => {
      const { count } = await sb
        .from("liquidaciones").select("*", soloCuenta).eq("estado", "EMITIDA");
      c.porPagar = count ?? 0;
    })());
  }

  if (autoriza(solicitante, "crear_memo").ok) {
    tareas.push((async () => {
      // Un borrador detenido es el que tiene una solicitud sin responder o
      // rechazada. Un borrador a secas es trabajo en curso, no un problema.
      const { data } = await sb
        .from("autorizaciones_memo")
        .select("memo_id, estado, memos!inner ( estado )")
        .in("estado", ["PENDIENTE", "RECHAZADA"])
        .eq("memos.estado", "BORRADOR");

      c.borradoresDetenidos = new Set(
        ((data ?? []) as unknown as Array<{ memo_id: string }>).map(a => a.memo_id)
      ).size;
    })());
  }

  await Promise.all(tareas);
  return c;
}
