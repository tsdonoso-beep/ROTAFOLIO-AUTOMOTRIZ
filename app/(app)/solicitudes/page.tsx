import { redirect } from "next/navigation";
import Link from "next/link";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";
import { ETIQUETA_SOLICITUD, type EstadoSolicitud } from "@/lib/dominio/solicitud";
import { Encabezado, Tarjeta, Vacio, soles } from "@/components/v2/Encabezado";
import { IconoComentario } from "@/components/v2/Iconos";
import PanelSolicitud from "@/components/v2/PanelSolicitud";

const TONO: Record<EstadoSolicitud, { fondo: string; texto: string }> = {
  PENDIENTE:  { fondo: "var(--warn-bg, rgba(217,119,6,0.08))", texto: "var(--warn)" },
  APROBADA:   { fondo: "rgba(0,162,152,0.10)", texto: "var(--accent)" },
  CONVERTIDA: { fondo: "var(--fondo2, #F4F4F5)", texto: "var(--text2)" },
  RECHAZADA:  { fondo: "var(--danger-bg)", texto: "var(--danger)" },
  ANULADA:    { fondo: "var(--fondo2, #F4F4F5)", texto: "var(--text3)" },
};

/**
 * Los pedidos.
 *
 * Este es el paso que hasta ahora ocurría fuera de la aplicación: alguien
 * necesita viajar, su jefatura lo autoriza en una conversación que no deja
 * rastro, y recién entonces Administración escribe el memo.
 */
export default async function Solicitudes() {
  const solicitante = await solicitanteActual();
  if (!solicitante) redirect("/ingresar");

  const sb = await clienteServidor();

  // Las políticas de fila ya limitan lo que se ve: lo propio, lo que a uno
  // le toca firmar, y todo para quien administra.
  const { data: solicitudes } = await sb
    .from("solicitudes_memo")
    .select(`
      id, tipo, estado, motivo, destino, monto_estimado,
      fecha_desde, fecha_hasta, respuesta, creado_en, memo_id,
      solicitante:usuarios!solicitudes_memo_solicitante_id_fkey ( id, nombre ),
      jefe:usuarios!solicitudes_memo_jefatura_id_fkey ( id, nombre ),
      solicitud_personas ( usuario_id, monto, usuarios ( nombre ) )
    `)
    .order("creado_en", { ascending: false });

  const puedeEmitir = autoriza(solicitante, "crear_memo").ok;

  const filas = (solicitudes ?? []).map(s => {
    const personas = (s.solicitud_personas ?? []) as unknown as Array<{
      usuario_id: string; monto: number | null; usuarios: { nombre: string } | null;
    }>;
    const quien = s.solicitante as unknown as { id: string; nombre: string } | null;
    const jefe = s.jefe as unknown as { id: string; nombre: string } | null;

    return {
      id: s.id,
      tipo: s.tipo as string,
      estado: s.estado as EstadoSolicitud,
      motivo: s.motivo as string,
      destino: s.destino as string | null,
      monto: s.monto_estimado == null ? null : Number(s.monto_estimado),
      desde: s.fecha_desde as string | null,
      hasta: s.fecha_hasta as string | null,
      respuesta: s.respuesta as string | null,
      memoId: s.memo_id as string | null,
      solicitanteId: quien?.id ?? "",
      solicitanteNombre: quien?.nombre ?? "—",
      jefeId: jefe?.id ?? null,
      jefeNombre: jefe?.nombre ?? null,
      personas: personas.map(p => ({
        id: p.usuario_id,
        nombre: p.usuarios?.nombre ?? "—",
        monto: p.monto == null ? null : Number(p.monto),
      })),
    };
  });

  const esperando = filas.filter(f => f.estado === "PENDIENTE" || f.estado === "APROBADA");
  const resueltas = filas.filter(f => !esperando.includes(f));

  return (
    <>
      <Encabezado
        titulo="Pedidos"
        bajada="Quién necesita el memo, quién lo autoriza y por qué — el paso que hasta ahora no dejaba rastro"
        accion={
          <Link href="/solicitudes/nueva" className="btn-primary"
            style={{ textDecoration: "none" }}>
            Pedir un memo
          </Link>
        }
      />

      {filas.length === 0 ? (
        <Vacio
          icono={<IconoComentario size={26} />}
          titulo="No hay pedidos"
          texto="Cuando alguien necesite viajar, lo pide acá y su jefatura lo autoriza. Recién entonces Administración emite el memo."
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {esperando.length > 0 && (
            <section style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {esperando.map(f => (
                <PanelSolicitud key={f.id} solicitud={f} yo={solicitante.usuarioId}
                  puedeEmitir={puedeEmitir} tono={TONO[f.estado]}
                  etiqueta={ETIQUETA_SOLICITUD[f.estado]} />
              ))}
            </section>
          )}

          {resueltas.length > 0 && (
            <section>
              <h2 className="fg-label" style={{ marginBottom: 9 }}>Ya resueltos</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {resueltas.map(f => (
                  <Tarjeta key={f.id} padding={13}>
                    <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 600 }}>
                          {f.motivo}
                        </span>
                        <p style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>
                          {f.solicitanteNombre} · {f.personas.length} persona
                          {f.personas.length === 1 ? "" : "s"}
                          {f.monto != null && ` · ${soles(f.monto)}`}
                        </p>
                      </div>
                      <span style={{
                        fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: 999,
                        background: TONO[f.estado].fondo, color: TONO[f.estado].texto,
                        flexShrink: 0,
                      }}>
                        {ETIQUETA_SOLICITUD[f.estado]}
                      </span>
                      {f.memoId && (
                        <Link href={`/memos/${f.memoId}`} style={{
                          fontSize: 11.5, color: "var(--accent)", fontWeight: 600,
                          textDecoration: "none", flexShrink: 0,
                        }}>
                          Ver memo
                        </Link>
                      )}
                    </div>
                    {f.respuesta && (
                      <p style={{
                        fontSize: 11.5, color: "var(--text2)", marginTop: 7,
                        paddingTop: 7, borderTop: "1px solid var(--border2)", lineHeight: 1.5,
                      }}>
                        {f.respuesta}
                      </p>
                    )}
                  </Tarjeta>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}
