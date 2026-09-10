import { redirect } from "next/navigation";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import { autoriza, veTodo } from "@/lib/dominio/permisos";
import { Encabezado, Tarjeta, Vacio, Cifra, soles } from "@/components/v2/Encabezado";
import { consolidarEquipo, resumirEquipo, type MemoDeEquipo } from "@/lib/dominio/equipo";
import { IconoTablero } from "@/components/v2/Iconos";
import PanelAutorizaciones, { type SolicitudPendiente } from "@/components/v2/PanelAutorizaciones";

interface MemoCrudo {
  id: string;
  correlativo: string;
  estado: string;
  monto_autorizado: number;
  fecha_retorno_prev: string | null;
  memo_asignados: Array<{ usuarios: { id: string; nombre: string } | null }>;
  gastos: MemoDeEquipo["gastos"];
}

/**
 * El tablero de una jefatura: su gente, no sus memos.
 *
 * Las políticas de fila ya deciden a quién alcanza cada quien —un líder
 * ve a los suyos, Contabilidad ve todo—, así que esta consulta pide lo
 * mismo para todos y la base devuelve lo que corresponde.
 */
export default async function Tablero() {
  const solicitante = await solicitanteActual();
  if (!solicitante) redirect("/ingresar");
  if (!autoriza(solicitante, "autorizar_apertura_con_pendientes").ok) redirect("/");

  const sb = await clienteServidor();

  // Lo que espera su firma va primero: es lo único de esta pantalla que le
  // está frenando el trabajo a otra persona. Las políticas de fila ya
  // limitan estas filas a las suyas.
  const { data: solicitudes } = await sb
    .from("autorizaciones_memo")
    .select("id, correlativo, monto, destino, motivo, creado_en, usuarios!autorizaciones_memo_solicitada_por_fkey ( nombre )")
    .eq("estado", "PENDIENTE")
    .order("creado_en", { ascending: true });

  const pendientesDeFirma: SolicitudPendiente[] = ((solicitudes ?? []) as unknown as Array<{
    id: string; correlativo: string; monto: number; destino: string | null;
    motivo: string; creado_en: string; usuarios: { nombre: string } | null;
  }>).map(a => ({
    id: a.id,
    correlativo: a.correlativo,
    monto: Number(a.monto),
    destino: a.destino,
    motivo: a.motivo,
    pedidaPor: a.usuarios?.nombre ?? "Administración",
    creadoEn: a.creado_en.slice(0, 10),
  }));

  const { data } = await sb
    .from("memos")
    .select(`
      id, correlativo, estado, monto_autorizado, fecha_retorno_prev,
      memo_asignados ( usuarios ( id, nombre ) ),
      gastos ( estado, clase, total, alertas )
    `)
    .in("estado", ["ABIERTO", "EN_RENDICION", "OBSERVADA"]);

  const memos: MemoDeEquipo[] = ((data ?? []) as unknown as MemoCrudo[]).map(m => ({
    id: m.id,
    correlativo: m.correlativo,
    estado: m.estado as MemoDeEquipo["estado"],
    monto_autorizado: Number(m.monto_autorizado),
    fecha_retorno_prev: m.fecha_retorno_prev,
    personas: (m.memo_asignados ?? [])
      .map(a => a.usuarios)
      .filter((u): u is { id: string; nombre: string } => !!u),
    gastos: m.gastos ?? [],
  }));

  // El reloj se lee acá, una sola vez, y se pasa como dato: la función que
  // calcula el atraso es pura y por eso se puede probar.
  const filas = consolidarEquipo(memos, new Date());
  const r = resumirEquipo(filas);

  const global = veTodo(solicitante.roles);

  return (
    <>
      <Encabezado
        titulo={global ? "Pendientes de rendición" : "Mi equipo"}
        bajada={global
          ? "Quién tiene memos sin cerrar, por cuánto y desde hace cuánto."
          : "Las personas a tu cargo con memos sin cerrar. El seguimiento es tuyo: quien recibe las rendiciones ya no persigue de a uno."}
      />

      <PanelAutorizaciones solicitudes={pendientesDeFirma} />

      {!filas.length ? (
        <Vacio
          icono={<IconoTablero size={26} />}
          titulo={global ? "Nadie tiene memos abiertos" : "Tu equipo está al día"}
          texto={global
            ? "Cuando se abran memos aparecerá aquí el consolidado por persona."
            : "Nadie a tu cargo tiene memos sin cerrar. Si esperabas ver a alguien, puede que todavía no le hayan asignado su jefatura en Sistema."}
        />
      ) : (
        <>
          <div style={{
            display: "grid", gap: 10, marginBottom: 18,
            gridTemplateColumns: "repeat(auto-fit, minmax(148px, 1fr))",
          }}>
            <Tarjeta padding={15}>
              <Cifra rotulo="Personas" valor={String(r.personas)} />
            </Tarjeta>
            <Tarjeta padding={15}>
              <Cifra rotulo="Memos sin cerrar" valor={String(r.memosAbiertos)} />
            </Tarjeta>
            <Tarjeta padding={15}>
              <Cifra
                rotulo="Sin rendir" valor={soles(r.totalSinRendir)}
                tono={r.totalSinRendir > 0 ? "aviso" : "tenue"}
              />
            </Tarjeta>
            <Tarjeta padding={15}>
              <Cifra
                rotulo="Mayor atraso"
                valor={r.mayorAtraso > 0 ? `${r.mayorAtraso} días` : "al día"}
                tono={r.mayorAtraso > 15 ? "peligro" : r.mayorAtraso > 0 ? "aviso" : "acento"}
              />
            </Tarjeta>
          </div>

          {r.personasVencidas > 0 && !global && (
            <div style={{
              marginBottom: 14, padding: "12px 15px", borderRadius: "var(--radio-s)",
              background: "var(--warn-bg)", border: "1px solid var(--warn-borde)",
            }}>
              <p style={{ fontSize: 12.5, color: "var(--warn)", lineHeight: 1.55 }}>
                <strong style={{ fontFamily: "var(--font-sora), sans-serif" }}>
                  {r.personasVencidas} de tu equipo pasó su fecha de retorno
                </strong>{" "}
                sin cerrar la rendición. Están ordenados por antigüedad: el de
                arriba es el que conviene llamar primero.
              </p>
            </div>
          )}

          <Tarjeta padding={0}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "var(--surface2)", borderBottom: "1px solid var(--border)" }}>
                    {["Persona", "Memos", "Sin rendir", "Atraso"].map((h, i) => (
                      <th key={h} style={{
                        padding: "10px 16px", textAlign: i === 0 ? "left" : "right",
                        fontSize: 10, fontWeight: 700, letterSpacing: "0.07em",
                        textTransform: "uppercase", color: "var(--text3)",
                        fontFamily: "var(--font-sora), sans-serif", whiteSpace: "nowrap",
                      }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f, i) => (
                    <tr key={f.usuarioId} style={{
                      borderBottom: i < filas.length - 1 ? "1px solid var(--border)" : "none",
                    }}>
                      <td style={{ padding: "11px 16px", fontWeight: 600, color: "var(--text)" }}>
                        {f.nombre}
                      </td>
                      <td style={{ padding: "11px 16px", textAlign: "right", color: "var(--text2)" }}>
                        {f.memos}
                        {f.vencidos > 0 && f.vencidos < f.memos && (
                          <span style={{ color: "var(--warn)", fontSize: 11 }}> ({f.vencidos} vencidos)</span>
                        )}
                      </td>
                      <td className="cifra" style={{
                        padding: "11px 16px", textAlign: "right", fontSize: 13, color: "var(--text)",
                      }}>
                        {soles(f.sinRendir)}
                      </td>
                      <td style={{ padding: "11px 16px", textAlign: "right" }}>
                        <span className="badge" style={
                          f.atrasoDias > 15
                            ? { background: "var(--danger-bg)", color: "var(--danger)" }
                            : f.atrasoDias > 0
                            ? { background: "var(--warn-bg)", color: "var(--warn)" }
                            : { background: "var(--success-bg)", color: "var(--success)" }
                        }>
                          {f.atrasoDias > 0 ? `${f.atrasoDias} días` : "al día"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Tarjeta>
        </>
      )}
    </>
  );
}
